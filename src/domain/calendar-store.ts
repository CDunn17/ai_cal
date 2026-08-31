import {
  auditEntrySchema,
  calendarEventSchema,
  createEventInputSchema,
  updateEventInputSchema,
  type AuditEntry,
  type CalendarEvent,
  type DemoData
} from "./contracts";

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
  private readonly auditEntries: AuditEntry[] = [];

  constructor(seed: DemoData) {
    this.people = seed.people;
    this.calendars = seed.calendars;
    for (const event of seed.events) {
      this.events.set(event.id, event);
    }
  }

  stateFor(activeUserId: string): CalendarState {
    this.assertUser(activeUserId);
    return {
      activeUserId,
      people: this.people,
      calendars: this.calendars,
      events: [...this.events.values()].map((event) => {
        const calendar = this.getCalendar(event.calendarId);
        return projectEvent(event, activeUserId, calendar.ownerId);
      }),
      auditEntries: this.auditEntries.filter((entry) => entry.actorId === activeUserId)
    };
  }

  create(activeUserId: string, input: unknown): CalendarEvent {
    this.assertUser(activeUserId);
    const parsed = createEventInputSchema.parse(input);
    const calendar = this.getCalendar(parsed.calendarId);
    this.assertCalendarOwner(calendar.id, activeUserId);
    this.assertKnownAttendees(parsed.attendeeIds ?? []);

    const event = calendarEventSchema.parse({
      ...parsed,
      id: crypto.randomUUID(),
      revision: 1,
      attendeeIds: [...new Set([activeUserId, ...(parsed.attendeeIds ?? [])])],
      status: "confirmed"
    });

    this.events.set(event.id, event);
    this.record("created", event, activeUserId);
    return event;
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
