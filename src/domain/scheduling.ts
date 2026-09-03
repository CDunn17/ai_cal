import {
  recurringScheduleCandidateSchema,
  scheduleCandidateSchema,
  type CalendarEvent,
  type Person,
  type RecurringScheduleCandidate,
  type RecurringScheduleRequest,
  type ScheduleCandidate,
  type ScheduleRequest,
  type SchedulingProfile,
  type Weekday
} from "./contracts";
import { designatedOfficeFor, formatTravelMinutes, officeById, travelMinutesBetween } from "./offices";

export type BusyBlock = Readonly<{
  startsAt: string;
  endsAt: string;
  eventId: string;
}>;

type CandidateInterval = Readonly<{ startsAt: string; endsAt: string }>;
type Participant = Readonly<{ person: Person; profile: SchedulingProfile }>;

function localDateParts(instant: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function minutesFromClock(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function localMinutes(instant: string, timeZone: string): number {
  const parts = localDateParts(instant, timeZone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function localDay(instant: string, timeZone: string): string {
  const parts = localDateParts(instant, timeZone);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function timeZoneOffsetMinutes(instant: number, timeZone: string): number {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(instant))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

function zonedDateTimeToEpoch(parts: Record<string, string>, timeZone: string): number {
  const localUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const initial = localUtc - timeZoneOffsetMinutes(localUtc, timeZone) * 60_000;
  return localUtc - timeZoneOffsetMinutes(initial, timeZone) * 60_000;
}

function addWeeksAtLocalTime(instant: string, timeZone: string, weeks: number): string {
  const parts = localDateParts(instant, timeZone);
  const shiftedDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + weeks * 7));
  return new Date(zonedDateTimeToEpoch({
    year: String(shiftedDate.getUTCFullYear()),
    month: String(shiftedDate.getUTCMonth() + 1).padStart(2, "0"),
    day: String(shiftedDate.getUTCDate()).padStart(2, "0"),
    hour: parts.hour,
    minute: parts.minute
  }, timeZone)).toISOString();
}

function roundedUpToQuarterHour(timestamp: number): number {
  const quarter = 15 * 60_000;
  return Math.ceil(timestamp / quarter) * quarter;
}

function eventIntervalWithBuffer(event: CalendarEvent, profile: SchedulingProfile): CandidateInterval {
  const buffer = profile.meetingPreferences.travelBufferMinutes * 60_000;
  return {
    startsAt: new Date(Date.parse(event.startsAt) - buffer).toISOString(),
    endsAt: new Date(Date.parse(event.endsAt) + buffer).toISOString()
  };
}

function isWithinWorkingHours(interval: CandidateInterval, person: Person): boolean {
  if (localDay(interval.startsAt, person.timeZone) !== localDay(interval.endsAt, person.timeZone)) {
    return false;
  }
  const weekday = localDateParts(interval.startsAt, person.timeZone).weekday;
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  const startsAt = localMinutes(interval.startsAt, person.timeZone);
  const endsAt = localMinutes(interval.endsAt, person.timeZone);
  return (
    startsAt >= minutesFromClock(person.workingHours.start) &&
    endsAt <= minutesFromClock(person.workingHours.end)
  );
}

function overlaps(left: CandidateInterval, right: CandidateInterval): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

function weekdayFor(instant: string, timeZone: string): Weekday | null {
  const weekday = localDateParts(instant, timeZone).weekday;
  const weekdays: Readonly<Record<string, Weekday>> = {
    Mon: "monday",
    Tue: "tuesday",
    Wed: "wednesday",
    Thu: "thursday",
    Fri: "friday"
  };
  return weekdays[weekday] ?? null;
}

function overlapsRecurringFocusBlock(interval: CandidateInterval, person: Person, profile: SchedulingProfile): boolean {
  if (!profile.meetingPreferences.protectRecurringFocusTime) return false;
  const weekday = weekdayFor(interval.startsAt, person.timeZone);
  if (!weekday) return false;
  const startsAt = localMinutes(interval.startsAt, person.timeZone);
  const endsAt = localMinutes(interval.endsAt, person.timeZone);
  return profile.recurringFocusBlocks.some((block) =>
    block.weekday === weekday && startsAt < minutesFromClock(block.end) && minutesFromClock(block.start) < endsAt
  );
}

function preferenceFeedback(interval: CandidateInterval, person: Person, profile: SchedulingProfile): { score: number; reason?: string; warning?: string } {
  const hour = Math.floor(localMinutes(interval.startsAt, person.timeZone) / 60);
  const preference = profile.meetingPreferences.preferredMeetingWindow;
  if (preference === "any") {
    return { score: 10, reason: person.displayName + " has no time-of-day preference." };
  }
  const matchingWindow =
    (preference === "morning" && hour >= 9 && hour < 12) ||
    (preference === "afternoon" && hour >= 12 && hour < 17);
  if (matchingWindow) {
    return { score: 20, reason: "Matches " + person.displayName + "’s " + preference + " preference." };
  }
  return { score: 0, warning: "Outside " + person.displayName + "’s preferred " + preference + " window." };
}

export function busyBlocksFor(events: readonly CalendarEvent[], personId: string): BusyBlock[] {
  return events
    .filter((event) => (event.status === "confirmed" || event.status === "tentative") && event.attendeeIds.includes(personId))
    .map(({ startsAt, endsAt, id }) => ({ startsAt, endsAt, eventId: id }))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

export function eventsOverlap(left: BusyBlock, right: BusyBlock): boolean {
  return overlaps(left, right);
}

function participantsFor(
  people: readonly Person[],
  profiles: readonly SchedulingProfile[],
  activeUserId: string,
  attendeeIds: readonly string[]
): Participant[] {
  const participantIds = [...new Set([activeUserId, ...attendeeIds])];
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const profilesByPersonId = new Map(profiles.map((profile) => [profile.personId, profile]));
  const participants = participantIds.map((id) => {
    const person = peopleById.get(id);
    const profile = profilesByPersonId.get(id);
    return person && profile ? { person, profile } : undefined;
  });
  if (participants.some((participant) => !participant)) {
    throw new Error("One or more attendees do not have a scheduling profile.");
  }
  return participants as Participant[];
}

function occurrencesFor(event: CalendarEvent, rangeStartsAt: number, rangeEndsAt: number): CalendarEvent[] {
  if (!event.recurrence) return [event];
  const duration = Date.parse(event.endsAt) - Date.parse(event.startsAt);
  const exceptionsByOriginalStart = new Map(event.recurrence.exceptions.map((exception) => [exception.originalStartsAt, exception]));
  const regularOccurrences = Array.from({ length: event.recurrence.occurrenceCount }, (_, index) => {
    const startsAt = addWeeksAtLocalTime(event.startsAt, event.timeZone, index);
    if (exceptionsByOriginalStart.has(startsAt)) return undefined;
    return calendarOccurrence(event, Date.parse(startsAt), duration);
  }).filter((occurrence): occurrence is CalendarEvent => Boolean(occurrence));
  const exceptionOccurrences = event.recurrence.exceptions.map((exception) => ({
    ...event,
    id: event.id + "-exception-" + exception.originalStartsAt,
    startsAt: exception.startsAt,
    endsAt: exception.endsAt
  }));
  return [...regularOccurrences, ...exceptionOccurrences]
    .filter((occurrence) => Date.parse(occurrence.endsAt) > rangeStartsAt && Date.parse(occurrence.startsAt) < rangeEndsAt);
}

function calendarOccurrence(event: CalendarEvent, startsAt: number, duration: number): CalendarEvent {
  return {
    ...event,
    id: event.id + "-occurrence-" + startsAt,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + duration).toISOString()
  };
}

function expandedEvents(events: readonly CalendarEvent[], rangeStartsAt: number, rangeEndsAt: number): CalendarEvent[] {
  return events.flatMap((event) => occurrencesFor(event, rangeStartsAt, rangeEndsAt));
}

function candidateForInterval(
  events: readonly CalendarEvent[],
  participants: readonly Participant[],
  request: Pick<ScheduleRequest, "officeId">,
  interval: CandidateInterval
): ScheduleCandidate | null {
  if (!participants.every(({ person }) => isWithinWorkingHours(interval, person))) return null;

  const intersectsBusyTime = participants.some(({ person, profile }) =>
    events
      .filter((event) => (event.status === "confirmed" || event.status === "tentative") && event.attendeeIds.includes(person.id))
      .some((event) => overlaps(interval, eventIntervalWithBuffer(event, profile)))
  );
  const intersectsRecurringFocusTime = participants.some(({ person, profile }) => overlapsRecurringFocusBlock(interval, person, profile));
  if (intersectsBusyTime || intersectsRecurringFocusTime) return null;

  let score = 50;
  const reasons = ["Fits everyone’s working hours and travel buffers."];
  const warnings: string[] = [];
  if (request.officeId) {
    const meetingOffice = officeById(request.officeId);
    reasons.push("Meeting at " + meetingOffice.name + ".");
    for (const { person, profile } of participants) {
      const weekday = weekdayFor(interval.startsAt, person.timeZone);
      const workday = profile.weeklyWorkPattern.find((candidate) => candidate.weekday === weekday);
      if (workday?.mode === "remote") {
        reasons.push(person.displayName + " works remotely that day; no office commute is assumed.");
        continue;
      }
      const homeOffice = workday?.officeId ? officeById(workday.officeId) : designatedOfficeFor(person.id);
      const travelMinutes = travelMinutesBetween(homeOffice.id, meetingOffice.id);
      if (travelMinutes === 0) continue;
      warnings.push(
        person.displayName + " is based at " + homeOffice.name + " (" + formatTravelMinutes(travelMinutes) + " travel to " + meetingOffice.name + ")."
      );
      score -= 5;
    }
  }
  for (const { person, profile } of participants) {
    const feedback = preferenceFeedback(interval, person, profile);
    score += feedback.score;
    if (feedback.reason) reasons.push(feedback.reason);
    if (feedback.warning) warnings.push(feedback.warning);
  }
  return scheduleCandidateSchema.parse({ ...interval, score, reasons: reasons.slice(0, 10), warnings: warnings.slice(0, 10) });
}

function recurringWarnings(candidates: readonly ScheduleCandidate[], occurrenceCount: number): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const warning of candidate.warnings) counts.set(warning, (counts.get(warning) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([warning, count]) => count === occurrenceCount ? warning : count + " of " + occurrenceCount + " occurrences: " + warning)
    .slice(0, 6);
}

function findExceptionCandidate(
  events: readonly CalendarEvent[],
  participants: readonly Participant[],
  request: Pick<ScheduleRequest, "officeId">,
  original: CandidateInterval
): ScheduleCandidate | null {
  const duration = Date.parse(original.endsAt) - Date.parse(original.startsAt);
  const originalStart = Date.parse(original.startsAt);
  const scanStart = roundedUpToQuarterHour(originalStart - 4 * 60 * 60_000);
  const scanEnd = originalStart + 20 * 60 * 60_000;
  let best: ScheduleCandidate | null = null;
  for (let startsAt = scanStart; startsAt + duration <= scanEnd; startsAt += 15 * 60_000) {
    const candidate = candidateForInterval(events, participants, request, {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + duration).toISOString()
    });
    if (!candidate) continue;
    if (!best || candidate.score > best.score || (candidate.score === best.score && Math.abs(startsAt - originalStart) < Math.abs(Date.parse(best.startsAt) - originalStart))) {
      best = candidate;
    }
  }
  return best;
}

export function proposeSchedule(
  events: readonly CalendarEvent[],
  people: readonly Person[],
  profiles: readonly SchedulingProfile[],
  activeUserId: string,
  request: ScheduleRequest,
  maxResults = 3
): ScheduleCandidate[] {
  const participants = participantsFor(people, profiles, activeUserId, request.attendeeIds);
  const durationMilliseconds = request.durationMinutes * 60_000;
  const rangeStart = Date.parse(request.rangeStartsAt);
  const rangeEnd = Date.parse(request.rangeEndsAt);
  const calendarEvents = expandedEvents(events, rangeStart, rangeEnd);
  const candidates: ScheduleCandidate[] = [];

  for (let startsAt = roundedUpToQuarterHour(rangeStart); startsAt + durationMilliseconds <= rangeEnd; startsAt += 15 * 60_000) {
    const interval = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + durationMilliseconds).toISOString()
    };
    const candidate = candidateForInterval(calendarEvents, participants, request, interval);
    if (candidate) candidates.push(candidate);
  }

  return candidates
    .sort((left, right) => right.score - left.score || Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, maxResults);
}

