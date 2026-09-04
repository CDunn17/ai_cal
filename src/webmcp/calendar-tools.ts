import type { CalendarEvent, EventDraft, RecurringProposal, ScheduleCandidate, SchedulingProfile, TimeAwayChangeSet } from "../domain/contracts";
import type { CalendarState } from "../domain/calendar-store";

export type ToolActivity = Readonly<{
  id: string;
  tool: string;
  mode: "read" | "draft" | "blocked";
  outcome: "started" | "succeeded" | "failed" | "blocked";
  summary: string;
  requestPreview?: string;
  responsePreview?: string;
  occurredAt: string;
}>;

const ACTIVITY_EVENT = "mycp:tool-activity";
const STATE_CHANGED_EVENT = "mycp:calendar-state-changed";
export const MAX_TOOL_OUTPUT_BYTES = 1_400;
export const MAX_ACTIVITY_PREVIEW_BYTES = 600;

type JsonRecord = Record<string, unknown>;

function schema(properties: JsonRecord, required: string[] = []): JsonRecord {
  return { type: "object", properties, required, additionalProperties: false };
}

function report(activity: Omit<ToolActivity, "occurredAt">): void {
  window.dispatchEvent(
    new CustomEvent<ToolActivity>(ACTIVITY_EVENT, {
      detail: { ...activity, occurredAt: new Date().toISOString() }
    })
  );
}

export function formatToolResult(status: "ok" | "error" | "blocked", data: unknown): string {
  const serialized = JSON.stringify({ status, data });
  if (new TextEncoder().encode(serialized).byteLength <= MAX_TOOL_OUTPUT_BYTES) return serialized;
  return JSON.stringify({
    status,
    data: {
      truncated: true,
      message: "Result exceeded the tool output budget. Use a narrower read or a specific event ID."
    }
  });
}

export function formatActivityPreview(data: unknown): string {
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_ACTIVITY_PREVIEW_BYTES) return serialized;
  return JSON.stringify({
    truncated: true,
    message: "Preview is bounded. Inspect the tool contract or use a narrower request."
  });
}

function clip(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length <= maxLength ? value : value.slice(0, maxLength - 1) + "…";
}

function compactEvent(event: CalendarEvent) {
  return {
    id: event.id,
    revision: event.revision,
    title: clip(event.title, 160),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    visibility: event.visibility,
    recurrence: event.recurrence,
    attendeeIds: event.attendeeIds.slice(0, 10),
    location: clip(event.location, 120),
    agenda: clip(event.agenda, 240)
  };
}

function compactDraft(draft: EventDraft) {
  return {
    draftId: draft.id,
    revision: draft.revision,
    expiresAt: draft.expiresAt,
    event: compactEvent(draft.event)
  };
}

function compactChangeSet(changeSet: TimeAwayChangeSet) {
  return {
    changeSetId: changeSet.id,
    revision: changeSet.revision,
    expiresAt: changeSet.expiresAt,
    timeAway: compactEvent(changeSet.timeAwayEvent),
    cancellationCount: changeSet.cancellations.length,
    cancellations: changeSet.cancellations.slice(0, 5),
    transferCount: changeSet.transfers.length,
    transfers: changeSet.transfers.slice(0, 5)
  };
}

function compactCandidates(candidates: ScheduleCandidate[]) {
  return candidates.slice(0, 3).map((candidate) => ({
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    score: candidate.score,
    reasons: candidate.reasons.slice(0, 2).map((reason) => clip(reason, 140)),
    warnings: candidate.warnings.slice(0, 1).map((warning) => clip(warning, 140))
  }));
}

function compactRecurringProposals(proposals: RecurringProposal[]) {
  return proposals.slice(0, 1).map((proposal) => {
    const candidate = proposal.candidate;
    return {
      proposalId: proposal.id,
      expiresAt: proposal.expiresAt,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      score: candidate.score,
      recurrence: candidate.recurrence,
      occurrenceCount: candidate.occurrences.length,
      occurrences: candidate.occurrences.slice(0, 2).map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      reasons: candidate.reasons.slice(0, 2).map((reason) => clip(reason, 140)),
      warnings: candidate.warnings.slice(0, 2).map((warning) => clip(warning, 140))
    };
  });
}

