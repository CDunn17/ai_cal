import { z } from "zod";

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

export const calendarSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(80),
  timeZone: timeZoneSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const eventVisibilitySchema = z.enum(["public", "private"]);
export const eventStatusSchema = z.enum(["confirmed", "tentative", "draft"]);

export const calendarEventSchema = z
  .object({
    id: z.string().min(1),
    calendarId: z.string().min(1),
    revision: z.number().int().positive(),
    title: z.string().min(1).max(140),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema,
    visibility: eventVisibilitySchema,
    status: eventStatusSchema,
    attendeeIds: z.array(z.string().min(1)).max(20),
    location: z.string().max(160).optional(),
    agenda: z.string().max(2_000).optional()
  })
  .refine((event) => Date.parse(event.endsAt) > Date.parse(event.startsAt), {
    message: "An event must end after it starts.",
    path: ["endsAt"]
  });

export const demoDataSchema = z.object({
  people: z.array(personSchema).min(1),
  calendars: z.array(calendarSchema).min(1),
  events: z.array(calendarEventSchema)
});

export type Person = z.infer<typeof personSchema>;
export type Calendar = z.infer<typeof calendarSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type DemoData = z.infer<typeof demoDataSchema>;
