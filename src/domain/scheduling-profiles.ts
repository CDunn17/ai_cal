import { schedulingProfileSchema, type SchedulingProfile } from "./contracts";

export const initialSchedulingProfiles: SchedulingProfile[] = schedulingProfileSchema.array().parse([
  {
    personId: "maya",
    revision: 1,
    defaultOfficeId: "san-francisco-studio",
    meetingPreferences: { preferredMeetingWindow: "afternoon", protectRecurringFocusTime: true, travelBufferMinutes: 15 },
    weeklyWorkPattern: [
      { weekday: "monday", mode: "office", officeId: "san-francisco-studio" },
      { weekday: "tuesday", mode: "remote" },
      { weekday: "wednesday", mode: "office", officeId: "san-francisco-studio" },
      { weekday: "thursday", mode: "remote" },
      { weekday: "friday", mode: "office", officeId: "san-francisco-studio" }
    ],
    recurringFocusBlocks: [{ weekday: "wednesday", start: "10:00", end: "11:00" }]
  },
  {
    personId: "sam",
    revision: 1,
    defaultOfficeId: "new-york-hq",
    meetingPreferences: { preferredMeetingWindow: "morning", protectRecurringFocusTime: true, travelBufferMinutes: 15 },
    weeklyWorkPattern: [
      { weekday: "monday", mode: "office", officeId: "new-york-hq" },
      { weekday: "tuesday", mode: "office", officeId: "new-york-hq" },
      { weekday: "wednesday", mode: "remote" },
      { weekday: "thursday", mode: "office", officeId: "new-york-hq" },
      { weekday: "friday", mode: "remote" }
    ],
    recurringFocusBlocks: [{ weekday: "thursday", start: "15:00", end: "16:00" }]
  },
  {
    personId: "alex",
    revision: 1,
    defaultOfficeId: "new-york-hq",
    meetingPreferences: { preferredMeetingWindow: "any", protectRecurringFocusTime: true, travelBufferMinutes: 15 },
    weeklyWorkPattern: [
      { weekday: "monday", mode: "office", officeId: "new-york-hq" },
      { weekday: "tuesday", mode: "office", officeId: "new-york-hq" },
      { weekday: "wednesday", mode: "remote" },
      { weekday: "thursday", mode: "office", officeId: "new-york-hq" },
      { weekday: "friday", mode: "remote" }
    ],
    recurringFocusBlocks: [{ weekday: "friday", start: "09:00", end: "10:00" }]
  }
]);
