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

  it("returns a versioned scheduling profile without calendar-event content", () => {
    const profile = new CalendarStore(demoData).schedulingProfileFor("alex", "maya");

    expect(profile).toMatchObject({
      personId: "maya",
      revision: 1,
      defaultOfficeId: "newark-nj",
      meetingPreferences: { preferredMeetingWindow: "afternoon" }
    });
    expect(profile.recurringFocusBlocks).toContainEqual({ weekday: "wednesday", start: "10:00", end: "11:00" });
  });

  it("hydrates legacy persisted state with safe scheduling-profile defaults", () => {
    const legacyData = { ...demoData, schedulingProfiles: undefined };
    const state = new CalendarStore(legacyData).stateFor("alex");

    expect(state.schedulingProfiles).toHaveLength(3);
    expect(state.schedulingProfiles.find((profile) => profile.personId === "maya")).toMatchObject({
      defaultOfficeId: "newark-nj",
      recurringFocusBlocks: [{ weekday: "wednesday", start: "10:00", end: "11:00" }]
    });
  });

  it("migrates legacy office IDs in persisted scheduling profiles", () => {
    const current = new CalendarStore(demoData).snapshot();
    const legacySnapshot = {
      ...current,
      data: {
        ...current.data,
        schedulingProfiles: current.data.schedulingProfiles?.map((profile) => ({
          ...profile,
          defaultOfficeId: profile.defaultOfficeId === "downtown-manhattan" ? "new-york-hq" : "san-francisco-studio",
          weeklyWorkPattern: profile.weeklyWorkPattern.map((workday) => ({
            ...workday,
            officeId: workday.officeId === "downtown-manhattan" ? "new-york-hq" : workday.officeId === "newark-nj" ? "san-francisco-studio" : undefined
          }))
        }))
      }
    } as unknown as Parameters<typeof CalendarStore.fromSnapshot>[0];

    const state = CalendarStore.fromSnapshot(legacySnapshot).stateFor("alex");

    expect(state.schedulingProfiles.find((profile) => profile.personId === "maya")?.defaultOfficeId).toBe("newark-nj");
    expect(state.schedulingProfiles.find((profile) => profile.personId === "alex")?.defaultOfficeId).toBe("downtown-manhattan");
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

    const updated = store.updateDraft("alex", draft.id, {
      expectedRevision: draft.revision,
      title: "Refined launch review"
    });
    expect(updated.revision).toBe(2);
    expect(updated.event.title).toBe("Refined launch review");

    store.discardDraft("alex", updated.id, updated.revision);
    expect(store.stateFor("alex").drafts).toEqual([]);
    expect(store.stateFor("alex").auditEntries[0].action).toBe("discarded");
  });

  it("round-trips drafts and audit history through a persistence snapshot", () => {
    const original = new CalendarStore(demoData);
    const draft = original.createDraft("alex", {
      calendarId: "alex-main",
      title: "Persist me",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "private"
    });
    const restored = CalendarStore.fromSnapshot(original.snapshot());

    expect(restored.stateFor("alex").drafts).toEqual([draft]);
    expect(restored.stateFor("alex").auditEntries[0]).toMatchObject({ action: "drafted", targetId: draft.id });
  });

  it("adds newly introduced fixed demo events to an older persisted snapshot once", () => {
    const current = new CalendarStore(demoData).snapshot();
    const legacySnapshot = {
      ...current,
      data: {
        ...current.data,
        events: current.data.events.filter((event) => event.id !== "sam-retrospective-fri")
      }
    };

    const restored = CalendarStore.fromSnapshot(legacySnapshot);
    const restoredEvents = restored.stateFor("alex").events.filter((event) => event.id === "sam-retrospective-fri");

    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]).toMatchObject({ title: "Sprint retrospective", calendarId: "sam-main" });
  });

  it("commits a draft only after a current human confirmation and makes retries idempotent", () => {
    const store = new CalendarStore(demoData);
    const draft = store.createDraft("alex", {
      calendarId: "alex-main",
      title: "Approved launch review",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      attendeeIds: ["maya"]
    });
    const confirmation = store.prepareDraftCommit("alex", draft.id, draft.revision);
    const key = "commit-retry-key-0001";
    const committed = store.commitDraft("alex", draft.id, { expectedRevision: draft.revision, confirmationId: confirmation.id }, key);
    const retry = store.commitDraft("alex", draft.id, { expectedRevision: draft.revision, confirmationId: confirmation.id }, key);

    expect(committed.status).toBe("confirmed");
    expect(retry).toEqual(committed);
    expect(store.stateFor("alex").drafts).toEqual([]);
    expect(store.stateFor("alex").events.find((event) => event.id === committed.id)).toEqual(committed);
    expect(store.stateFor("alex").auditEntries[0]).toMatchObject({ action: "committed", targetId: committed.id });
  });

  it("rejects commits without a current confirmation or after a draft revision changes", () => {
    const store = new CalendarStore(demoData);
    const draft = store.createDraft("alex", {
      calendarId: "alex-main",
      title: "Needs review",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "private"
    });
    const confirmation = store.prepareDraftCommit("alex", draft.id, draft.revision);
    const updated = store.updateDraft("alex", draft.id, { expectedRevision: draft.revision, title: "Changed after review" });

    expect(() => store.commitDraft("alex", draft.id, { expectedRevision: draft.revision, confirmationId: confirmation.id }, "stale-confirmation-0001"))
      .toThrow(new CalendarStoreError(409, "This draft changed. Refresh and review it before committing."));
    expect(() => store.commitDraft("alex", updated.id, { expectedRevision: updated.revision, confirmationId: crypto.randomUUID() }, "missing-confirmation-01"))
      .toThrow(new CalendarStoreError(409, "This confirmation is no longer valid. Review the draft again before committing."));
  });

  it("rate-limits repeated invalid commit attempts", () => {
    const store = new CalendarStore(demoData);
    const draft = store.createDraft("alex", {
      calendarId: "alex-main",
      title: "Rate limited review",
      startsAt: "2026-09-10T18:00:00.000Z",
      endsAt: "2026-09-10T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "private"
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => store.commitDraft("alex", draft.id, { expectedRevision: draft.revision, confirmationId: crypto.randomUUID() }, `invalid-attempt-key-${attempt}`))
        .toThrow(new CalendarStoreError(409, "This confirmation is no longer valid. Review the draft again before committing."));
    }
    expect(() => store.commitDraft("alex", draft.id, { expectedRevision: draft.revision, confirmationId: crypto.randomUUID() }, "invalid-attempt-key-4"))
      .toThrow(new CalendarStoreError(409, "Too many commit attempts. Wait one minute and review the draft again."));
  });
});