function compactSchedulingProfile(profile: SchedulingProfile, include: string[] | undefined) {
  const requested = new Set(include ?? ["meeting_preferences", "work_pattern", "recurring_focus_blocks"]);
  return {
    userId: profile.personId,
    profileRevision: profile.revision,
    defaultOfficeId: profile.defaultOfficeId,
    ...(requested.has("meeting_preferences") ? { meetingPreferences: profile.meetingPreferences } : {}),
    ...(requested.has("work_pattern") ? { weeklyWorkPattern: profile.weeklyWorkPattern } : {}),
    ...(requested.has("recurring_focus_blocks") ? { recurringFocusBlocks: profile.recurringFocusBlocks } : {})
  };
}

async function api<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Calendar request failed.");
  }
  return body;
}

async function runTool(
  tool: string,
  mode: ToolActivity["mode"],
  operation: () => Promise<unknown>,
  input: unknown
): Promise<string> {
  const id = crypto.randomUUID();
  const requestPreview = formatActivityPreview(input);
  report({ id, tool, mode, outcome: "started", summary: "Agent called this WebMCP tool.", requestPreview });
  try {
    const data = await operation();
    const responsePreview = formatToolResult("ok", data);
    report({ id, tool, mode, outcome: "succeeded", summary: "Returned a structured, bounded result.", requestPreview, responsePreview });
    if (mode === "draft") {
      window.dispatchEvent(new Event(STATE_CHANGED_EVENT));
    }
    return responsePreview;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar tool failed.";
    const responsePreview = formatToolResult("error", { message });
    report({ id, tool, mode, outcome: "failed", summary: "The tool returned an error.", requestPreview, responsePreview });
    return responsePreview;
  }
}

const timeRangeProperties = {
  attendeeIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
  durationMinutes: { type: "integer", minimum: 15, maximum: 120, multipleOf: 15 },
  officeId: { type: "string", enum: ["downtown-manhattan", "newark-nj"], description: "Optional meeting office. Travel feedback uses the demo's fixed office assignments and route time." },
  rangeStartsAt: { type: "string", format: "date-time" },
  rangeEndsAt: { type: "string", format: "date-time" }
};

const weeklyRecurrenceRequestProperties = {
  frequency: { type: "string", enum: ["weekly"] },
  weekday: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  occurrenceCount: { type: "integer", minimum: 2, maximum: 26, description: "Bounded number of weekly occurrences to validate and include in the draft." }
};

const weeklyRecurrenceProperties = {
  ...weeklyRecurrenceRequestProperties,
  exceptions: {
    type: "array",
    maxItems: 4,
    items: schema({
      originalStartsAt: { type: "string", format: "date-time" },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" }
    }, ["originalStartsAt", "startsAt", "endsAt"])
  }
};

const recurringScheduleProperties = {
  ...timeRangeProperties,
  recurrence: schema(weeklyRecurrenceRequestProperties, ["frequency", "weekday", "occurrenceCount"]),
  maxExceptions: { type: "integer", minimum: 0, maximum: 4, description: "Maximum one-off reschedules the planner may use while preserving all existing events." },
  requestedStartTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Requested local start time, for example 14:00. With no flexibility, returned base occurrences must use exactly this time." },
  timeFlexibilityMinutes: { type: "integer", minimum: 0, maximum: 240, multipleOf: 15, description: "Allowed difference from requestedStartTime. Defaults to 0, meaning exact time." }
};

const timeAwayProperties = {
  startsAt: { type: "string", format: "date-time" },
  endsAt: { type: "string", format: "date-time" },
  title: { type: "string", maxLength: 140, description: "Private label for the time-away block. Defaults to Vacation." },
  transferEventIds: { type: "array", items: { type: "string" }, maxItems: 10, description: "Owned event IDs in the time-away range to retain by transferring to the named approved delegate. All other owned active events in the range are proposed for cancellation." },
  transferToUserId: { type: "string", description: "Approved delegate user ID. Required only when transferEventIds is non-empty." }
};

