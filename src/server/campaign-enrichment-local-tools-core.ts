import { createHash } from "node:crypto";
import {
  campaignEnrichmentProposalSubmissionSchema,
  type CampaignEnrichmentProposalSubmission,
  type CampaignEnrichmentQueueItem,
} from "../lib/campaign-enrichment-local-tool-contract";

type TemporalValue = string | Date | null;

export type EnrichmentRelevantLead = {
  id: string;
  campaign_id: string;
  exact_edit_track_id: string | null;
  target_name: string;
  target_type: string;
  target_url: string | null;
  contact_route: string | null;
  contact_route_verified_at: TemporalValue;
  discovery_source: string;
  recommending_person: string | null;
  introduction_available: boolean | null;
  musical_fit: string | null;
  relationship_warmth: number;
  editorial_fit: number;
  useful_reach: number;
  direct_free_access: number;
  pipeline_stage: string;
  pitch_angle: string | null;
  last_contacted_at: TemporalValue;
  follow_up_at: TemporalValue;
  outcome: string | null;
  evidence_url: string | null;
  published_at: TemporalValue;
  updated_at: TemporalValue;
};

export type EnrichmentSuggestionIdentity = {
  id: string;
  suggestion_type: string;
  status: "pending" | "accepted" | "rejected" | "superseded";
  updated_at: TemporalValue;
};

export function buildLeadRevision(
  lead: EnrichmentRelevantLead,
  suggestions: readonly EnrichmentSuggestionIdentity[],
): string {
  const accepted = suggestions
    .filter((item) => item.status === "accepted")
    .map(({ id, suggestion_type, updated_at }) => ({
      id,
      suggestion_type,
      updated_at: normalizeTemporal(updated_at),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash("sha256")
    .update(stableJson({ lead: projectLead(lead), accepted }))
    .digest("hex");
}

export function buildSubmissionHash(input: CampaignEnrichmentProposalSubmission): string {
  const parsed = campaignEnrichmentProposalSubmissionSchema.parse(input);
  const { idempotency_key: _idempotencyKey, ...submission } = parsed;

  return createHash("sha256").update(stableJson(submission)).digest("hex");
}

export function compareEnrichmentQueueItems(
  left: CampaignEnrichmentQueueItem,
  right: CampaignEnrichmentQueueItem,
): number {
  return Number(right.introduction_available) - Number(left.introduction_available)
    || Number(isWarmDiscovery(right.discovery_source)) - Number(isWarmDiscovery(left.discovery_source))
    || right.relationship_warmth - left.relationship_warmth
    || right.editorial_fit - left.editorial_fit
    || right.useful_reach - left.useful_reach
    || right.direct_free_access - left.direct_free_access
    || left.lead_id.localeCompare(right.lead_id);
}

function projectLead(lead: EnrichmentRelevantLead) {
  return {
    id: lead.id,
    campaign_id: lead.campaign_id,
    exact_edit_track_id: lead.exact_edit_track_id,
    target_name: lead.target_name,
    target_type: lead.target_type,
    target_url: lead.target_url,
    contact_route: lead.contact_route,
    contact_route_verified_at: normalizeTemporal(lead.contact_route_verified_at),
    discovery_source: lead.discovery_source,
    recommending_person: lead.recommending_person,
    introduction_available: lead.introduction_available,
    musical_fit: lead.musical_fit,
    relationship_warmth: lead.relationship_warmth,
    editorial_fit: lead.editorial_fit,
    useful_reach: lead.useful_reach,
    direct_free_access: lead.direct_free_access,
    pipeline_stage: lead.pipeline_stage,
    pitch_angle: lead.pitch_angle,
    last_contacted_at: normalizeTemporal(lead.last_contacted_at),
    follow_up_at: normalizeTemporal(lead.follow_up_at),
    outcome: lead.outcome,
    evidence_url: lead.evidence_url,
    published_at: normalizeTemporal(lead.published_at),
    updated_at: normalizeTemporal(lead.updated_at),
  };
}

function isWarmDiscovery(discoverySource: string): boolean {
  const normalized = discoverySource.trim().toLocaleLowerCase("en");
  return normalized === "friend recommendation" || normalized === "existing relationship";
}

function normalizeTemporal(value: TemporalValue): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
