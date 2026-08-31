import { describe, expect, it } from "vitest";
import { CalendarStore, CalendarStoreError } from "./calendar-store";
import { demoData } from "./seed";

describe("CalendarStore", () => {
  it("redacts private events the active user cannot read", () => {
    const state = new CalendarStore(demoData).stateFor("alex");
    const privateEvent = state.events.find((event) => event.id === "maya-focus-tue");

    expect(privateEvent).toMatchObject({ title: "Busy", attendeeIds: [] });
    expect(privateEvent?.location).toBeUndefined();
    expect(privateEvent?.agenda).toBeUndefined();
  });

  it("creates, updates, and audits an event on the active user's calendar", () => {
    const store = new CalendarStore(demoData);
    const created = store.create("alex", {
      calendarId: "alex-main",
      title: "Launch review",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      attendeeIds: ["maya", "sam"]
    });
    const updated = store.update("alex", created.id, {
      expectedRevision: created.revision,
      startsAt: "2026-09-10T18:30:00.000Z",
      endsAt: "2026-09-10T19:15:00.000Z"
    });
    const state = store.stateFor("alex");

    expect(updated.revision).toBe(2);
    expect(updated.attendeeIds).toEqual(["alex", "maya", "sam"]);
    expect(state.auditEntries.map((entry) => entry.action)).toEqual(["moved", "created"]);
  });

  it("rejects a write to a calendar the active user does not own", () => {
    const store = new CalendarStore(demoData);

    expect(() =>
      store.create("alex", {
        calendarId: "maya-main",
        title: "Nope",
        startsAt: "2026-09-10T18:00:00.000Z",
        endsAt: "2026-09-10T18:45:00.000Z",
        timeZone: "America/Los_Angeles",
        visibility: "public"
      })
    ).toThrow(new CalendarStoreError(403, "You can only change events on your own calendar."));
  });

  it("keeps proposed events as reviewable drafts until a later commit step", () => {
    const store = new CalendarStore(demoData);
    const draft = store.createDraft("alex", {
      calendarId: "alex-main",
      title: "Launch review",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      attendeeIds: ["maya", "sam"]
    });

    expect(draft.event.status).toBe("draft");
    expect(store.stateFor("alex").events).toHaveLength(demoData.events.length);
    expect(store.stateFor("alex").drafts).toEqual([draft]);

    store.discardDraft("alex", draft.id, draft.revision);
    expect(store.stateFor("alex").drafts).toEqual([]);
    expect(store.stateFor("alex").auditEntries[0].action).toBe("discarded");
  });
});
