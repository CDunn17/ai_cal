import type { CalendarEvent, EventDraft, ScheduleCandidate } from "../domain/contracts";
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

function compactCandidates(candidates: ScheduleCandidate[]) {
  return candidates.slice(0, 3).map((candidate) => ({
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    score: candidate.score,
    reasons: candidate.reasons.slice(0, 2).map((reason) => clip(reason, 140)),
    warnings: candidate.warnings.slice(0, 1).map((warning) => clip(warning, 140))
  }));
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
  rangeStartsAt: { type: "string", format: "date-time" },
  rangeEndsAt: { type: "string", format: "date-time" }
};

const eventProperties = {
  calendarId: { type: "string", description: "Calendar ID owned by the active user." },
  title: { type: "string", maxLength: 140 },
  startsAt: { type: "string", format: "date-time" },
  endsAt: { type: "string", format: "date-time" },
  timeZone: { type: "string", description: "IANA timezone, for example America/New_York." },
  visibility: { type: "string", enum: ["public", "private"] },
  attendeeIds: { type: "array", items: { type: "string" }, maxItems: 20 },
  location: { type: "string", maxLength: 160 },
  agenda: { type: "string", maxLength: 2000 }
};

export const calendarTools: WebMCP.ModelContextTool[] = [
  {
    name: "get_calendar_context",
    title: "Get calendar context",
    description: "Read the active user's calendar identities, up to three pending drafts, and a count of visible events. It never returns a full event list.",
    inputSchema: schema({}),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => runTool("get_calendar_context", "read", async () => {
      const state = await api<CalendarState>("/api/calendar-state");
      return {
        activeUserId: state.activeUserId,
        calendars: state.calendars.map((calendar) => ({ id: calendar.id, name: clip(calendar.name, 80), timeZone: calendar.timeZone })),
        pendingDrafts: state.drafts.slice(0, 3).map(compactDraft),
        visibleEventCount: state.events.length
      };
    }, {})
  },
  {
    name: "find_availability",
    title: "Find availability",
    description: "Find free candidate slots for named attendee IDs within a supplied range. Returns free/busy-derived candidates only, never private event details.",
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
    description: "Rank feasible slots using working hours, focus blocks, travel buffers, and stated time-of-day preferences. This does not create or change events.",
    inputSchema: schema(timeRangeProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("propose_schedule", "read", async () => {
      const response = await api<{ proposals: ScheduleCandidate[] }>("/api/proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return { proposals: compactCandidates(response.proposals) };
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
    description: "Create a visible, pending event draft owned by the active user. This never creates a committed event or sends invitations.",
    inputSchema: schema(eventProperties, ["calendarId", "title", "startsAt", "endsAt", "timeZone", "visibility"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("create_event_draft", "draft", async () => {
      const response = await api<{ draft: EventDraft }>("/api/event-drafts", { method: "POST", body: JSON.stringify(input) }, signal);
      return { draft: compactDraft(response.draft) };
    }, input)
  },
  {
    name: "update_event_draft",
    title: "Update event draft",
    description: "Update a visible pending draft by ID and reviewed revision. This never creates a committed event or sends invitations.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 }, ...eventProperties }, ["draftId", "expectedRevision"]),
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
