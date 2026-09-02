import { demoDataSchema, type DemoData } from "./contracts";
import { initialSchedulingProfiles } from "./scheduling-profiles";

const rawDemoData = {
  people: [
    {
      id: "maya",
      displayName: "Maya Chen",
      timeZone: "America/Los_Angeles",
      workingHours: { start: "09:00", end: "17:00" },
      schedulingPreferences: {
        preferredMeetingWindow: "afternoon",
        focusBlocksProtected: true,
        travelBufferMinutes: 15
      }
    },
    {
      id: "sam",
      displayName: "Sam Okafor",
      timeZone: "America/New_York",
      workingHours: { start: "09:00", end: "17:00" },
      schedulingPreferences: {
        preferredMeetingWindow: "morning",
        focusBlocksProtected: true,
        travelBufferMinutes: 15
      }
    },
    {
      id: "alex",
      displayName: "Alex Rivera",
      timeZone: "America/New_York",
      workingHours: { start: "08:30", end: "17:30" },
      schedulingPreferences: {
        preferredMeetingWindow: "any",
        focusBlocksProtected: true,
        travelBufferMinutes: 15
      }
    }
  ],
  schedulingProfiles: initialSchedulingProfiles,
  calendars: [
    { id: "maya-main", ownerId: "maya", name: "Maya", timeZone: "America/Los_Angeles", color: "#8466f6" },
    { id: "sam-main", ownerId: "sam", name: "Sam", timeZone: "America/New_York", color: "#21a179" },
    { id: "alex-main", ownerId: "alex", name: "Alex", timeZone: "America/New_York", color: "#e98055" }
  ],
  events: [
    {
      id: "maya-roadmap-mon",
      calendarId: "maya-main",
      revision: 1,
      title: "Roadmap review",
      startsAt: "2026-09-07T20:00:00.000Z",
      endsAt: "2026-09-07T21:00:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "alex"]
    },
    {
      id: "maya-focus-tue",
      calendarId: "maya-main",
      revision: 1,
      title: "Focus time",
      startsAt: "2026-09-08T18:00:00.000Z",
      endsAt: "2026-09-08T20:00:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "private",
      status: "confirmed",
      attendeeIds: ["maya"]
    },
    {
      id: "sam-customer-sync",
      calendarId: "sam-main",
      revision: 1,
      title: "Customer sync",
      startsAt: "2026-09-08T17:00:00.000Z",
      endsAt: "2026-09-08T17:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam"]
    },
    {
      id: "alex-design-review",
      calendarId: "alex-main",
      revision: 1,
      title: "Design review",
      startsAt: "2026-09-09T18:00:00.000Z",
      endsAt: "2026-09-09T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "maya"]
    },
    {
      id: "sam-team-standup-wed",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-09-09T14:00:00.000Z",
      endsAt: "2026-09-09T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex"]
    },
    {
      id: "alex-lunch-thu",
      calendarId: "alex-main",
      revision: 1,
      title: "Product lunch",
      startsAt: "2026-09-10T16:00:00.000Z",
      endsAt: "2026-09-10T17:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "maya-partner-brief-thu",
      calendarId: "maya-main",
      revision: 1,
      title: "Partner brief",
      startsAt: "2026-09-10T19:30:00.000Z",
      endsAt: "2026-09-10T20:15:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya"]
    },
    {
      id: "sam-retrospective-fri",
      calendarId: "sam-main",
      revision: 1,
      title: "Sprint retrospective",
      startsAt: "2026-09-11T18:00:00.000Z",
      endsAt: "2026-09-11T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "maya", "alex"]
    }
  ]
} as const;

export const demoData: DemoData = demoDataSchema.parse(rawDemoData);
export const demoWindow = {
  startsAt: "2026-09-07T04:00:00.000Z",
  endsAt: "2026-09-14T04:00:00.000Z"
} as const;
