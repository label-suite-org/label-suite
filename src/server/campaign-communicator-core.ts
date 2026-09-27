import { z } from "zod";
import { CAMPAIGN_PIPELINE_STAGES, campaignPipelineStageSchema } from "./campaign-outreach-core";
import { deriveCampaignDocument, type CampaignDocument } from "../lib/campaign-rich-text";

export type CampaignPipelineStage = (typeof CAMPAIGN_PIPELINE_STAGES)[number];

export type LeadQueueItem = {
  id: string;
  pipeline_stage: CampaignPipelineStage;
  priority_score: number;
  follow_up_at: Date | string | null;
  last_contacted_at: Date | string | null;
  updated_at: Date | string | null;
};

export type LeadQueue = {
  now: LeadQueueItem[];
  followUp: LeadQueueItem[];
  waiting: LeadQueueItem[];
  completed: LeadQueueItem[];
};

export type ReadyBlocker =
  | "contact_route"
  | "contact_route_verified_at"
  | "exact_edit_or_update"
  | "musical_fit"
  | "pitch_angle_or_batch"
  | "introduction_state"
  | "approved_draft"
  | "task_or_reason";

export type LeadReadinessInput = {
  contact_route: string | null | undefined;
  contact_route_verified_at: Date | string | null | undefined;
  exact_edit_track_id: string | null | undefined;
  campaign_wide_update?: boolean | string | null;
  musical_fit: string | null | undefined;
  pitch_angle: string | null | undefined;
  batch_update_assigned?: boolean;
  recommending_person: string | null | undefined;
  introduction_available: boolean | null | undefined;
  approved_draft_id: string | null | undefined;
  has_open_task?: boolean;
  tasks?: readonly { status: string | null | undefined }[];
  readiness_task_waiver_reason: string | null | undefined;
};

export type CitationEvidence = {
  title: string;
  url: string;
  retrieved_at: string;
  citation_text: string;
};

type SuggestionStatusInput = {
  status: string;
  evidence: readonly CitationEvidence[];
};

const TERMINAL_STAGES = new Set<CampaignPipelineStage>(["confirmed", "published", "nurture"]);
const CLOSED_TASK_STATUSES = new Set(["done", "completed", "cancelled", "canceled"]);

export function groupLeadQueue(leads: readonly LeadQueueItem[], now: Date): LeadQueue {
  const queue: LeadQueue = { now: [], followUp: [], waiting: [], completed: [] };

  for (const lead of leads) {
    if (TERMINAL_STAGES.has(lead.pipeline_stage)) {
      queue.completed.push(lead);
    } else if (isDue(lead.follow_up_at, now)) {
      queue.followUp.push(lead);
    } else if (lead.pipeline_stage === "sent") {
      queue.waiting.push(lead);
    } else {
      queue.now.push(lead);
    }
  }

  queue.followUp.sort(compareFollowUps);
  queue.now.sort(compareCurrentWork);
  queue.waiting.sort(compareCurrentWork);
  queue.completed.sort(compareCurrentWork);
  return queue;
}

export function getLeadReadyBlockers(lead: LeadReadinessInput): ReadyBlocker[] {
  const blockers: ReadyBlocker[] = [];
  if (!hasText(lead.contact_route)) blockers.push("contact_route");
  if (!hasTimestamp(lead.contact_route_verified_at)) blockers.push("contact_route_verified_at");
  if (!hasText(lead.exact_edit_track_id) && !hasExplicitUpdate(lead.campaign_wide_update)) blockers.push("exact_edit_or_update");
  if (!hasText(lead.musical_fit)) blockers.push("musical_fit");
  if (!hasText(lead.pitch_angle) && !lead.batch_update_assigned) blockers.push("pitch_angle_or_batch");
  if (hasText(lead.recommending_person) && (lead.introduction_available === null || lead.introduction_available === undefined)) {
    blockers.push("introduction_state");
  }
  if (!hasText(lead.approved_draft_id)) blockers.push("approved_draft");
  if (!hasOpenTask(lead) && !hasText(lead.readiness_task_waiver_reason)) blockers.push("task_or_reason");
  return blockers;
}

