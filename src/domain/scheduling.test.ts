import { describe, expect, it } from "vitest";
import { demoData } from "./seed";
import { busyBlocksFor, eventsOverlap } from "./scheduling";

describe("scheduling foundations", () => {
  it("returns deterministic busy blocks for an attendee", () => {
    expect(busyBlocksFor(demoData.events, "maya")).toEqual([
      {
        eventId: "maya-focus-tue",
        startsAt: "2026-09-08T18:00:00.000Z",
        endsAt: "2026-09-08T20:00:00.000Z"
      },
      {
        eventId: "alex-design-review",
        startsAt: "2026-09-09T18:00:00.000Z",
        endsAt: "2026-09-09T19:00:00.000Z"
      }
    ]);
  });

  it("detects overlapping event intervals", () => {
    expect(
      eventsOverlap(
        { startsAt: "2026-09-08T18:00:00.000Z", endsAt: "2026-09-08T19:00:00.000Z", eventId: "a" },
        { startsAt: "2026-09-08T18:30:00.000Z", endsAt: "2026-09-08T19:30:00.000Z", eventId: "b" }
      )
    ).toBe(true);
  });
});
