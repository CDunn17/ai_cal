import { describe, expect, it } from "vitest";
import { calendarTools, formatActivityPreview, formatToolResult, MAX_ACTIVITY_PREVIEW_BYTES, MAX_TOOL_OUTPUT_BYTES, registerCalendarTools } from "./calendar-tools";

describe("calendar WebMCP tools", () => {
  it("exposes the complete scoped calendar tool set", () => {
    expect(calendarTools.map((tool) => tool.name)).toEqual([
      "get_calendar_context",
      "get_user_scheduling_profile",
      "find_availability",
      "propose_schedule",
      "propose_recurring_schedule",
      "get_event_details",
      "create_event_draft",
      "update_event_draft",
      "commit_event",
      "discard_event_draft",
      "resolve_conflict"
    ]);
    expect(calendarTools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual([
      "get_calendar_context",
      "get_user_scheduling_profile",
      "find_availability",
      "propose_schedule",
      "propose_recurring_schedule",
      "get_event_details",
      "resolve_conflict"
    ]);
  });

  it("registers all tools with a lifecycle signal when WebMCP is available", async () => {
    const registered: WebMCP.ModelContextTool[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: WebMCP.ModelContextTool) => {
            registered.push(tool);
          }
        }
      }
    });

    const dispose = await registerCalendarTools();
    dispose();

    expect(registered).toHaveLength(11);
    delete (globalThis as { document?: unknown }).document;
  });

  it("keeps recurring scheduling read-only and bounds the series contract", () => {
    const recurringTool = calendarTools.find((tool) => tool.name === "propose_recurring_schedule");

    expect(recurringTool?.annotations?.readOnlyHint).toBe(true);
    expect(recurringTool?.inputSchema).toMatchObject({
      required: ["attendeeIds", "durationMinutes", "rangeStartsAt", "rangeEndsAt", "recurrence"],
      properties: {
        recurrence: {
          properties: { frequency: { enum: ["weekly"] }, occurrenceCount: { minimum: 2, maximum: 12 } }
        }
      }
    });
  });

  it("bounds tool output by UTF-8 byte size even when content is untrusted and large", () => {
    const output = formatToolResult("ok", { agenda: "🗓️".repeat(2_000) });

    expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    expect(JSON.parse(output)).toMatchObject({
      status: "ok",
      data: { truncated: true }
    });
  });

  it("bounds the human-visible WebMCP trace preview separately from the tool result", () => {
    const preview = formatActivityPreview({ agenda: "🗓️".repeat(1_000) });

    expect(new TextEncoder().encode(preview).byteLength).toBeLessThanOrEqual(MAX_ACTIVITY_PREVIEW_BYTES);
    expect(JSON.parse(preview)).toMatchObject({ truncated: true });
  });
});
