import type { CalendarEvent } from "./contracts";

function localDateParts(instant: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
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

export function addWeeksAtLocalTime(instant: string, timeZone: string, weeks: number): string {
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

function calendarOccurrence(event: CalendarEvent, startsAt: number, duration: number): CalendarEvent {
  return {
    ...event,
    id: event.id + "-occurrence-" + startsAt,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + duration).toISOString()
  };
}

/** Expands a stored weekly series into every actual occurrence, including exceptions. */
export function expandCalendarEventOccurrences(event: CalendarEvent): CalendarEvent[] {
  if (!event.recurrence) return [event];
  const duration = Date.parse(event.endsAt) - Date.parse(event.startsAt);
  const exceptionsByOriginalStart = new Map(event.recurrence.exceptions.map((exception) => [exception.originalStartsAt, exception]));
  const cancelledOriginalStarts = new Set(event.recurrence.cancelledOriginalStartsAt);
  const regularOccurrences = Array.from({ length: event.recurrence.occurrenceCount }, (_, index) => {
    const startsAt = addWeeksAtLocalTime(event.startsAt, event.timeZone, index);
    if (exceptionsByOriginalStart.has(startsAt) || cancelledOriginalStarts.has(startsAt)) return undefined;
    return calendarOccurrence(event, Date.parse(startsAt), duration);
  }).filter((occurrence): occurrence is CalendarEvent => Boolean(occurrence));
  const exceptionOccurrences = event.recurrence.exceptions.filter((exception) => !cancelledOriginalStarts.has(exception.originalStartsAt)).map((exception) => ({
    ...event,
    id: event.id + "-exception-" + exception.originalStartsAt,
    startsAt: exception.startsAt,
    endsAt: exception.endsAt
  }));
  return [...regularOccurrences, ...exceptionOccurrences];
}
