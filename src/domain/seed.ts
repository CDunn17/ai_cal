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
    },
    {
      id: "alex-board-brief-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Board briefing",
      startsAt: "2026-10-20T13:00:00.000Z",
      endsAt: "2026-10-20T14:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex"]
    },
    {
      id: "alex-project-kickoff-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Project kickoff",
      startsAt: "2026-10-12T15:00:00.000Z",
      endsAt: "2026-10-12T16:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "alex-team-standup-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-10-14T14:00:00.000Z",
      endsAt: "2026-10-14T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "alex-launch-readout-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Launch readout",
      startsAt: "2026-10-15T18:00:00.000Z",
      endsAt: "2026-10-15T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "maya"]
    },
    {
      id: "maya-research-interview-sep",
      calendarId: "maya-main",
      revision: 1,
      title: "Research interview",
      startsAt: "2026-09-14T22:00:00.000Z",
      endsAt: "2026-09-14T22:45:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya"]
    },
    {
      id: "alex-vendor-check-in-sep",
      calendarId: "alex-main",
      revision: 1,
      title: "Vendor check-in",
      startsAt: "2026-09-15T19:00:00.000Z",
      endsAt: "2026-09-15T19:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex"]
    },
    {
      id: "sam-team-standup-sep-16",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-09-16T14:00:00.000Z",
      endsAt: "2026-09-16T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "sam-architecture-review-sep",
      calendarId: "sam-main",
      revision: 1,
      title: "Architecture review",
      startsAt: "2026-09-17T17:00:00.000Z",
      endsAt: "2026-09-17T18:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex"]
    },
    {
      id: "alex-budget-review-sep",
      calendarId: "alex-main",
      revision: 1,
      title: "Budget review",
      startsAt: "2026-09-18T15:00:00.000Z",
      endsAt: "2026-09-18T15:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "sam-customer-discovery-sep",
      calendarId: "sam-main",
      revision: 1,
      title: "Customer discovery",
      startsAt: "2026-09-21T16:00:00.000Z",
      endsAt: "2026-09-21T16:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam"]
    },
    {
      id: "maya-design-qa-sep",
      calendarId: "maya-main",
      revision: 1,
      title: "Design QA",
      startsAt: "2026-09-22T20:30:00.000Z",
      endsAt: "2026-09-22T21:15:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "alex"]
    },
    {
      id: "sam-team-standup-sep-23",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-09-23T14:00:00.000Z",
      endsAt: "2026-09-23T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "alex-hiring-sync-sep",
      calendarId: "alex-main",
      revision: 1,
      title: "Hiring sync",
      startsAt: "2026-09-24T18:00:00.000Z",
      endsAt: "2026-09-24T18:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "maya"]
    },
    {
      id: "sam-operations-review-sep",
      calendarId: "sam-main",
      revision: 1,
      title: "Operations review",
      startsAt: "2026-09-25T18:00:00.000Z",
      endsAt: "2026-09-25T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "maya"]
    },
    {
      id: "alex-quarter-planning-sep",
      calendarId: "alex-main",
      revision: 1,
      title: "Quarter planning",
      startsAt: "2026-09-28T14:30:00.000Z",
      endsAt: "2026-09-28T15:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "maya", "sam"]
    },
    {
      id: "maya-partner-update-sep",
      calendarId: "maya-main",
      revision: 1,
      title: "Partner update",
      startsAt: "2026-09-29T19:00:00.000Z",
      endsAt: "2026-09-29T19:30:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "sam"]
    },
    {
      id: "sam-team-standup-sep-30",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-09-30T14:00:00.000Z",
      endsAt: "2026-09-30T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "sam-release-readiness-oct",
      calendarId: "sam-main",
      revision: 1,
      title: "Release readiness",
      startsAt: "2026-10-01T17:00:00.000Z",
      endsAt: "2026-10-01T18:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex"]
    },
    {
      id: "maya-campaign-review-oct",
      calendarId: "maya-main",
      revision: 1,
      title: "Campaign review",
      startsAt: "2026-10-02T20:00:00.000Z",
      endsAt: "2026-10-02T20:45:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya"]
    },
    {
      id: "alex-metrics-review-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Metrics review",
      startsAt: "2026-10-05T15:00:00.000Z",
      endsAt: "2026-10-05T15:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "sam-sales-forecast-oct",
      calendarId: "sam-main",
      revision: 1,
      title: "Sales forecast",
      startsAt: "2026-10-06T18:00:00.000Z",
      endsAt: "2026-10-06T18:45:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam"]
    },
    {
      id: "sam-team-standup-oct-7",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-10-07T14:00:00.000Z",
      endsAt: "2026-10-07T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "maya-design-crit-oct",
      calendarId: "maya-main",
      revision: 1,
      title: "Design critique",
      startsAt: "2026-10-08T20:00:00.000Z",
      endsAt: "2026-10-08T21:00:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "alex"]
    },
    {
      id: "alex-customer-prep-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Customer prep",
      startsAt: "2026-10-09T17:00:00.000Z",
      endsAt: "2026-10-09T17:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex"]
    },
    {
      id: "sam-sprint-retro-oct",
      calendarId: "sam-main",
      revision: 1,
      title: "Sprint retrospective",
      startsAt: "2026-10-16T18:00:00.000Z",
      endsAt: "2026-10-16T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "maya-roadmap-planning-oct",
      calendarId: "maya-main",
      revision: 1,
      title: "Roadmap planning",
      startsAt: "2026-10-19T19:00:00.000Z",
      endsAt: "2026-10-19T20:00:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "alex"]
    },
    {
      id: "sam-team-standup-oct-21",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-10-21T14:00:00.000Z",
      endsAt: "2026-10-21T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "sam-security-review-oct",
      calendarId: "sam-main",
      revision: 1,
      title: "Security review",
      startsAt: "2026-10-22T17:00:00.000Z",
      endsAt: "2026-10-22T18:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "maya"]
    },
    {
      id: "alex-stakeholder-update-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Stakeholder update",
      startsAt: "2026-10-23T15:00:00.000Z",
      endsAt: "2026-10-23T15:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "sam"]
    },
    {
      id: "maya-user-research-oct",
      calendarId: "maya-main",
      revision: 1,
      title: "User research",
      startsAt: "2026-10-26T21:00:00.000Z",
      endsAt: "2026-10-26T21:45:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya"]
    },
    {
      id: "sam-customer-sync-oct",
      calendarId: "sam-main",
      revision: 1,
      title: "Customer sync",
      startsAt: "2026-10-27T16:00:00.000Z",
      endsAt: "2026-10-27T16:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam"]
    },
    {
      id: "sam-team-standup-oct-28",
      calendarId: "sam-main",
      revision: 1,
      title: "Team standup",
      startsAt: "2026-10-28T14:00:00.000Z",
      endsAt: "2026-10-28T14:30:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["sam", "alex", "maya"]
    },
    {
      id: "alex-sprint-planning-oct",
      calendarId: "alex-main",
      revision: 1,
      title: "Sprint planning",
      startsAt: "2026-10-29T18:00:00.000Z",
      endsAt: "2026-10-29T19:00:00.000Z",
      timeZone: "America/New_York",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["alex", "maya", "sam"]
    },
    {
      id: "maya-content-review-oct",
      calendarId: "maya-main",
      revision: 1,
      title: "Content review",
      startsAt: "2026-10-30T19:00:00.000Z",
      endsAt: "2026-10-30T19:45:00.000Z",
      timeZone: "America/Los_Angeles",
      visibility: "public",
      status: "confirmed",
      attendeeIds: ["maya", "alex"]
    }
  ]
} as const;

export const demoData: DemoData = demoDataSchema.parse(rawDemoData);
export const demoWindow = {
  startsAt: "2026-09-07T04:00:00.000Z",
  endsAt: "2026-09-14T04:00:00.000Z"
} as const;
