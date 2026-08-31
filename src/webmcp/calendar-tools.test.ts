import { describe, expect, it } from "vitest";
import { calendarTools, registerCalendarTools } from "./calendar-tools";

describe("calendar WebMCP tools", () => {
  it("exposes the complete scoped calendar tool set", () => {
    expect(calendarTools.map((tool) => tool.name)).toEqual([
      "get_calendar_context",
      "find_availability",
      "propose_schedule",
      "get_event_details",
      "create_event_draft",
      "update_event_draft",
      "commit_event",
      "discard_event_draft",
      "resolve_conflict"
    ]);
    expect(calendarTools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual([
      "get_calendar_context",
      "find_availability",
      "propose_schedule",
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

    expect(registered).toHaveLength(9);
    delete (globalThis as { document?: unknown }).document;
  });
});
