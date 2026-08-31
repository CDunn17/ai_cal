export type ToolActivity = Readonly<{
  id: string;
  tool: string;
  mode: "read" | "draft" | "blocked";
  outcome: "started" | "succeeded" | "failed" | "blocked";
  summary: string;
  occurredAt: string;
}>;

const ACTIVITY_EVENT = "coplan:tool-activity";
const STATE_CHANGED_EVENT = "coplan:calendar-state-changed";

type JsonRecord = Record<string, unknown>;

function schema(properties: JsonRecord, required: string[] = []): JsonRecord {
  return { type: "object", properties, required, additionalProperties: false };
}

function report(tool: string, mode: ToolActivity["mode"], outcome: ToolActivity["outcome"], summary: string): void {
  window.dispatchEvent(
    new CustomEvent<ToolActivity>(ACTIVITY_EVENT, {
      detail: { id: crypto.randomUUID(), tool, mode, outcome, summary, occurredAt: new Date().toISOString() }
    })
  );
}

function result(status: "ok" | "error" | "blocked", data: unknown): string {
  return JSON.stringify({ status, data });
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
  operation: () => Promise<unknown>
): Promise<string> {
  report(tool, mode, "started", "Agent started " + tool + ".");
  try {
    const data = await operation();
    report(tool, mode, "succeeded", "Agent completed " + tool + ".");
    if (mode === "draft") {
      window.dispatchEvent(new Event(STATE_CHANGED_EVENT));
    }
    return result("ok", data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar tool failed.";
    report(tool, mode, "failed", "Agent could not complete " + tool + ": " + message);
    return result("error", { message });
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
    description: "Read the active user's visible calendar range, calendars, preferences, pending drafts, and safe free/busy event projection.",
    inputSchema: schema({}),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => runTool("get_calendar_context", "read", () => api("/api/calendar-state"))
  },
  {
    name: "find_availability",
    title: "Find availability",
    description: "Find free candidate slots for named attendee IDs within a supplied range. Returns free/busy-derived candidates only, never private event details.",
    inputSchema: schema(timeRangeProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("find_availability", "read", async () => {
      const response = await api<{ proposals: unknown[] }>("/api/proposals", { method: "POST", body: JSON.stringify(input) }, signal);
      return { candidates: response.proposals };
    })
  },
  {
    name: "propose_schedule",
    title: "Propose a schedule",
    description: "Rank feasible slots using working hours, focus blocks, travel buffers, and stated time-of-day preferences. This does not create or change events.",
    inputSchema: schema(timeRangeProperties, ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("propose_schedule", "read", () => api("/api/proposals", { method: "POST", body: JSON.stringify(input) }, signal))
  },
  {
    name: "get_event_details",
    title: "Get event details",
    description: "Read one event only if it is already visible to the active user. Private events outside the user's access are returned only as Busy.",
    inputSchema: schema({ eventId: { type: "string" } }, ["eventId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => runTool("get_event_details", "read", async () => {
      const state = await api<{ events: Array<{ id: string }> }>("/api/calendar-state");
      const event = state.events.find((candidate) => candidate.id === input.eventId);
      if (!event) throw new Error("Event not found in the active user's visible calendar.");
      return { event };
    })
  },
  {
    name: "create_event_draft",
    title: "Create event draft",
    description: "Create a visible, pending event draft owned by the active user. This never creates a committed event or sends invitations.",
    inputSchema: schema(eventProperties, ["calendarId", "title", "startsAt", "endsAt", "timeZone", "visibility"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("create_event_draft", "draft", () => api("/api/event-drafts", { method: "POST", body: JSON.stringify(input) }, signal))
  },
  {
    name: "update_event_draft",
    title: "Update event draft",
    description: "Update a visible pending draft by ID and reviewed revision. This never creates a committed event or sends invitations.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 }, ...eventProperties }, ["draftId", "expectedRevision"]),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("update_event_draft", "draft", async () => {
      const { draftId, ...changes } = input;
      return api("/api/event-drafts/" + draftId, { method: "PATCH", body: JSON.stringify(changes) }, signal);
    })
  },
  {
    name: "commit_event",
    title: "Commit event",
    description: "Commit is intentionally unavailable until the user reviews a draft in the app and approves a confirmation dialog. Do not use this tool to send invitations.",
    inputSchema: schema({ draftId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 } }, ["draftId", "expectedRevision"]),
    annotations: { readOnlyHint: false },
    execute: async () => {
      report("commit_event", "blocked", "blocked", "Commit is waiting for the human confirmation milestone.");
      return result("blocked", { message: "Human confirmation is required. This build does not commit drafts or send invitations." });
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
    })
  },
  {
    name: "resolve_conflict",
    title: "Resolve conflict",
    description: "Suggest alternative time slots for one visible event. It never moves, cancels, or edits the event.",
    inputSchema: schema({ eventId: { type: "string" }, rangeStartsAt: { type: "string", format: "date-time" }, rangeEndsAt: { type: "string", format: "date-time" } }, ["eventId", "rangeStartsAt", "rangeEndsAt"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => runTool("resolve_conflict", "read", async () => {
      const state = await api<{ activeUserId: string; events: Array<{ id: string; attendeeIds: string[]; startsAt: string; endsAt: string }> }>("/api/calendar-state", undefined, signal);
      const event = state.events.find((candidate) => candidate.id === input.eventId);
      if (!event) throw new Error("Event not found in the active user's visible calendar.");
      const durationMinutes = Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000);
      return api("/api/proposals", {
        method: "POST",
        body: JSON.stringify({ attendeeIds: event.attendeeIds.filter((id) => id !== state.activeUserId), durationMinutes, rangeStartsAt: input.rangeStartsAt, rangeEndsAt: input.rangeEndsAt })
      }, signal);
    })
  }
];

export async function registerCalendarTools(): Promise<() => void> {
  if (!document.modelContext) return () => undefined;
  const controller = new AbortController();
  await Promise.all(calendarTools.map((tool) => document.modelContext!.registerTool(tool, { signal: controller.signal })));
  return () => controller.abort();
}

export { ACTIVITY_EVENT, STATE_CHANGED_EVENT };
