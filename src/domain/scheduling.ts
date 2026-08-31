import type { CalendarEvent } from "./contracts";

export type BusyBlock = Readonly<{
  startsAt: string;
  endsAt: string;
  eventId: string;
}>;

export function busyBlocksFor(events: readonly CalendarEvent[], personId: string): BusyBlock[] {
  return events
    .filter((event) => event.status !== "draft" && event.attendeeIds.includes(personId))
    .map(({ startsAt, endsAt, id }) => ({ startsAt, endsAt, eventId: id }))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

export function eventsOverlap(left: BusyBlock, right: BusyBlock): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}
