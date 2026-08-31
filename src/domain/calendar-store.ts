import {
  auditEntrySchema,
  calendarEventSchema,
  createEventInputSchema,
  demoDataSchema,
  eventDraftSchema,
  scheduleRequestSchema,
  updateEventInputSchema,
  type AuditEntry,
  type CalendarEvent,
  type DemoData,
  type EventDraft
} from "./contracts";
import { proposeSchedule } from "./scheduling";

export class CalendarStoreError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

export type CalendarState = Readonly<{
  activeUserId: string;
  people: DemoData["people"];
  calendars: DemoData["calendars"];
  events: CalendarEvent[];
  drafts: EventDraft[];
  auditEntries: AuditEntry[];
}>;

export type CalendarStoreSnapshot = Readonly<{
  data: DemoData;
  drafts: EventDraft[];
  auditEntries: AuditEntry[];
}>;

function canReadEvent(event: CalendarEvent, activeUserId: string, calendarOwnerId: string): boolean {
  return event.visibility === "public" || event.attendeeIds.includes(activeUserId) || calendarOwnerId === activeUserId;
}

function projectEvent(event: CalendarEvent, activeUserId: string, calendarOwnerId: string): CalendarEvent {
  if (canReadEvent(event, activeUserId, calendarOwnerId)) {
    return event;
  }

  return {
    ...event,
    title: "Busy",
    attendeeIds: [],
    location: undefined,
    agenda: undefined
  };
}

export class CalendarStore {
  private readonly people;
  private readonly calendars;
  private readonly events = new Map<string, CalendarEvent>();
  private readonly drafts = new Map<string, EventDraft>();
  private readonly auditEntries: AuditEntry[] = [];

  constructor(seed: DemoData) {
    this.people = seed.people;
    this.calendars = seed.calendars;
    for (const event of seed.events) {
      this.events.set(event.id, event);
    }
  }

  static fromSnapshot(snapshot: CalendarStoreSnapshot): CalendarStore {
    const store = new CalendarStore(demoDataSchema.parse(snapshot.data));
    for (const draft of snapshot.drafts) {
      store.drafts.set(draft.id, eventDraftSchema.parse(draft));
    }
    store.auditEntries.push(...snapshot.auditEntries.map((entry) => auditEntrySchema.parse(entry)));
    return store;
  }

  snapshot(): CalendarStoreSnapshot {
    return {
      data: {
        people: this.people,
        calendars: this.calendars,
        events: [...this.events.values()]
      },
      drafts: [...this.drafts.values()],
      auditEntries: this.auditEntries
    };
  }

  stateFor(activeUserId: string): CalendarState {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    return {
      activeUserId,
      people: this.people,
      calendars: this.calendars,
      events: [...this.events.values()].map((event) => {
        const calendar = this.getCalendar(event.calendarId);
        return projectEvent(event, activeUserId, calendar.ownerId);
      }),
      drafts: this.draftsFor(activeUserId),
      auditEntries: this.auditEntries.filter((entry) => entry.actorId === activeUserId)
    };
  }

  propose(activeUserId: string, input: unknown) {
    this.assertUser(activeUserId);
    const request = scheduleRequestSchema.parse(input);
    this.assertKnownAttendees(request.attendeeIds);
    try {
      return proposeSchedule([...this.events.values()], this.people, activeUserId, request);
    } catch (error) {
      throw new CalendarStoreError(400, error instanceof Error ? error.message : "Could not produce scheduling options.");
    }
  }

  create(activeUserId: string, input: unknown): CalendarEvent {
    this.assertUser(activeUserId);
    const event = this.createOwnedEvent(activeUserId, input, "confirmed");

    this.events.set(event.id, event);
    this.record("created", event, activeUserId);
    return event;
  }

