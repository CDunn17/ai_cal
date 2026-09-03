import { describe, expect, it } from "vitest";
import { demoData } from "./seed";
import { busyBlocksFor, eventsOverlap, proposeRecurringSchedule, proposeSchedule } from "./scheduling";

describe("scheduling foundations", () => {
  it("returns deterministic busy blocks for an attendee", () => {
    expect(busyBlocksFor(demoData.events, "maya")).toEqual(expect.arrayContaining([
      {
        eventId: "maya-roadmap-mon",
        startsAt: "2026-09-07T20:00:00.000Z",
        endsAt: "2026-09-07T21:00:00.000Z"
      },
      {
        eventId: "maya-focus-tue",
        startsAt: "2026-09-08T18:00:00.000Z",
        endsAt: "2026-09-08T20:00:00.000Z"
      },
      {
        eventId: "alex-design-review",
        startsAt: "2026-09-09T18:00:00.000Z",
        endsAt: "2026-09-09T19:00:00.000Z"
      },
      {
        eventId: "maya-partner-brief-thu",
        startsAt: "2026-09-10T19:30:00.000Z",
        endsAt: "2026-09-10T20:15:00.000Z"
      },
      {
        eventId: "sam-retrospective-fri",
        startsAt: "2026-09-11T18:00:00.000Z",
        endsAt: "2026-09-11T19:00:00.000Z"
      },
      {
        eventId: "alex-launch-readout-oct",
        startsAt: "2026-10-15T18:00:00.000Z",
        endsAt: "2026-10-15T19:00:00.000Z"
      }
    ]));
  });

  it("detects overlapping event intervals", () => {
    expect(
      eventsOverlap(
        { startsAt: "2026-09-08T18:00:00.000Z", endsAt: "2026-09-08T19:00:00.000Z", eventId: "a" },
        { startsAt: "2026-09-08T18:30:00.000Z", endsAt: "2026-09-08T19:30:00.000Z", eventId: "b" }
      )
    ).toBe(true);
  });

  it("ranks valid slots without exposing or colliding with private busy time", () => {
    const proposals = proposeSchedule(demoData.events, demoData.people, demoData.schedulingProfiles ?? [], "alex", {
      attendeeIds: ["maya", "sam"],
      durationMinutes: 45,
      rangeStartsAt: "2026-09-08T12:00:00.000Z",
      rangeEndsAt: "2026-09-09T00:00:00.000Z"
    });

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      startsAt: "2026-09-08T20:15:00.000Z",
      endsAt: "2026-09-08T21:00:00.000Z"
    });
    expect(proposals[0].reasons).toContain("Fits everyone’s working hours and travel buffers.");
  });

  it("returns fixed office travel feedback without exposing event details", () => {
    const proposals = proposeSchedule(demoData.events, demoData.people, demoData.schedulingProfiles ?? [], "alex", {
      attendeeIds: ["maya", "sam"],
      durationMinutes: 45,
      officeId: "downtown-manhattan",
      rangeStartsAt: "2026-09-08T12:00:00.000Z",
      rangeEndsAt: "2026-09-09T00:00:00.000Z"
    });

    expect(proposals[0].reasons).toContain("Meeting at Downtown Manhattan.");
    expect(proposals[0].reasons).toContain("Maya Chen works remotely that day; no office commute is assumed.");
  });

  it("enforces recurring focus blocks that are not calendar events", () => {
    const proposals = proposeSchedule(demoData.events, demoData.people, demoData.schedulingProfiles ?? [], "alex", {
      attendeeIds: ["maya", "sam"],
      durationMinutes: 45,
      rangeStartsAt: "2026-09-09T17:00:00.000Z",
      rangeEndsAt: "2026-09-09T18:00:00.000Z"
    });

    expect(proposals).toEqual([]);
  });

  it("finds one weekly time that works for every bounded occurrence", () => {
    const proposals = proposeRecurringSchedule(demoData.events, demoData.people, demoData.schedulingProfiles ?? [], "alex", {
      attendeeIds: ["sam"],
      durationMinutes: 30,
      rangeStartsAt: "2026-09-08T13:00:00.000Z",
      rangeEndsAt: "2026-10-07T00:00:00.000Z",
      maxExceptions: 0,
      recurrence: { frequency: "weekly", weekday: "tuesday", occurrenceCount: 4 }
    });

    expect(proposals).not.toEqual([]);
    expect(proposals[0]).toMatchObject({ recurrence: { frequency: "weekly", weekday: "tuesday", occurrenceCount: 4 } });
    expect(proposals[0].occurrences).toHaveLength(4);
    expect(proposals[0].occurrences.map((occurrence) => occurrence.startsAt)).toEqual([
      "2026-09-08T13:00:00.000Z",
      "2026-09-15T13:00:00.000Z",
      "2026-09-22T13:00:00.000Z",
      "2026-09-29T13:00:00.000Z"
    ]);
    expect(proposals[0].reasons[0]).toContain("All 4 weekly tuesday occurrences fit");
  });

  it("uses one bounded exception instead of moving an existing meeting", () => {
    const proposals = proposeRecurringSchedule(demoData.events, demoData.people, demoData.schedulingProfiles ?? [], "alex", {
      attendeeIds: ["sam"],
      durationMinutes: 30,
      rangeStartsAt: "2026-09-08T13:00:00.000Z",
      rangeEndsAt: "2027-03-03T00:00:00.000Z",
      maxExceptions: 1,
      recurrence: { frequency: "weekly", weekday: "tuesday", occurrenceCount: 26 }
    });

    expect(proposals[0]).toMatchObject({
      recurrence: {
        frequency: "weekly",
        weekday: "tuesday",
        occurrenceCount: 26,
        exceptions: [{ originalStartsAt: "2026-10-20T13:00:00.000Z", startsAt: "2026-10-20T14:15:00.000Z" }]
      }
    });
    expect(proposals[0].reasons).toContain("1 one-off exception keeps an existing meeting unchanged.");
  });
});
