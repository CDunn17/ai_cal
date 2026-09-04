import { z } from "zod";
import { OFFICE_IDS } from "./offices";

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Expected an IANA timezone identifier.");

export const localClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const personSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(80),
  timeZone: timeZoneSchema,
  workingHours: z.object({
    start: localClockSchema,
    end: localClockSchema
  }),
  schedulingPreferences: z.object({
    preferredMeetingWindow: z.enum(["morning", "afternoon", "any"]),
    focusBlocksProtected: z.boolean(),
    travelBufferMinutes: z.number().int().min(0).max(120)
  })
});

export const weekdaySchema = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday"]);
export const workModeSchema = z.enum(["office", "remote"]);

export const schedulingProfileSchema = z.object({
  personId: z.string().min(1),
  revision: z.number().int().positive(),
  defaultOfficeId: z.enum(OFFICE_IDS),
  meetingPreferences: z.object({
    preferredMeetingWindow: z.enum(["morning", "afternoon", "any"]),
    protectRecurringFocusTime: z.boolean(),
    travelBufferMinutes: z.number().int().min(0).max(120)
  }),
  weeklyWorkPattern: z.array(z.object({
    weekday: weekdaySchema,
    mode: workModeSchema,
    officeId: z.enum(OFFICE_IDS).optional()
  })).length(5),
  recurringFocusBlocks: z.array(z.object({
    weekday: weekdaySchema,
    start: localClockSchema,
    end: localClockSchema
  }).refine((block) => block.start < block.end, { message: "A focus block must end after it starts." })).max(10)
});

export const calendarSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(80),
  timeZone: timeZoneSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const eventVisibilitySchema = z.enum(["public", "private"]);
export const eventStatusSchema = z.enum(["confirmed", "tentative", "draft", "cancelled"]);
export const recurrenceExceptionSchema = z.object({
  originalStartsAt: z.string().datetime({ offset: true }),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
}).refine((exception) => Date.parse(exception.endsAt) > Date.parse(exception.startsAt), {
  message: "A recurrence exception must end after it starts.",
  path: ["endsAt"]
});

export const weeklyRecurrenceRequestSchema = z.object({
  frequency: z.literal("weekly"),
  weekday: weekdaySchema,
  occurrenceCount: z.number().int().min(2).max(26)
});

export const weeklyRecurrenceSchema = z.object({
  ...weeklyRecurrenceRequestSchema.shape,
  exceptions: z.array(recurrenceExceptionSchema).max(4).default([])
});

const eventFieldsSchema = z.object({
  calendarId: z.string().min(1),
  title: z.string().min(1).max(140),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  timeZone: timeZoneSchema,
  visibility: eventVisibilitySchema,
  status: eventStatusSchema,
  attendeeIds: z.array(z.string().min(1)).max(20),
  recurrence: weeklyRecurrenceSchema.optional(),
  location: z.string().max(160).optional(),
  agenda: z.string().max(2_000).optional()
});

export const calendarEventSchema = eventFieldsSchema
  .extend({
    id: z.string().min(1),
    revision: z.number().int().positive()
  })
  .refine((event) => Date.parse(event.endsAt) > Date.parse(event.startsAt), {
    message: "An event must end after it starts.",
    path: ["endsAt"]
  });

export const createEventInputSchema = eventFieldsSchema
  .omit({ status: true, attendeeIds: true })
  .extend({ attendeeIds: z.array(z.string().min(1)).max(20).optional() });

export const updateEventInputSchema = eventFieldsSchema
  .partial()
  .extend({ expectedRevision: z.number().int().positive() })
  .refine((input) => Object.keys(input).some((key) => key !== "expectedRevision"), {
    message: "Provide at least one field to update."
  });

export const scheduleRequestSchema = z
  .object({
    attendeeIds: z.array(z.string().min(1)).min(1).max(10),
    durationMinutes: z.number().int().min(15).max(120).multipleOf(15),
    officeId: z.enum(OFFICE_IDS).optional(),
    rangeStartsAt: z.string().datetime({ offset: true }),
    rangeEndsAt: z.string().datetime({ offset: true })
  })
  .refine((request) => Date.parse(request.rangeEndsAt) > Date.parse(request.rangeStartsAt), {
    message: "The search range must end after it starts.",
    path: ["rangeEndsAt"]
  });

export const recurringScheduleRequestSchema = scheduleRequestSchema.extend({
  recurrence: weeklyRecurrenceRequestSchema,
  maxExceptions: z.number().int().min(0).max(4).default(0),
  requestedStartTime: localClockSchema.optional(),
  timeFlexibilityMinutes: z.number().int().min(0).max(240).multipleOf(15).optional()
});

export const scheduleCandidateSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  score: z.number().int(),
  reasons: z.array(z.string().min(1)).min(1).max(10),
  warnings: z.array(z.string().min(1)).max(10)
});