export function getDraftApprovalBlockers(lead: LeadReadinessInput): ReadyBlocker[] {
  return getLeadReadyBlockers(lead).filter((blocker) => blocker !== "approved_draft");
}

export function buildAcceptedDraftContext<TSuggestion extends SuggestionStatusInput, TInput extends { suggestions: readonly TSuggestion[] }>(
  input: TInput,
): Omit<TInput, "suggestions"> & { suggestions: TSuggestion[] } {
  return {
    ...input,
    suggestions: input.suggestions.filter((suggestion) => suggestion.status === "accepted" && hasUsableCitationEvidence(suggestion.evidence)),
  };
}

export function calculateSuggestedFollowUp(sentAt: Date): Date {
  const followUp = new Date(sentAt);
  followUp.setUTCDate(followUp.getUTCDate() + 14);
  return followUp;
}

export const decideSuggestionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  expected_lead_updated_at: z.string().datetime(),
}).strict();

export const generateDraftSchema = z.object({
  campaign_id: z.string().min(1),
  instruction: z.string().trim().max(500).nullable().default(null),
}).strict();

export const radioUpdateDraftSchema = z.object({
  page_revision_id: z.string().trim().min(1),
  instruction: z.string().trim().max(500).nullable().default(null),
}).strict();

export const campaignDraftDocumentSchema = z.custom<CampaignDocument>((value) => {
  if (!value || typeof value !== "object") return false;
  try {
    deriveCampaignDocument(value, 10_000);
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid campaign draft document" });

export const manualRadioUpdateDraftSchema = z.object({
  page_revision_id: z.string().trim().min(1),
  subject: z.string().trim().max(500).nullable(),
  body: z.string().trim().min(1).max(10_000).optional(),
  body_document: campaignDraftDocumentSchema.optional(),
}).strict().refine((value) => (value.body_document !== undefined && value.body_document !== null) || value.body !== undefined, {
  message: "Either body_document or body is required",
  path: ["body_document"],
});

export const recordSentSchema = z.object({
  campaign_id: z.string().min(1),
  approved_draft_id: z.string().min(1),
  channel: z.enum(["email", "instagram_dm", "soundcloud_message", "other"]),
  sent_at: z.string().datetime(),
  destination: z.string().trim().max(500).nullable().default(null),
  follow_up_at: z.string().datetime().nullable().optional(),
}).strict();

export const overrideLeadStageSchema = z.object({
  campaign_id: z.string().min(1),
  pipeline_stage: campaignPipelineStageSchema,
  reason: z.string().trim().min(10).max(1000),
}).strict();

function isDue(value: Date | string | null, now: Date) {
  const timestamp = toTimestamp(value);
  return timestamp !== null && timestamp <= now.getTime();
}

function compareFollowUps(left: LeadQueueItem, right: LeadQueueItem) {
  return compareTimestamp(left.follow_up_at, right.follow_up_at) || compareCurrentWork(left, right);
}

function compareCurrentWork(left: LeadQueueItem, right: LeadQueueItem) {
  return right.priority_score - left.priority_score
    || compareTimestamp(left.last_contacted_at ?? left.updated_at, right.last_contacted_at ?? right.updated_at)
    || left.id.localeCompare(right.id);
}

function compareTimestamp(left: Date | string | null, right: Date | string | null) {
  return (toTimestamp(left) ?? Number.MAX_SAFE_INTEGER) - (toTimestamp(right) ?? Number.MAX_SAFE_INTEGER);
}

function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function hasTimestamp(value: Date | string | null | undefined) {
  return toTimestamp(value) !== null;
}

function hasUsableCitationEvidence(evidence: readonly CitationEvidence[]) {
  return evidence.some((item) => (
    hasText(item.title)
    && hasHttpUrl(item.url)
    && hasTimestamp(item.retrieved_at)
    && hasText(item.citation_text)
  ));
}

function hasHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function hasExplicitUpdate(value: boolean | string | null | undefined) {
  return value === true || (typeof value === "string" && hasText(value));
}

function hasOpenTask(lead: LeadReadinessInput) {
  if (lead.has_open_task) return true;
  return lead.tasks?.some((task) => !CLOSED_TASK_STATUSES.has(task.status?.trim().toLocaleLowerCase("en") ?? "")) ?? false;
}
