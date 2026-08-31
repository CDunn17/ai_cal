import { scheduleCandidateSchema, type CalendarEvent, type Person, type ScheduleCandidate, type ScheduleRequest } from "./contracts";

export type BusyBlock = Readonly<{
  startsAt: string;
  endsAt: string;
  eventId: string;
}>;

type CandidateInterval = Readonly<{ startsAt: string; endsAt: string }>;

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

function roundedUpToQuarterHour(timestamp: number): number {
  const quarter = 15 * 60_000;
  return Math.ceil(timestamp / quarter) * quarter;
}

function eventIntervalWithBuffer(event: CalendarEvent, person: Person): CandidateInterval {
  const buffer = person.schedulingPreferences.travelBufferMinutes * 60_000;
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

function preferenceFeedback(interval: CandidateInterval, person: Person): { score: number; reason?: string; warning?: string } {
  const hour = Math.floor(localMinutes(interval.startsAt, person.timeZone) / 60);
  const preference = person.schedulingPreferences.preferredMeetingWindow;
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
    .filter((event) => event.status !== "draft" && event.attendeeIds.includes(personId))
    .map(({ startsAt, endsAt, id }) => ({ startsAt, endsAt, eventId: id }))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

export function eventsOverlap(left: BusyBlock, right: BusyBlock): boolean {
  return overlaps(left, right);
}

export function proposeSchedule(
  events: readonly CalendarEvent[],
  people: readonly Person[],
  activeUserId: string,
  request: ScheduleRequest,
  maxResults = 3
): ScheduleCandidate[] {
  const participantIds = [...new Set([activeUserId, ...request.attendeeIds])];
  const participants = participantIds.map((id) => people.find((person) => person.id === id)).filter((person): person is Person => Boolean(person));
  if (participants.length !== participantIds.length) {
    throw new Error("One or more requested attendees do not exist.");
  }

  const durationMilliseconds = request.durationMinutes * 60_000;
  const rangeEnd = Date.parse(request.rangeEndsAt);
  const candidates: ScheduleCandidate[] = [];

  for (let startsAt = roundedUpToQuarterHour(Date.parse(request.rangeStartsAt)); startsAt + durationMilliseconds <= rangeEnd; startsAt += 15 * 60_000) {
    const interval = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + durationMilliseconds).toISOString()
    };
    if (!participants.every((person) => isWithinWorkingHours(interval, person))) {
      continue;
    }
    const intersectsBusyTime = participants.some((person) =>
      events
        .filter((event) => event.status !== "draft" && event.attendeeIds.includes(person.id))
        .some((event) => overlaps(interval, eventIntervalWithBuffer(event, person)))
    );
    if (intersectsBusyTime) {
      continue;
    }

    let score = 50;
    const reasons = ["Fits everyone’s working hours and travel buffers."];
    const warnings: string[] = [];
    for (const person of participants) {
      const feedback = preferenceFeedback(interval, person);
      score += feedback.score;
      if (feedback.reason) reasons.push(feedback.reason);
      if (feedback.warning) warnings.push(feedback.warning);
    }
    candidates.push(scheduleCandidateSchema.parse({ ...interval, score, reasons, warnings }));
  }

  return candidates
    .sort((left, right) => right.score - left.score || Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, maxResults);
}