const eventProperties = {
  calendarId: { type: "string", description: "Calendar ID owned by the active user." },
  title: { type: "string", maxLength: 140 },
  startsAt: { type: "string", format: "date-time" },
  endsAt: { type: "string", format: "date-time" },
  timeZone: { type: "string", description: "IANA timezone, for example America/New_York." },
  visibility: { type: "string", enum: ["public", "private"] },
  recurrence: schema(weeklyRecurrenceProperties, ["frequency", "weekday", "occurrenceCount"]),
  attendeeIds: { type: "array", items: { type: "string" }, maxItems: 20 },
  location: { type: "string", maxLength: 160 },
  agenda: { type: "string", maxLength: 2000 }
};

const singleEventProperties = {
  calendarId: eventProperties.calendarId,
  title: eventProperties.title,
  startsAt: eventProperties.startsAt,
  endsAt: eventProperties.endsAt,
  timeZone: eventProperties.timeZone,
  visibility: eventProperties.visibility,
  attendeeIds: eventProperties.attendeeIds,
  location: eventProperties.location,
  agenda: eventProperties.agenda
};

const recurringDraftFromProposalProperties = {
  proposalId: { type: "string", format: "uuid", description: "An unexpired proposalId returned by propose_recurring_schedule." },
  title: { type: "string", maxLength: 140 },
  visibility: { type: "string", enum: ["public", "private"] },
  location: { type: "string", maxLength: 160 },
  agenda: { type: "string", maxLength: 2000 }
};