export const recurringScheduleCandidateSchema = scheduleCandidateSchema.extend({
  recurrence: weeklyRecurrenceSchema,
  occurrences: z.array(z.object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true })
  })).min(2).max(26)
});

export const recurringProposalSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  calendarId: z.string().min(1),
  attendeeIds: z.array(z.string().min(1)).min(1).max(10),
  candidate: recurringScheduleCandidateSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true })
});

export const createRecurringDraftFromProposalInputSchema = z.object({
  proposalId: z.string().uuid(),
  title: z.string().min(1).max(140),
  visibility: eventVisibilitySchema.default("public"),
  location: z.string().max(160).optional(),
  agenda: z.string().max(2_000).optional()
});

export const timeAwayInputSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(140).default("Vacation"),
  transferEventIds: z.array(z.string().min(1)).max(10).default([]),
  transferToUserId: z.string().min(1).optional()
}).refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), {
  message: "Time away must end after it starts.",
  path: ["endsAt"]
}).refine((input) => input.transferEventIds.length === 0 || Boolean(input.transferToUserId), {
  message: "Choose a delegate for transferred events.",
  path: ["transferToUserId"]
});

export const timeAwayChangeSetSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  status: z.literal("pending"),
  timeAwayEvent: calendarEventSchema,
  cancellations: z.array(z.object({ eventId: z.string().min(1), expectedRevision: z.number().int().positive() })).max(20),
  transfers: z.array(z.object({ eventId: z.string().min(1), expectedRevision: z.number().int().positive(), newOwnerId: z.string().min(1) })).max(10)
});

export const eventDraftSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  revision: z.number().int().positive(),
  event: calendarEventSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  status: z.literal("pending"),
  recurrenceSource: z.object({ proposalId: z.string().uuid() }).optional()
});

export const draftCommitConfirmationSchema = z.object({
  id: z.string().min(1),
  draftId: z.string().min(1),
  ownerId: z.string().min(1),
  draftRevision: z.number().int().positive(),
  expiresAt: z.string().datetime({ offset: true })
});

export const changeSetCommitConfirmationSchema = z.object({
  id: z.string().min(1),
  changeSetId: z.string().min(1),
  ownerId: z.string().min(1),
  changeSetRevision: z.number().int().positive(),
  expiresAt: z.string().datetime({ offset: true })
});

export const commitDraftInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  confirmationId: z.string().uuid()
});

export const commitReceiptSchema = z.object({
  key: z.string().min(16).max(128),
  ownerId: z.string().min(1),
  draftId: z.string().min(1),
  event: calendarEventSchema
});

export const changeSetCommitReceiptSchema = z.object({
  key: z.string().min(16).max(128),
  ownerId: z.string().min(1),
  changeSetId: z.string().min(1),
  events: z.array(calendarEventSchema).min(1).max(32)
});

export const auditEntrySchema = z.object({
  id: z.string().min(1),
  actor: z.literal("human"),
  actorId: z.string().min(1),
  action: z.enum(["created", "updated", "moved", "drafted", "discarded", "committed", "cancelled", "transferred", "time_away"]),
  targetId: z.string().min(1),
  summary: z.string().min(1).max(240),
  createdAt: z.string().datetime({ offset: true })
});

export const demoDataSchema = z.object({
  people: z.array(personSchema).min(1),
  schedulingProfiles: z.array(schedulingProfileSchema).optional(),
  calendars: z.array(calendarSchema).min(1),
  events: z.array(calendarEventSchema)
});

export type Person = z.infer<typeof personSchema>;
export type Weekday = z.infer<typeof weekdaySchema>;
export type SchedulingProfile = z.infer<typeof schedulingProfileSchema>;
export type Calendar = z.infer<typeof calendarSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type DemoData = z.infer<typeof demoDataSchema>;
export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;
export type WeeklyRecurrence = z.infer<typeof weeklyRecurrenceSchema>;
export type WeeklyRecurrenceRequest = z.infer<typeof weeklyRecurrenceRequestSchema>;
export type RecurringScheduleRequest = z.infer<typeof recurringScheduleRequestSchema>;
export type ScheduleCandidate = z.infer<typeof scheduleCandidateSchema>;
export type RecurringScheduleCandidate = z.infer<typeof recurringScheduleCandidateSchema>;
export type RecurringProposal = z.infer<typeof recurringProposalSchema>;
export type CreateRecurringDraftFromProposalInput = z.infer<typeof createRecurringDraftFromProposalInputSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type DraftCommitConfirmation = z.infer<typeof draftCommitConfirmationSchema>;
export type ChangeSetCommitConfirmation = z.infer<typeof changeSetCommitConfirmationSchema>;
export type CommitReceipt = z.infer<typeof commitReceiptSchema>;
export type ChangeSetCommitReceipt = z.infer<typeof changeSetCommitReceiptSchema>;
export type TimeAwayInput = z.infer<typeof timeAwayInputSchema>;
export type TimeAwayChangeSet = z.infer<typeof timeAwayChangeSetSchema>;
