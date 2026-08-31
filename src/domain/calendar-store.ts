import {
  auditEntrySchema,
  calendarEventSchema,
  commitDraftInputSchema,
  commitReceiptSchema,
  createEventInputSchema,
  demoDataSchema,
  draftCommitConfirmationSchema,
  eventDraftSchema,
  scheduleRequestSchema,
  updateEventInputSchema,
  type AuditEntry,
  type CalendarEvent,
  type CommitReceipt,
  type DemoData,
  type DraftCommitConfirmation,
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
  commitConfirmations?: DraftCommitConfirmation[];
  commitReceipts?: CommitReceipt[];
  commitAttemptTimes?: Readonly<Record<string, string[]>>;
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
  private readonly commitConfirmations = new Map<string, DraftCommitConfirmation>();
  private readonly commitReceipts = new Map<string, CommitReceipt>();
  private readonly commitAttemptTimes = new Map<string, string[]>();

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
    for (const confirmation of snapshot.commitConfirmations ?? []) {
      const parsed = draftCommitConfirmationSchema.parse(confirmation);
      store.commitConfirmations.set(parsed.id, parsed);
    }
    for (const receipt of snapshot.commitReceipts ?? []) {
      const parsed = commitReceiptSchema.parse(receipt);
      store.commitReceipts.set(parsed.key, parsed);
    }
    for (const [ownerId, attempts] of Object.entries(snapshot.commitAttemptTimes ?? {})) {
      store.commitAttemptTimes.set(ownerId, attempts.filter((attempt) => !Number.isNaN(Date.parse(attempt))));
    }
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
      auditEntries: this.auditEntries,
      commitConfirmations: [...this.commitConfirmations.values()],
      commitReceipts: [...this.commitReceipts.values()],
      commitAttemptTimes: Object.fromEntries(this.commitAttemptTimes)
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
    this.invalidateConfirmationsFor(draftId);
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
    this.invalidateConfirmationsFor(updated.id);
    this.recordDraft("updated", updated.id, activeUserId, "Updated the reviewable draft for “" + updated.event.title + "”.");
    return updated;
  }

  prepareDraftCommit(activeUserId: string, draftId: string, expectedRevision: unknown): DraftCommitConfirmation {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    const draft = this.getOwnedDraft(activeUserId, draftId, expectedRevision, "reviewing");
    for (const [id, confirmation] of this.commitConfirmations) {
      if (confirmation.draftId === draft.id) this.commitConfirmations.delete(id);
    }
    const confirmation = draftCommitConfirmationSchema.parse({
      id: crypto.randomUUID(),
      draftId: draft.id,
      ownerId: activeUserId,
      draftRevision: draft.revision,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    this.commitConfirmations.set(confirmation.id, confirmation);
    return confirmation;
  }

  commitDraft(activeUserId: string, draftId: string, input: unknown, idempotencyKey: string): CalendarEvent {
    this.assertUser(activeUserId);
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new CalendarStoreError(400, "An Idempotency-Key between 16 and 128 characters is required.");
    }
    const receipt = this.commitReceipts.get(idempotencyKey);
    if (receipt) {
      if (receipt.ownerId !== activeUserId || receipt.draftId !== draftId) {
        throw new CalendarStoreError(409, "This idempotency key belongs to a different commit request.");
      }
      return receipt.event;
    }
    this.recordCommitAttempt(activeUserId);
    this.removeExpiredDrafts();
    const parsed = commitDraftInputSchema.parse(input);
    const draft = this.getOwnedDraft(activeUserId, draftId, parsed.expectedRevision, "committing");
    const confirmation = this.commitConfirmations.get(parsed.confirmationId);
    if (!confirmation || confirmation.draftId !== draft.id || confirmation.ownerId !== activeUserId || confirmation.draftRevision !== draft.revision || Date.parse(confirmation.expiresAt) <= Date.now()) {
      throw new CalendarStoreError(409, "This confirmation is no longer valid. Review the draft again before committing.");
    }

    const event = calendarEventSchema.parse({ ...draft.event, status: "confirmed" });
    this.events.set(event.id, event);
    this.drafts.delete(draft.id);
    this.commitConfirmations.delete(confirmation.id);
    this.commitReceipts.set(idempotencyKey, commitReceiptSchema.parse({ key: idempotencyKey, ownerId: activeUserId, draftId, event }));
    this.trimCommitReceipts();
    this.record("committed", event, activeUserId);
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
    const actionVerb = action === "created" ? "Created" : action === "moved" ? "Moved" : action === "committed" ? "Committed" : "Updated";
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
    for (const [id, confirmation] of this.commitConfirmations) {
      if (Date.parse(confirmation.expiresAt) <= now || !this.drafts.has(confirmation.draftId)) {
        this.commitConfirmations.delete(id);
      }
    }
  }

  private getOwnedDraft(activeUserId: string, draftId: string, expectedRevision: unknown, action: "reviewing" | "committing"): EventDraft {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new CalendarStoreError(404, "Draft not found or already expired.");
    if (draft.ownerId !== activeUserId) throw new CalendarStoreError(403, "You can only commit your own drafts.");
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
      throw new CalendarStoreError(409, `This draft changed. Refresh and review it before ${action}.`);
    }
    return draft;
  }

  private recordCommitAttempt(activeUserId: string): void {
    const now = Date.now();
    const recent = (this.commitAttemptTimes.get(activeUserId) ?? []).filter((attempt) => now - Date.parse(attempt) < 60_000);
    if (recent.length >= 3) throw new CalendarStoreError(409, "Too many commit attempts. Wait one minute and review the draft again.");
    recent.push(new Date(now).toISOString());
    this.commitAttemptTimes.set(activeUserId, recent);
  }

  private invalidateConfirmationsFor(draftId: string): void {
    for (const [id, confirmation] of this.commitConfirmations) {
      if (confirmation.draftId === draftId) this.commitConfirmations.delete(id);
    }
  }

  private trimCommitReceipts(): void {
    while (this.commitReceipts.size > 50) {
      const oldestKey = this.commitReceipts.keys().next().value;
      if (oldestKey) this.commitReceipts.delete(oldestKey);
      else return;
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