export function proposeRecurringSchedule(
  events: readonly CalendarEvent[],
  people: readonly Person[],
  profiles: readonly SchedulingProfile[],
  activeUserId: string,
  request: RecurringScheduleRequest,
  maxResults = 3
): RecurringScheduleCandidate[] {
  const participants = participantsFor(people, profiles, activeUserId, request.attendeeIds);
  const activeUser = participants.find(({ person }) => person.id === activeUserId)?.person;
  if (!activeUser) throw new Error("The active user does not have a scheduling profile.");
  const durationMilliseconds = request.durationMinutes * 60_000;
  const rangeStart = Date.parse(request.rangeStartsAt);
  const rangeEnd = Date.parse(request.rangeEndsAt);
  const calendarEvents = expandedEvents(events, rangeStart, rangeEnd);
  const candidates: RecurringScheduleCandidate[] = [];
  let firstRecurringDay: string | undefined;

  for (let startsAt = roundedUpToQuarterHour(rangeStart); startsAt + durationMilliseconds + (request.recurrence.occurrenceCount - 1) * 7 * 24 * 60 * 60_000 <= rangeEnd; startsAt += 15 * 60_000) {
    const firstInterval = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + durationMilliseconds).toISOString()
    };
    if (weekdayFor(firstInterval.startsAt, activeUser.timeZone) !== request.recurrence.weekday) {
      if (firstRecurringDay) break;
      continue;
    }
    const candidateDay = localDay(firstInterval.startsAt, activeUser.timeZone);
    if (!firstRecurringDay) firstRecurringDay = candidateDay;
    if (candidateDay !== firstRecurringDay) break;
    const validOccurrences: ScheduleCandidate[] = [];
    const exceptions: Array<{ originalStartsAt: string; startsAt: string; endsAt: string }> = [];
    let hasUnresolvedConflict = false;
    for (let index = 0; index < request.recurrence.occurrenceCount; index += 1) {
      const occurrenceStartsAt = addWeeksAtLocalTime(firstInterval.startsAt, activeUser.timeZone, index);
      const original = {
        startsAt: occurrenceStartsAt,
        endsAt: new Date(Date.parse(occurrenceStartsAt) + durationMilliseconds).toISOString()
      };
      const candidate = candidateForInterval(calendarEvents, participants, request, original);
      if (candidate) {
        validOccurrences.push(candidate);
        continue;
      }
      if (exceptions.length >= request.maxExceptions) {
        hasUnresolvedConflict = true;
        break;
      }
      const exception = findExceptionCandidate(calendarEvents, participants, request, original);
      if (!exception) {
        hasUnresolvedConflict = true;
        break;
      }
      validOccurrences.push(exception);
      exceptions.push({ originalStartsAt: original.startsAt, startsAt: exception.startsAt, endsAt: exception.endsAt });
    }
    if (hasUnresolvedConflict) continue;
    const sharedReasons = [...new Set(validOccurrences.flatMap((candidate) => candidate.reasons))]
      .filter((reason) => reason !== "Fits everyone’s working hours and travel buffers.")
      .slice(0, 4);
    candidates.push(recurringScheduleCandidateSchema.parse({
      ...firstInterval,
      score: Math.round(validOccurrences.reduce((total, candidate) => total + candidate.score, 0) / validOccurrences.length),
      recurrence: { ...request.recurrence, exceptions },
      occurrences: validOccurrences.map(({ startsAt: occurrenceStartsAt, endsAt }) => ({ startsAt: occurrenceStartsAt, endsAt })),
      reasons: [
        "All " + request.recurrence.occurrenceCount + " weekly " + request.recurrence.weekday + " occurrences fit working hours, protected focus time, and travel buffers.",
        ...(exceptions.length > 0 ? [exceptions.length + " one-off exception" + (exceptions.length === 1 ? " keeps an existing meeting unchanged." : "s keep existing meetings unchanged.")] : []),
        ...sharedReasons
      ].slice(0, 10),
      warnings: recurringWarnings(validOccurrences, request.recurrence.occurrenceCount)
    }));
  }

  return candidates
    .sort((left, right) => right.score - left.score || Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, maxResults);
}