  createDraft(activeUserId: string, input: unknown) {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    const event = this.createOwnedEvent(activeUserId, input, "draft");
    const createdAt = new Date().toISOString();
    const draft = eventDraftSchema.parse({
      id: crypto.randomUUID(),
      ownerId: activeUserId,
      revision: 1,
      event,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60_000).toISOString(),
      status: "pending"
    });
    this.drafts.set(draft.id, draft);
    this.recordDraft("drafted", draft.id, activeUserId, "Created a reviewable draft for “" + event.title + "”.");
    return draft;
  }

  discardDraft(activeUserId: string, draftId: string, expectedRevision: unknown): void {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new CalendarStoreError(404, "Draft not found or already expired.");
    }
    if (draft.ownerId !== activeUserId) {
      throw new CalendarStoreError(403, "You can only discard your own drafts.");
    }
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
      throw new CalendarStoreError(409, "This draft changed. Refresh and review it before discarding.");
    }
    this.drafts.delete(draftId);
    this.recordDraft("discarded", draftId, activeUserId, "Discarded the draft for “" + draft.event.title + "”.");
  }

  updateDraft(activeUserId: string, draftId: string, input: unknown): EventDraft {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new CalendarStoreError(404, "Draft not found or already expired.");
    }
    if (draft.ownerId !== activeUserId) {
      throw new CalendarStoreError(403, "You can only change your own drafts.");
    }
    const { expectedRevision, ...changes } = updateEventInputSchema.parse(input);
    if (expectedRevision !== draft.revision) {
      throw new CalendarStoreError(409, "This draft changed. Refresh and review it before updating.");
    }
    if (changes.calendarId && changes.calendarId !== draft.event.calendarId) {
      this.assertCalendarOwner(changes.calendarId, activeUserId);
    }
    if (changes.attendeeIds) {
      this.assertKnownAttendees(changes.attendeeIds);
    }
    const event = calendarEventSchema.parse({
      ...draft.event,
      ...changes,
      attendeeIds: changes.attendeeIds ? [...new Set([activeUserId, ...changes.attendeeIds])] : draft.event.attendeeIds,
      revision: draft.event.revision + 1,
      status: "draft"
    });
    const updated = eventDraftSchema.parse({ ...draft, event, revision: draft.revision + 1 });
    this.drafts.set(updated.id, updated);
    this.recordDraft("updated", updated.id, activeUserId, "Updated the reviewable draft for “" + updated.event.title + "”.");
    return updated;
  }

  update(activeUserId: string, eventId: string, input: unknown): CalendarEvent {
    this.assertUser(activeUserId);
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new CalendarStoreError(404, "Event not found.");
    }
    this.assertCalendarOwner(existing.calendarId, activeUserId);

    const { expectedRevision, ...changes } = updateEventInputSchema.parse(input);
    if (expectedRevision !== existing.revision) {
      throw new CalendarStoreError(409, "This event changed. Refresh and review the latest version before saving.");
    }
    if (changes.calendarId && changes.calendarId !== existing.calendarId) {
      this.assertCalendarOwner(changes.calendarId, activeUserId);
    }
    if (changes.attendeeIds) {
      this.assertKnownAttendees(changes.attendeeIds);
    }

    const updated = calendarEventSchema.parse({
      ...existing,
      ...changes,
      attendeeIds: changes.attendeeIds ? [...new Set([activeUserId, ...changes.attendeeIds])] : existing.attendeeIds,
      revision: existing.revision + 1
    });
    this.events.set(updated.id, updated);
    this.record(this.didMove(existing, updated) ? "moved" : "updated", updated, activeUserId);
    return updated;
  }

  private didMove(before: CalendarEvent, after: CalendarEvent): boolean {
    return before.startsAt !== after.startsAt || before.endsAt !== after.endsAt;
  }

  private createOwnedEvent(activeUserId: string, input: unknown, status: "confirmed" | "draft"): CalendarEvent {
    const parsed = createEventInputSchema.parse(input);
    const calendar = this.getCalendar(parsed.calendarId);
    this.assertCalendarOwner(calendar.id, activeUserId);
    this.assertKnownAttendees(parsed.attendeeIds ?? []);
    return calendarEventSchema.parse({
      ...parsed,
      id: crypto.randomUUID(),
      revision: 1,
      attendeeIds: [...new Set([activeUserId, ...(parsed.attendeeIds ?? [])])],
      status
    });
  }

  private record(action: AuditEntry["action"], event: CalendarEvent, activeUserId: string): void {
    const actionVerb = action === "created" ? "Created" : action === "moved" ? "Moved" : "Updated";
    this.auditEntries.unshift(
      auditEntrySchema.parse({
        id: crypto.randomUUID(),
        actor: "human",
        actorId: activeUserId,
        action,
        targetId: event.id,
        summary: `${actionVerb} “${event.title}”`,
        createdAt: new Date().toISOString()
      })
    );
  }

  private recordDraft(action: AuditEntry["action"], targetId: string, activeUserId: string, summary: string): void {
    this.auditEntries.unshift(
      auditEntrySchema.parse({
        id: crypto.randomUUID(),
        actor: "human",
        actorId: activeUserId,
        action,
        targetId,
        summary,
        createdAt: new Date().toISOString()
      })
    );
  }

  private draftsFor(activeUserId: string) {
    return [...this.drafts.values()].filter((draft) => draft.ownerId === activeUserId);
  }

  private removeExpiredDrafts(): void {
    const now = Date.now();
    for (const [id, draft] of this.drafts) {
      if (Date.parse(draft.expiresAt) <= now) {
        this.drafts.delete(id);
      }
    }
  }

  private assertUser(activeUserId: string): void {
    if (!this.people.some((person) => person.id === activeUserId)) {
      throw new CalendarStoreError(403, "Unknown active user.");
    }
  }

  private getCalendar(calendarId: string) {
    const calendar = this.calendars.find((candidate) => candidate.id === calendarId);
    if (!calendar) {
      throw new CalendarStoreError(404, "Calendar not found.");
    }
    return calendar;
  }

  private assertCalendarOwner(calendarId: string, activeUserId: string): void {
    if (this.getCalendar(calendarId).ownerId !== activeUserId) {
      throw new CalendarStoreError(403, "You can only change events on your own calendar.");
    }
  }

  private assertKnownAttendees(attendeeIds: readonly string[]): void {
    const unknownAttendee = attendeeIds.find((attendeeId) => !this.people.some((person) => person.id === attendeeId));
    if (unknownAttendee) {
      throw new CalendarStoreError(400, "One or more attendees are not known to this calendar.");
    }
  }
}
