import { z } from "zod";
import { idSchema, nullableText } from "./validation";

export const CAMPAIGN_PIPELINE_STAGES = [
  "identified",
  "qualified",
  "ready",
  "sent",
  "responded",
  "confirmed",
  "published",
  "nurture",
] as const;

export const CAMPAIGN_TARGET_TYPES = [
  "radio_station",
  "radio_show",
  "youtube_channel",
  "editorial",
  "community",
  "premiere",
  "guest_mix",
  "other",
] as const;

export const campaignPipelineStageSchema = z.enum(CAMPAIGN_PIPELINE_STAGES);
export const campaignTargetTypeSchema = z.enum(CAMPAIGN_TARGET_TYPES);

const scoreField = z.coerce.number().int();

export const campaignLeadScoresSchema = z.object({
  relationship_warmth: scoreField.min(0).max(3),
  editorial_fit: scoreField.min(0).max(3),
  useful_reach: scoreField.min(0).max(2),
  direct_free_access: scoreField.min(0).max(2),
});

const campaignLeadFields = {
  source_id: nullableText,
  contact_id: nullableText,
  station_id: nullableText,
  exact_edit_track_id: nullableText,
  target_name: z.string().trim().min(1, "Target name is required"),
  target_type: campaignTargetTypeSchema,
  target_url: nullableText,
  contact_route: nullableText,
  discovery_source: z.string().trim().min(1, "Discovery source is required"),
  recommending_person: nullableText,
  introduction_available: z.preprocess(
    (value) => value === "" || value === null ? null : value,
    z.boolean().nullable().optional(),
  ),
  musical_fit: nullableText,
  relationship_warmth: campaignLeadScoresSchema.shape.relationship_warmth,
  editorial_fit: campaignLeadScoresSchema.shape.editorial_fit,
  useful_reach: campaignLeadScoresSchema.shape.useful_reach,
  direct_free_access: campaignLeadScoresSchema.shape.direct_free_access,
  pipeline_stage: campaignPipelineStageSchema,
  pitch_angle: nullableText,
  last_contacted_at: nullableText,
  follow_up_at: nullableText,
  outcome: nullableText,
  evidence_url: nullableText,
  published_at: nullableText,
  notes: nullableText,
};

export const createCampaignLeadSchema = z.object({
  id: idSchema.optional(),
  campaign_id: idSchema,
  dedupe_key: nullableText,
  ...campaignLeadFields,
});

export const updateCampaignLeadSchema = z.object({
  id: idSchema,
  campaign_id: idSchema,
  source_id: campaignLeadFields.source_id.optional(),
  contact_id: campaignLeadFields.contact_id.optional(),
  station_id: campaignLeadFields.station_id.optional(),
  exact_edit_track_id: campaignLeadFields.exact_edit_track_id.optional(),
  target_name: campaignLeadFields.target_name.optional(),
  target_type: campaignLeadFields.target_type.optional(),
  target_url: campaignLeadFields.target_url.optional(),
  contact_route: campaignLeadFields.contact_route.optional(),
  discovery_source: campaignLeadFields.discovery_source.optional(),
  recommending_person: campaignLeadFields.recommending_person.optional(),
  introduction_available: z.preprocess(
    (value) => value === "" ? null : value === "true" ? true : value === "false" ? false : value,
    z.boolean().nullable().optional(),
  ),
  musical_fit: campaignLeadFields.musical_fit.optional(),
  relationship_warmth: campaignLeadFields.relationship_warmth.optional(),
  editorial_fit: campaignLeadFields.editorial_fit.optional(),
  useful_reach: campaignLeadFields.useful_reach.optional(),
  direct_free_access: campaignLeadFields.direct_free_access.optional(),
  pitch_angle: campaignLeadFields.pitch_angle.optional(),
  last_contacted_at: campaignLeadFields.last_contacted_at.optional(),
  follow_up_at: campaignLeadFields.follow_up_at.optional(),
  outcome: campaignLeadFields.outcome.optional(),
  evidence_url: campaignLeadFields.evidence_url.optional(),
  published_at: campaignLeadFields.published_at.optional(),
  notes: campaignLeadFields.notes.optional(),
}).refine((value) => Object.keys(value).some((key) => !["id", "campaign_id"].includes(key)), {
  message: "At least one lead field must be updated",
});

export const createCampaignDogfoodEntrySchema = z.object({
  id: idSchema.optional(),
  campaign_id: idSchema,
  entry_type: z.enum(["bug", "friction", "missing_field", "improvement"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  title: z.string().trim().min(1, "Title is required"),
  details: nullableText,
  ui_surface: nullableText,
  status: z.enum(["logged", "triaged", "in_progress", "fixed", "wont_fix"]).default("logged"),
  evidence_url: nullableText,
  linked_lead_id: idSchema.nullable().optional(),
  linked_draft_id: idSchema.nullable().optional(),
  linked_enrichment_run_id: idSchema.nullable().optional(),
  linked_page_revision_id: idSchema.nullable().optional(),
});

export const updateCampaignDogfoodEntrySchema = z.object({
  id: idSchema,
  campaign_id: idSchema,
  severity: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  title: z.string().trim().min(1).optional(),
  details: nullableText.optional(),
  ui_surface: nullableText.optional(),
  status: z.enum(["logged", "triaged", "in_progress", "fixed", "wont_fix"]).optional(),
  evidence_url: nullableText.optional(),
  linked_lead_id: idSchema.nullable().optional(),
  linked_draft_id: idSchema.nullable().optional(),
  linked_enrichment_run_id: idSchema.nullable().optional(),
  linked_page_revision_id: idSchema.nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => !["id", "campaign_id"].includes(key)), {
  message: "At least one dogfood field must be updated",
});

export type CampaignLeadScores = z.infer<typeof campaignLeadScoresSchema>;
export type CreateCampaignLeadInput = z.infer<typeof createCampaignLeadSchema>;
export type UpdateCampaignLeadInput = z.infer<typeof updateCampaignLeadSchema>;
export type CreateCampaignDogfoodEntryInput = z.infer<typeof createCampaignDogfoodEntrySchema>;
export type UpdateCampaignDogfoodEntryInput = z.infer<typeof updateCampaignDogfoodEntrySchema>;

export function scoreCampaignLeadPriority(scores: CampaignLeadScores): number {
  const parsed = campaignLeadScoresSchema.parse(scores);
  return parsed.relationship_warmth + parsed.editorial_fit + parsed.useful_reach + parsed.direct_free_access;
}

export function buildCampaignLeadDedupeKey(input: {
  station_id?: string | null;
  contact_id?: string | null;
  target_url?: string | null;
  target_name: string;
}): string {
  if (input.station_id?.trim()) return `station:${input.station_id.trim()}`;
  if (input.contact_id?.trim()) return `contact:${input.contact_id.trim()}`;

  const normalizedUrl = normalizeTargetUrl(input.target_url);
  if (normalizedUrl) return `url:${normalizedUrl}`;

  const normalizedName = input.target_name.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  return `name:${normalizedName}`;
}

function normalizeTargetUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLocaleLowerCase("en").replace(/\/$/, "");
  }
}
