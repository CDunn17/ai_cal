import {
  auditEntrySchema,
  calendarEventSchema,
  changeSetCommitConfirmationSchema,
  changeSetCommitReceiptSchema,
  commitDraftInputSchema,
  commitReceiptSchema,
  createEventInputSchema,
  demoDataSchema,
  draftCommitConfirmationSchema,
  eventDraftSchema,
  recurringScheduleRequestSchema,
  scheduleRequestSchema,
  schedulingProfileSchema,
  timeAwayChangeSetSchema,
  timeAwayInputSchema,
  updateEventInputSchema,
  type AuditEntry,
  type CalendarEvent,
  type ChangeSetCommitConfirmation,
  type ChangeSetCommitReceipt,
  type CommitReceipt,
  type DemoData,
  type DraftCommitConfirmation,
  type EventDraft,
  type SchedulingProfile,
  type TimeAwayChangeSet,
  type TimeAwayInput
} from "./contracts";
import { initialSchedulingProfiles } from "./scheduling-profiles";
import { demoData } from "./seed";
import { migrateOfficeId } from "./offices";
import { proposeRecurringSchedule, proposeSchedule } from "./scheduling";

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
  schedulingProfiles: SchedulingProfile[];
  calendars: DemoData["calendars"];
  events: CalendarEvent[];
  drafts: EventDraft[];
  changeSets: TimeAwayChangeSet[];
  auditEntries: AuditEntry[];
}>;

export type CalendarStoreSnapshot = Readonly<{
  data: DemoData;
  drafts: EventDraft[];
  auditEntries: AuditEntry[];
  commitConfirmations?: DraftCommitConfirmation[];
  changeSets?: TimeAwayChangeSet[];
  changeSetConfirmations?: ChangeSetCommitConfirmation[];
  changeSetCommitReceipts?: ChangeSetCommitReceipt[];
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

function migratePersistedOfficeIds(data: unknown): unknown {
  if (!data || typeof data !== "object" || !Array.isArray((data as { schedulingProfiles?: unknown }).schedulingProfiles)) return data;
  const stored = data as { schedulingProfiles: unknown[] } & Record<string, unknown>;
  return {
    ...stored,
    schedulingProfiles: stored.schedulingProfiles.map((profile) => {
      if (!profile || typeof profile !== "object") return profile;
      const candidate = profile as { defaultOfficeId?: unknown; weeklyWorkPattern?: unknown } & Record<string, unknown>;
      return {
        ...candidate,
        defaultOfficeId: migrateOfficeId(candidate.defaultOfficeId),
        weeklyWorkPattern: Array.isArray(candidate.weeklyWorkPattern)
          ? candidate.weeklyWorkPattern.map((workday) => {
              if (!workday || typeof workday !== "object") return workday;
              const day = workday as { officeId?: unknown } & Record<string, unknown>;
              return { ...day, officeId: migrateOfficeId(day.officeId) };
            })
          : candidate.weeklyWorkPattern
      };
    })
  };
}

function weekdayForEvent(event: CalendarEvent): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, weekday: "long" }).format(new Date(event.startsAt)).toLowerCase();
}