export const calendarTools: WebMCP.ModelContextTool[] = [
  {
    name: "get_calendar_context",
    title: "Get calendar context",
    description: "Read the active user's calendar identities, bounded team-member IDs and display names, up to three pending drafts, and a count of visible events. It never returns a full event list or scheduling-profile details.",
    inputSchema: schema({}),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => runTool("get_calendar_context", "read", async () => {
      const state = await api<CalendarState>("/api/calendar-state");
      return {
        activeUserId: state.activeUserId,
        calendars: state.calendars.map((calendar) => ({ id: calendar.id, name: clip(calendar.name, 80), timeZone: calendar.timeZone })),
        teamMembers: state.people.map((person) => ({ id: person.id, displayName: clip(person.displayName, 80) })),
        pendingDrafts: state.drafts.slice(0, 3).map(compactDraft),
        pendingTimeAwayChangeSetCount: state.changeSets.length,
        visibleEventCount: state.events.length
      };
    }, {})
  },
  {
    name: "get_user_scheduling_profile",
    title: "Get user scheduling profile",
    description: "Read a bounded scheduling-only profile for one visible team member. It can return meeting preferences, weekly office/remote pattern, and recurring focus blocks; it never returns a home address, live location, or private calendar events.",
    inputSchema: schema({
      userId: { type: "string", description: "A team-member ID from get_calendar_context." },
      include: { type: "array", items: { type: "string", enum: ["meeting_preferences", "work_pattern", "recurring_focus_blocks"] }, minItems: 1, maxItems: 3, description: "Optional bounded set of profile sections. Omit to return all scheduling sections." }
    }, ["userId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("get_user_scheduling_profile", "read", async () => {
      if (typeof input.userId !== "string" || !input.userId) throw new Error("A team-member userId is required.");
      const include = Array.isArray(input.include) && input.include.every((section) => typeof section === "string")
        ? input.include.filter((section) => ["meeting_preferences", "work_pattern", "recurring_focus_blocks"].includes(section))
        : undefined;
      if (Array.isArray(input.include) && include?.length !== input.include.length) throw new Error("One or more requested profile sections are not allowed.");
      const response = await api<{ profile: SchedulingProfile }>("/api/team-members/" + encodeURIComponent(input.userId) + "/scheduling-profile", undefined, signal);
      return { profile: compactSchedulingProfile(response.profile, include) };
    }, input)
  },
  {
    name: "get_events_in_range",
    title: "Get owned events in range",
    description: "Read up to ten active events owned by the active user in a supplied range. It is for a reviewed change plan; it never returns another person’s private event details or events the active user cannot change.",
    inputSchema: schema({ startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" } }, ["startsAt", "endsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("get_events_in_range", "read", async () => {
      const response = await api<{ events: CalendarEvent[] }>("/api/calendar-events-in-range", { method: "POST", body: JSON.stringify(input) }, signal);
      return { events: response.events.slice(0, 10).map(compactEvent) };
    }, input)
  },
  {
    name: "find_availability",
    title: "Find availability",
    description: "Find free candidate slots for named attendee IDs within a supplied range. Optionally include a meeting office to receive fixed travel feedback. Returns free/busy-derived candidates only, never private event details.",
    inputSchema: schema(timeRangeProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("find_availability", "read", async () => {
      const response = await api<{ proposals: ScheduleCandidate[] }>("/api/proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return { candidates: compactCandidates(response.proposals) };
    }, input)
  },
  {
    name: "propose_schedule",
    title: "Propose a schedule",
    description: "Rank feasible slots using working hours, focus blocks, travel buffers, fixed office travel feedback, and stated time-of-day preferences. This does not create or change events.",
    inputSchema: schema(timeRangeProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("propose_schedule", "read", async () => {
      const response = await api<{ proposals: ScheduleCandidate[] }>("/api/proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return { proposals: compactCandidates(response.proposals) };
    }, input)
  },
  {
    name: "propose_recurring_schedule",
    title: "Propose a recurring schedule",
    description: "Find a stable weekly time across 2–26 named occurrences in a bounded range. If requestedStartTime is supplied, the base series uses that local time unless explicit flexibility is supplied. It checks each occurrence against busy time, protected focus blocks, work patterns, travel buffers, and stated preferences. A bounded number of one-off exceptions may preserve existing events without moving them. Returns short-lived proposal IDs only; it never creates or changes events.",
    inputSchema: schema(recurringScheduleProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt", "recurrence"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("propose_recurring_schedule", "read", async () => {
      const response = await api<{ proposals: RecurringProposal[] }>("/api/recurring-proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return { proposals: compactRecurringProposals(response.proposals) };
    }, input)
  },
  {
    name: "create_recurring_event_draft_from_proposal",
    title: "Create recurring event draft from proposal",
    description: "Create one visible pending recurring draft from an unexpired proposal returned by propose_recurring_schedule. The selected time, attendees, and exceptions are server-bound to that proposal and revalidated immediately. This cannot create a committed event or send invitations.",
    inputSchema: schema(recurringDraftFromProposalProperties, ["proposalId", "title"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("create_recurring_event_draft_from_proposal", "draft", async () => {
      const response = await api<{ draft: EventDraft }>("/api/recurring-event-drafts", { method: "POST", body: JSON.stringify(input) }, signal);
      return { draft: compactDraft(response.draft) };
    }, input)
  },
  {
    name: "propose_time_away_changes",
    title: "Propose time-away changes",
    description: "Preview a private time-away block plus cancellations for every active event the user owns in its range. Named owned events can instead be transferred only to an approved delegate. This read-only tool does not create, cancel, transfer, notify, or commit anything.",
    inputSchema: schema(timeAwayProperties, ["startsAt", "endsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("propose_time_away_changes", "read", async () => {
      const response = await api<{ plan: { timeAway: { startsAt: string; endsAt: string; title: string }; cancellations: unknown[]; transfers: unknown[] } }>("/api/time-away-proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return {
        timeAway: response.plan.timeAway,
        cancellationCount: response.plan.cancellations.length,
        cancellations: response.plan.cancellations.slice(0, 5),
        transferCount: response.plan.transfers.length,
        transfers: response.plan.transfers.slice(0, 5)
      };
    }, input)
  },
  {
    name: "create_time_away_change_set_draft",
    title: "Create time-away change-set draft",
    description: "Create one visible, pending time-away change-set draft from a reviewed plan. It includes a private time-away block, proposed cancellations, and optional transfers to an approved delegate. It never applies changes, sends notifications, or commits events.",
    inputSchema: schema(timeAwayProperties, ["startsAt", "endsAt"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("create_time_away_change_set_draft", "draft", async () => {
      const response = await api<{ changeSet: TimeAwayChangeSet }>("/api/time-away-change-sets", { method: "POST", body: JSON.stringify(input) }, signal);
      return { changeSet: compactChangeSet(response.changeSet) };
    }, input)
  },
  {
    name: "get_event_details",
    title: "Get event details",
    description: "Read one event only if it is already visible to the active user. Private events outside the user's access are returned only as Busy.",
    inputSchema: schema({ eventId: { type: "string" } }, ["eventId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => runTool("get_event_details", "read", async () => {
      const state = await api<CalendarState>("/api/calendar-state");
      const event = state.events.find((candidate) => candidate.id === input.eventId);
      if (!event) throw new Error("Event not found in the active user's visible calendar.");
      return { event: compactEvent(event) };
    }, input)
  },
  {
    name: "create_event_draft",
    title: "Create event draft",
    description: "Create a visible, pending one-time event draft owned by the active user. For a recurring series, first use propose_recurring_schedule, then create_recurring_event_draft_from_proposal. This never creates a committed event or sends invitations.",
    inputSchema: schema(singleEventProperties, ["calendarId", "title", "startsAt", "endsAt", "timeZone", "visibility"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("create_event_draft", "draft", async () => {
      const response = await api<{ draft: EventDraft }>("/api/event-drafts", { method: "POST", body: JSON.stringify(input) }, signal);
      return { draft: compactDraft(response.draft) };
    }, input)
  },
  {
    name: "update_event_draft",
    title: "Update event draft",
    description: "Update a visible pending one-time draft by ID and reviewed revision. Recurring scheduling fields are locked to their validated proposal; request a fresh proposal to change a recurring series. This never creates a committed event or sends invitations.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 }, ...singleEventProperties }, ["draftId", "expectedRevision"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("update_event_draft", "draft", async () => {
      const { draftId, ...changes } = input;
      const response = await api<{ draft: EventDraft }>("/api/event-drafts/" + draftId, { method: "PATCH", body: JSON.stringify(changes) }, signal);
      return { draft: compactDraft(response.draft) };
    }, input)
  },
  {
    name: "commit_event",
    title: "Commit event",
    description: "Commit is intentionally unavailable until the user reviews a draft in the app and approves a confirmation dialog. Do not use this tool to send invitations.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 } }, ["draftId", "expectedRevision"]),
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const id = crypto.randomUUID();
      const requestPreview = formatActivityPreview(input);
      const responsePreview = formatToolResult("blocked", { message: "Human confirmation is required. This build does not commit drafts or send invitations." });
      report({ id, tool: "commit_event", mode: "blocked", outcome: "blocked", summary: "Blocked: a human must review and confirm the draft in MyCP.", requestPreview, responsePreview });
      return responsePreview;
    }
  },
  {
    name: "discard_event_draft",
    title: "Discard event draft",
    description: "Discard one visible pending draft by ID and current revision. This is reversible only while the draft is pending.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 } }, ["draftId", "expectedRevision"]),
    annotations: { readOnlyHint: false },
    execute: async (input, { signal }) => runTool("discard_event_draft", "draft", async () => {
      return api("/api/event-drafts/" + input.draftId, { method: "DELETE", body: JSON.stringify({ expectedRevision: input.expectedRevision }) }, signal);
    }, input)
  },
  {
    name: "resolve_conflict",
    title: "Resolve conflict",
    description: "Suggest alternative time slots for one visible event. It never moves, cancels, or edits the event.",
    inputSchema: schema({ eventId: { type: "string" }, rangeStartsAt: { type: "string", format: "date-time" }, rangeEndsAt: { type: "string", format: "date-time" } }, ["eventId", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("resolve_conflict", "read", async () => {
      const state = await api<CalendarState>("/api/calendar-state", undefined, signal);
      const event = state.events.find((candidate) => candidate.id === input.eventId);
      if (!event) throw new Error("Event not found in the active user's visible calendar.");
      const durationMinutes = Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000);
      const response = await api<{ proposals: ScheduleCandidate[] }>("/api/proposals", {
        method: "POST",
        body: JSON.stringify({ attendeeIds: event.attendeeIds.filter((id) => id !== state.activeUserId), durationMinutes, rangeStartsAt: input.rangeStartsAt, rangeEndsAt: input.rangeEndsAt })
      }, signal);
      return { alternatives: compactCandidates(response.proposals) };
    }, input)
  }
];

export async function registerCalendarTools(): Promise<() => void> {
  if (!document.modelContext) return () => undefined;
  const controller = new AbortController();
  await Promise.all(calendarTools.map((tool) => document.modelContext!.registerTool(tool, { signal: controller.signal })));
  return () => controller.abort();
}

export { ACTIVITY_EVENT, STATE_CHANGED_EVENT };
