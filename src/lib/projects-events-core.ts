import { z } from "zod";

export const projectTypeSchema = z.enum([
  "release",
  "tour",
  "music_video",
  "shoot",
  "concert",
  "production",
  "other",
]);

export const eventTypeSchema = z.enum([
  "concert",
  "tour",
  "release_party",
  "travel_day",
  "off_day",
  "rehearsal",
  "shoot",
  "music_video_production",
  "production_day",
  "deadline",
  "premiere",
  "meeting",
  "other",
]);

export const projectTypeLabels: Record<z.infer<typeof projectTypeSchema>, string> = {
  release: "Release",
  tour: "Tour",
  music_video: "Music video",
  shoot: "Shoot",
  concert: "Concert",
  production: "Production",
  other: "Other",
};

export const eventTypeLabels: Record<z.infer<typeof eventTypeSchema>, string> = {
  concert: "Concert",
  tour: "Tour",
  release_party: "Release party",
  travel_day: "Travel day",
  off_day: "Off day",
  rehearsal: "Rehearsal",
  shoot: "Shoot",
  music_video_production: "Music video production",
  production_day: "Production day",
  deadline: "Deadline",
  premiere: "Premiere",
  meeting: "Meeting",
  other: "Other",
};

const nullableId = z.string().trim().min(1).nullable().optional();
const nullableText = z.string().trim().min(1).nullable().optional();

export const projectDateRangeSchema = z.object({
  start_date: z.iso.date().nullable(),
  end_date: z.iso.date().nullable(),
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
});

const timestampEndpointSchema = z.union([z.iso.datetime({ offset: true }), z.date()]).nullable();

export const projectEventRangeSchema = projectDateRangeSchema.and(z.object({
  starts_at: timestampEndpointSchema,
  ends_at: timestampEndpointSchema,
}).superRefine((value, ctx) => {
  if (value.starts_at && value.ends_at && new Date(value.ends_at) < new Date(value.starts_at)) {
    ctx.addIssue({ code: "custom", path: ["ends_at"], message: "End time must be on or after start time" });
  }
}));

export const projectInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, "name is required"),
  project_type: projectTypeSchema.default("release"),
  artist_id: nullableId,
  release_id: nullableId,
  description: nullableText,
  owner_contact_id: nullableId,
  status: z.string().trim().min(1).default("planning"),
  start_date: z.iso.date().nullable().optional(),
  end_date: z.iso.date().nullable().optional(),
  location_name: nullableText,
  country_code: nullableText,
  timezone: nullableText,
  health: z.string().trim().min(1).default("on_track"),
  cover_image_url: nullableText,
  currency: z.string().trim().min(1).default("USD"),
  total_planned: z.number().default(0),
  baseline_funding: z.number().default(0),
  track_count: z.number().nullable().optional(),
  singles_count: z.number().nullable().optional(),
  notes: nullableText,
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
});

export const projectEventInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  event_type: eventTypeSchema,
  status: z.string().trim().min(1).default("planned"),
  start_date: z.iso.date(),
  end_date: z.iso.date().nullable().optional(),
  starts_at: z.iso.datetime({ offset: true }).nullable().optional(),
  ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
  project_id: nullableId,
  artist_id: nullableId,
  release_id: nullableId,
  contact_id: nullableId,
  owner_contact_id: nullableId,
  all_day: z.boolean().default(true),
  timezone: nullableText,
  venue_name: nullableText,
  address: nullableText,
  city: nullableText,
  region: nullableText,
  country_code: nullableText,
  notes: nullableText,
  is_confirmed: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
  if (value.starts_at && value.ends_at && value.ends_at < value.starts_at) {
    ctx.addIssue({ code: "custom", path: ["ends_at"], message: "End time must be on or after start time" });
  }
});

export function normalizeProjectInput(input: unknown) {
  return projectInputSchema.parse(input);
}

export function normalizeProjectEventInput(input: unknown) {
  return projectEventInputSchema.parse(input);
}

type OrderableProjectEvent = {
  start_date: string;
  starts_at?: string | Date | null;
  title?: string | null;
};

export function compareProjectEvents(a: OrderableProjectEvent, b: OrderableProjectEvent): number {
  const dateComparison = a.start_date.localeCompare(b.start_date);
  if (dateComparison !== 0) return dateComparison;

  const aTime = a.starts_at ? new Date(a.starts_at).getTime() : Number.NEGATIVE_INFINITY;
  const bTime = b.starts_at ? new Date(b.starts_at).getTime() : Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;

  return (a.title ?? "").localeCompare(b.title ?? "");
}