function localEventParts(instant: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export class CalendarStore {
  private readonly people;
  private readonly schedulingProfiles;
  private readonly calendars;
  private readonly events = new Map<string, CalendarEvent>();
  private readonly drafts = new Map<string, EventDraft>();
  private readonly auditEntries: AuditEntry[] = [];
  private readonly commitConfirmations = new Map<string, DraftCommitConfirmation>();
  private readonly changeSets = new Map<string, TimeAwayChangeSet>();
  private readonly changeSetConfirmations = new Map<string, ChangeSetCommitConfirmation>();
  private readonly changeSetCommitReceipts = new Map<string, ChangeSetCommitReceipt>();
  private readonly commitReceipts = new Map<string, CommitReceipt>();
  private readonly commitAttemptTimes = new Map<string, string[]>();

  constructor(seed: DemoData) {
    this.people = seed.people;
    this.schedulingProfiles = (seed.schedulingProfiles ?? initialSchedulingProfiles).map((profile) => schedulingProfileSchema.parse(profile));
    this.calendars = seed.calendars;
    for (const event of seed.events) {
      this.events.set(event.id, event);
    }
  }

  static fromSnapshot(snapshot: CalendarStoreSnapshot): CalendarStore {
    const store = new CalendarStore(demoDataSchema.parse(migratePersistedOfficeIds(snapshot.data)));
    for (const event of demoData.events) {
      if (!store.events.has(event.id)) store.events.set(event.id, event);
    }
    const previousOctoberStandup = store.events.get("alex-team-standup-oct");
    const currentOctoberStandup = demoData.events.find((event) => event.id === "alex-team-standup-oct");
    if (
      previousOctoberStandup?.revision === 1 &&
      previousOctoberStandup.startsAt === "2026-10-13T14:00:00.000Z" &&
      previousOctoberStandup.endsAt === "2026-10-13T14:30:00.000Z" &&
      currentOctoberStandup
    ) {
      store.events.set(currentOctoberStandup.id, currentOctoberStandup);
    }
    for (const draft of snapshot.drafts) {
      store.drafts.set(draft.id, eventDraftSchema.parse(draft));
    }
    store.auditEntries.push(...snapshot.auditEntries.map((entry) => auditEntrySchema.parse(entry)));
    for (const confirmation of snapshot.commitConfirmations ?? []) {
      const parsed = draftCommitConfirmationSchema.parse(confirmation);
      store.commitConfirmations.set(parsed.id, parsed);
    }
    for (const changeSet of snapshot.changeSets ?? []) {
      const parsed = timeAwayChangeSetSchema.parse(changeSet);
      store.changeSets.set(parsed.id, parsed);
    }
    for (const confirmation of snapshot.changeSetConfirmations ?? []) {
      const parsed = changeSetCommitConfirmationSchema.parse(confirmation);
      store.changeSetConfirmations.set(parsed.id, parsed);
    }
    for (const receipt of snapshot.changeSetCommitReceipts ?? []) {
      const parsed = changeSetCommitReceiptSchema.parse(receipt);
      store.changeSetCommitReceipts.set(parsed.key, parsed);
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
        schedulingProfiles: this.schedulingProfiles,
        calendars: this.calendars,
        events: [...this.events.values()]
      },
      drafts: [...this.drafts.values()],
      auditEntries: this.auditEntries,
      commitConfirmations: [...this.commitConfirmations.values()],
      changeSets: [...this.changeSets.values()],
      changeSetConfirmations: [...this.changeSetConfirmations.values()],
      changeSetCommitReceipts: [...this.changeSetCommitReceipts.values()],
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
      schedulingProfiles: this.schedulingProfiles,
      calendars: this.calendars,
      events: [...this.events.values()].filter((event) => event.status !== "cancelled").map((event) => {
        const calendar = this.getCalendar(event.calendarId);
        return projectEvent(event, activeUserId, calendar.ownerId);
      }),
      drafts: this.draftsFor(activeUserId),
      changeSets: this.changeSetsFor(activeUserId),
      auditEntries: this.auditEntries.filter((entry) => entry.actorId === activeUserId)
    };
  }

  propose(activeUserId: string, input: unknown) {
    this.assertUser(activeUserId);
    const request = scheduleRequestSchema.parse(input);
    this.assertKnownAttendees(request.attendeeIds);
    try {
      return proposeSchedule([...this.events.values()], this.people, this.schedulingProfiles, activeUserId, request);
    } catch (error) {
      throw new CalendarStoreError(400, error instanceof Error ? error.message : "Could not produce scheduling options.");
    }
  }

  proposeRecurring(activeUserId: string, input: unknown) {
    this.assertUser(activeUserId);
    const request = recurringScheduleRequestSchema.parse(input);
    this.assertKnownAttendees(request.attendeeIds);
    try {
      return proposeRecurringSchedule([...this.events.values()], this.people, this.schedulingProfiles, activeUserId, request);
    } catch (error) {
      throw new CalendarStoreError(400, error instanceof Error ? error.message : "Could not produce recurring scheduling options.");
    }
  }

  eventsInRange(activeUserId: string, input: unknown): CalendarEvent[] {
    this.assertUser(activeUserId);
    const parsed = timeAwayInputSchema.parse(input);
    return this.ownedActiveEventsInRange(activeUserId, parsed.startsAt, parsed.endsAt);
  }

  proposeTimeAway(activeUserId: string, input: unknown) {
    this.assertUser(activeUserId);
    const plan = this.timeAwayPlan(activeUserId, input);
    return {
      timeAway: { startsAt: plan.input.startsAt, endsAt: plan.input.endsAt, title: plan.input.title },
      cancellations: plan.cancellations.map((event) => this.changeEventProjection(event)),
      transfers: plan.transfers.map(({ event, newOwnerId }) => ({ ...this.changeEventProjection(event), newOwnerId }))
    };
  }

  createTimeAwayChangeSet(activeUserId: string, input: unknown): TimeAwayChangeSet {
    this.assertUser(activeUserId);
    this.removeExpiredDrafts();
    const plan = this.timeAwayPlan(activeUserId, input);
    const calendar = this.calendarForOwner(activeUserId);
    const timeAwayEvent = this.createOwnedEvent(activeUserId, {
      calendarId: calendar.id,
      title: plan.input.title,
      startsAt: plan.input.startsAt,
      endsAt: plan.input.endsAt,
      timeZone: calendar.timeZone,
      visibility: "private",
      attendeeIds: [],
      agenda: "Private time away. This draft changes nothing until human confirmation."
    }, "draft");
    const createdAt = new Date().toISOString();
    const changeSet = timeAwayChangeSetSchema.parse({
      id: crypto.randomUUID(),
      ownerId: activeUserId,
      revision: 1,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60_000).toISOString(),
      status: "pending",
      timeAwayEvent,
      cancellations: plan.cancellations.map((event) => ({ eventId: event.id, expectedRevision: event.revision })),
      transfers: plan.transfers.map(({ event, newOwnerId }) => ({ eventId: event.id, expectedRevision: event.revision, newOwnerId }))
    });
    this.changeSets.set(changeSet.id, changeSet);
    this.recordDraft("drafted", changeSet.id, activeUserId, "Created a reviewable time-away change set for “" + timeAwayEvent.title + "”.");
    return changeSet;
  }

  discardTimeAwayChangeSet(activeUserId: string, changeSetId: string, expectedRevision: unknown): void {
    const changeSet = this.getOwnedChangeSet(activeUserId, changeSetId, expectedRevision, "discarding");
    this.changeSets.delete(changeSet.id);
    this.invalidateChangeSetConfirmationsFor(changeSet.id);
    this.recordDraft("discarded", changeSet.id, activeUserId, "Discarded the time-away change set for “" + changeSet.timeAwayEvent.title + "”.");
  }

  prepareTimeAwayChangeSetCommit(activeUserId: string, changeSetId: string, expectedRevision: unknown): ChangeSetCommitConfirmation {
    const changeSet = this.getOwnedChangeSet(activeUserId, changeSetId, expectedRevision, "reviewing");
    this.invalidateChangeSetConfirmationsFor(changeSet.id);
    const confirmation = changeSetCommitConfirmationSchema.parse({
      id: crypto.randomUUID(),
      changeSetId: changeSet.id,
      ownerId: activeUserId,
      changeSetRevision: changeSet.revision,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    this.changeSetConfirmations.set(confirmation.id, confirmation);
    return confirmation;
  }

  commitTimeAwayChangeSet(activeUserId: string, changeSetId: string, input: unknown, idempotencyKey: string): CalendarEvent[] {
    this.assertUser(activeUserId);
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new CalendarStoreError(400, "An Idempotency-Key between 16 and 128 characters is required to apply a time-away change set.");
    }
    const receipt = this.changeSetCommitReceipts.get(idempotencyKey);
    if (receipt) {
      if (receipt.ownerId !== activeUserId || receipt.changeSetId !== changeSetId) {
        throw new CalendarStoreError(409, "This idempotency key belongs to a different time-away change set.");
      }
      return receipt.events;
    }
    this.recordCommitAttempt(activeUserId);
    const parsed = commitDraftInputSchema.parse(input);
    const changeSet = this.getOwnedChangeSet(activeUserId, changeSetId, parsed.expectedRevision, "committing");
    const confirmation = this.changeSetConfirmations.get(parsed.confirmationId);
    if (!confirmation || confirmation.changeSetId !== changeSet.id || confirmation.ownerId !== activeUserId || confirmation.changeSetRevision !== changeSet.revision || Date.parse(confirmation.expiresAt) <= Date.now()) {
      throw new CalendarStoreError(409, "This confirmation is no longer valid. Review the time-away changes again before applying them.");
    }
    const affected = [...changeSet.cancellations, ...changeSet.transfers].map((operation) => this.getOwnedActiveEvent(activeUserId, operation.eventId, operation.expectedRevision));
    const events: CalendarEvent[] = [];
    const timeAwayEvent = calendarEventSchema.parse({ ...changeSet.timeAwayEvent, status: "confirmed" });
    this.events.set(timeAwayEvent.id, timeAwayEvent);
    events.push(timeAwayEvent);
    this.record("time_away", timeAwayEvent, activeUserId);
    for (const operation of changeSet.cancellations) {
      const event = affected.find((candidate) => candidate.id === operation.eventId)!;
      const cancelled = calendarEventSchema.parse({ ...event, status: "cancelled", revision: event.revision + 1 });
      this.events.set(cancelled.id, cancelled);
      this.record("cancelled", cancelled, activeUserId);
    }
    for (const operation of changeSet.transfers) {
      const event = affected.find((candidate) => candidate.id === operation.eventId)!;
      const cancelled = calendarEventSchema.parse({ ...event, status: "cancelled", revision: event.revision + 1 });
      this.events.set(cancelled.id, cancelled);
      const targetCalendar = this.calendarForOwner(operation.newOwnerId);
      const transferred = calendarEventSchema.parse({
        ...event,
        id: crypto.randomUUID(),
        calendarId: targetCalendar.id,
        revision: 1,
        status: "confirmed",
        attendeeIds: [...new Set([...event.attendeeIds.filter((id) => id !== activeUserId), operation.newOwnerId])]
      });
      this.events.set(transferred.id, transferred);
      events.push(transferred);
      this.record("transferred", transferred, activeUserId);
    }
    this.changeSets.delete(changeSet.id);
    this.changeSetConfirmations.delete(confirmation.id);
    this.changeSetCommitReceipts.set(idempotencyKey, changeSetCommitReceiptSchema.parse({ key: idempotencyKey, ownerId: activeUserId, changeSetId, events }));
    this.trimChangeSetCommitReceipts();
    return events;
  }

  schedulingProfileFor(activeUserId: string, personId: string): SchedulingProfile {
    this.assertUser(activeUserId);
    this.assertUser(personId);
    const profile = this.schedulingProfiles.find((candidate) => candidate.personId === personId);
    if (!profile) throw new CalendarStoreError(404, "Scheduling profile not found.");
    return profile;
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
    this.assertRecurrenceMatchesStart(event);
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
    this.assertRecurrenceMatchesStart(updated);
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
    const event = calendarEventSchema.parse({
      ...parsed,
      id: crypto.randomUUID(),
      revision: 1,
      attendeeIds: [...new Set([activeUserId, ...(parsed.attendeeIds ?? [])])],
      status
    });
    this.assertRecurrenceMatchesStart(event);
    return event;
  }

  private record(action: AuditEntry["action"], event: CalendarEvent, activeUserId: string): void {
    const actionVerb = action === "created"
      ? "Created"
      : action === "moved"
        ? "Moved"
        : action === "committed"
          ? "Committed"
          : action === "cancelled"
            ? "Cancelled"
            : action === "transferred"
              ? "Transferred"
              : action === "time_away"
                ? "Added time away for"
                : "Updated";
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

  private changeSetsFor(activeUserId: string) {
    return [...this.changeSets.values()].filter((changeSet) => changeSet.ownerId === activeUserId);
  }

  private ownedActiveEventsInRange(activeUserId: string, startsAt: string, endsAt: string): CalendarEvent[] {
    const range = { startsAt, endsAt };
    return [...this.events.values()]
      .filter((event) => {
        const calendar = this.getCalendar(event.calendarId);
        return calendar.ownerId === activeUserId && (event.status === "confirmed" || event.status === "tentative") && Date.parse(event.startsAt) < Date.parse(range.endsAt) && Date.parse(range.startsAt) < Date.parse(event.endsAt);
      })
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  }

  private timeAwayPlan(activeUserId: string, input: unknown): {
    input: TimeAwayInput;
    cancellations: CalendarEvent[];
    transfers: Array<{ event: CalendarEvent; newOwnerId: string }>;
  } {
    const parsed = timeAwayInputSchema.parse(input);
    const affectedEvents = this.ownedActiveEventsInRange(activeUserId, parsed.startsAt, parsed.endsAt);
    const transferIds = new Set(parsed.transferEventIds);
    const unknownTransfer = parsed.transferEventIds.find((eventId) => !affectedEvents.some((event) => event.id === eventId));
    if (unknownTransfer) throw new CalendarStoreError(400, "A requested transfer must be an active event owned by you during the time-away range.");
    if (transferIds.size > 0) this.assertAuthorizedDelegate(activeUserId, parsed.transferToUserId!);
    return {
      input: parsed,
      cancellations: affectedEvents.filter((event) => !transferIds.has(event.id)),
      transfers: affectedEvents
        .filter((event) => transferIds.has(event.id))
        .map((event) => ({ event, newOwnerId: parsed.transferToUserId! }))
    };
  }

  private changeEventProjection(event: CalendarEvent) {
    return { id: event.id, revision: event.revision, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt };
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
    for (const [id, changeSet] of this.changeSets) {
      if (Date.parse(changeSet.expiresAt) <= now) {
        this.changeSets.delete(id);
        this.invalidateChangeSetConfirmationsFor(id);
      }
    }
    for (const [id, confirmation] of this.changeSetConfirmations) {
      if (Date.parse(confirmation.expiresAt) <= now || !this.changeSets.has(confirmation.changeSetId)) {
        this.changeSetConfirmations.delete(id);
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

  private getOwnedChangeSet(activeUserId: string, changeSetId: string, expectedRevision: unknown, action: "reviewing" | "committing" | "discarding"): TimeAwayChangeSet {
    this.removeExpiredDrafts();
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) throw new CalendarStoreError(404, "Time-away change set not found or already expired.");
    if (changeSet.ownerId !== activeUserId) throw new CalendarStoreError(403, "You can only review your own time-away change set.");
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision !== changeSet.revision) {
      throw new CalendarStoreError(409, "This time-away change set changed. Refresh and review it before " + action + ".");
    }
    return changeSet;
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

  private invalidateChangeSetConfirmationsFor(changeSetId: string): void {
    for (const [id, confirmation] of this.changeSetConfirmations) {
      if (confirmation.changeSetId === changeSetId) this.changeSetConfirmations.delete(id);
    }
  }

  private trimCommitReceipts(): void {
    while (this.commitReceipts.size > 50) {
      const oldestKey = this.commitReceipts.keys().next().value;
      if (oldestKey) this.commitReceipts.delete(oldestKey);
      else return;
    }
  }

  private trimChangeSetCommitReceipts(): void {
    while (this.changeSetCommitReceipts.size > 50) {
      const oldestKey = this.changeSetCommitReceipts.keys().next().value;
      if (oldestKey) this.changeSetCommitReceipts.delete(oldestKey);
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

  private calendarForOwner(ownerId: string) {
    const calendar = this.calendars.find((candidate) => candidate.ownerId === ownerId);
    if (!calendar) throw new CalendarStoreError(404, "Calendar not found for this team member.");
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

  private getOwnedActiveEvent(activeUserId: string, eventId: string, expectedRevision: number): CalendarEvent {
    const event = this.events.get(eventId);
    if (!event || !["confirmed", "tentative"].includes(event.status)) throw new CalendarStoreError(404, "An affected event is no longer active.");
    this.assertCalendarOwner(event.calendarId, activeUserId);
    if (event.revision !== expectedRevision) throw new CalendarStoreError(409, "An affected event changed. Review the time-away changes again.");
    return event;
  }

  private assertAuthorizedDelegate(activeUserId: string, delegateUserId: string): void {
    const allowedDelegates: Readonly<Record<string, readonly string[]>> = { alex: ["maya"] };
    if (!this.people.some((person) => person.id === delegateUserId) || !(allowedDelegates[activeUserId] ?? []).includes(delegateUserId)) {
      throw new CalendarStoreError(403, "This teammate is not an approved delegate for your calendar.");
    }
  }

  private assertRecurrenceMatchesStart(event: CalendarEvent): void {
    if (event.recurrence && weekdayForEvent(event) !== event.recurrence.weekday) {
      throw new CalendarStoreError(400, "A weekly draft must start on its configured recurrence weekday.");
    }
    if (!event.recurrence) return;
    const base = localEventParts(event.startsAt, event.timeZone);
    const exceptionStarts = new Set<string>();
    for (const exception of event.recurrence.exceptions) {
      const original = localEventParts(exception.originalStartsAt, event.timeZone);
      const dayOffset = (Date.UTC(Number(original.year), Number(original.month) - 1, Number(original.day)) - Date.UTC(Number(base.year), Number(base.month) - 1, Number(base.day))) / (24 * 60 * 60_000);
      if (original.hour !== base.hour || original.minute !== base.minute || dayOffset < 0 || dayOffset % 7 !== 0 || dayOffset / 7 >= event.recurrence.occurrenceCount || exceptionStarts.has(exception.originalStartsAt)) {
        throw new CalendarStoreError(400, "A recurrence exception must replace one distinct occurrence in this weekly series.");
      }
      exceptionStarts.add(exception.originalStartsAt);
    }
  }
}
