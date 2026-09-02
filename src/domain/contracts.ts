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

export const personSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(80),
  timeZone: timeZoneSchema,
  workingHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
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
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
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
export const eventStatusSchema = z.enum(["confirmed", "tentative", "draft"]);
export const weeklyRecurrenceSchema = z.object({
  frequency: z.literal("weekly"),
  weekday: weekdaySchema,
  occurrenceCount: z.number().int().min(2).max(12)
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
  recurrence: weeklyRecurrenceSchema
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
  })).min(2).max(12)
});

export const eventDraftSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  revision: z.number().int().positive(),
  event: calendarEventSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  status: z.literal("pending")
});

export const draftCommitConfirmationSchema = z.object({
  id: z.string().min(1),
  draftId: z.string().min(1),
  ownerId: z.string().min(1),
  draftRevision: z.number().int().positive(),
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

export const auditEntrySchema = z.object({
  id: z.string().min(1),
  actor: z.literal("human"),
  actorId: z.string().min(1),
  action: z.enum(["created", "updated", "moved", "drafted", "discarded", "committed"]),
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
export type RecurringScheduleRequest = z.infer<typeof recurringScheduleRequestSchema>;
export type ScheduleCandidate = z.infer<typeof scheduleCandidateSchema>;
export type RecurringScheduleCandidate = z.infer<typeof recurringScheduleCandidateSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type DraftCommitConfirmation = z.infer<typeof draftCommitConfirmationSchema>;
export type CommitReceipt = z.infer<typeof commitReceiptSchema>;
