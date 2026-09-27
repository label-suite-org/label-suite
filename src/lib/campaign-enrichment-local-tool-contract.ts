import { z } from "zod";

export const LOCAL_TOOL_API_VERSION = "2026-08-10" as const;
export const LOCAL_TOOL_SCOPES = [
  "campaign.enrichment.read",
  "campaign.enrichment.claim",
  "campaign.enrichment.propose",
  "operator.diagnostics.read",
] as const;

export const localToolScopeSchema = z.enum(LOCAL_TOOL_SCOPES);
export const campaignEnrichmentQueueQuerySchema = z.object({
  campaign_id: z.string().trim().min(1).max(128).optional(),
  state: z.enum(["unclaimed", "claimed", "all"]).default("all"),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const campaignEnrichmentClaimRequestSchema = z.object({
  expected_lead_revision: z.string().regex(/^[a-f0-9]{64}$/),
  lease_minutes: z.number().int().min(1).max(20).default(20),
}).strict();
export const campaignEnrichmentReleaseRequestSchema = z.object({
  claim_id: z.string().trim().min(1).max(128),
}).strict();
export const localToolClaimConflictDetailsSchema = z.object({
  expires_at: z.iso.datetime({ offset: true }),
}).strict();
export const enrichmentProposalFieldSchema = z.enum([
  "musical_fit",
  "pitch_angle",
  "contact_route",
  "programming_focus",
]);
export const campaignEnrichmentEvidenceUrlSchema = z.url().max(2_048).refine(
  (value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  },
  "Evidence URL must use HTTPS",
);
export const campaignEnrichmentEvidenceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: campaignEnrichmentEvidenceUrlSchema,
  retrieved_at: z.iso.datetime({ offset: true }),
  citation_text: z.string().trim().min(1).max(1_000),
}).strict();
export const campaignEnrichmentProposalSubmissionSchema = z.object({
  claim_id: z.string().trim().min(1).max(128),
  expected_lead_revision: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key: z.uuid(),
  proposals: z.array(z.object({
    field: enrichmentProposalFieldSchema,
    value: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(2_000),
    evidence: z.array(campaignEnrichmentEvidenceSchema).min(1).max(8),
  }).strict()).min(1).max(8),
  client: z.object({
    name: z.literal("label-suite-codex"),
    version: z.string().trim().min(1).max(40),
    session_label: z.string().trim().min(1).max(120).nullable(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const fields = value.proposals.map((proposal) => proposal.field);
  if (new Set(fields).size !== fields.length) {
    context.addIssue({
      code: "custom",
      path: ["proposals"],
      message: "Proposal fields must be unique",
    });
  }
  value.proposals.forEach((proposal, proposalIndex) => {
    const evidenceKeys = new Set<string>();
    proposal.evidence.forEach((evidence, evidenceIndex) => {
      const key = canonicalEvidenceKey(evidence);
      if (evidenceKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["proposals", proposalIndex, "evidence", evidenceIndex],
          message: "Evidence entries must be unique",
        });
      }
      evidenceKeys.add(key);
    });
  });
});

function canonicalEvidenceKey(evidence: z.infer<typeof campaignEnrichmentEvidenceSchema>): string {
  const normalizedText = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return JSON.stringify([
    new URL(evidence.url).href,
    new Date(evidence.retrieved_at).toISOString(),
    normalizedText(evidence.title),
    normalizedText(evidence.citation_text),
  ]);
}

export type LocalToolScope = z.infer<typeof localToolScopeSchema>;
export type CampaignEnrichmentQueueQuery = z.infer<typeof campaignEnrichmentQueueQuerySchema>;
export type CampaignEnrichmentClaimRequest = z.infer<typeof campaignEnrichmentClaimRequestSchema>;
export type CampaignEnrichmentReleaseRequest = z.infer<typeof campaignEnrichmentReleaseRequestSchema>;
export type LocalToolClaimConflictDetails = z.infer<typeof localToolClaimConflictDetailsSchema>;
export type EnrichmentProposalField = z.infer<typeof enrichmentProposalFieldSchema>;
export type CampaignEnrichmentEvidence = z.infer<typeof campaignEnrichmentEvidenceSchema>;
export type CampaignEnrichmentProposalSubmission = z.infer<typeof campaignEnrichmentProposalSubmissionSchema>;

export type LocalToolClaimSummary = {
  status: "unclaimed" | "claimed";
  expires_at: string | null;
};

export type CampaignEnrichmentQueueItem = {
  item_id: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  target_name: string;
  target_url: string | null;
  discovery_source: string;
  recommending_person: string | null;
  introduction_available: boolean | null;
  relationship_warmth: number;
  musical_fit: string | null;
  exact_edit: string | null;
  editorial_fit: number;
  useful_reach: number;
  direct_free_access: number;
  missing_enrichment_fields: EnrichmentProposalField[];
  lead_revision: string;
  pipeline_stage: string;
  claim: LocalToolClaimSummary;
};

export type CampaignEnrichmentSuggestion = {
  id: string;
  suggestion_type: EnrichmentProposalField;
  value: string;
  rationale: string | null;
  evidence: CampaignEnrichmentEvidence[];
  status: "pending" | "accepted";
  created_at: string;
  updated_at: string;
};

export const CAMPAIGN_ENRICHMENT_CANONICAL_LEAD_FIELDS = [
  "id",
  "campaign_id",
  "exact_edit_track_id",
  "target_name",
  "target_type",
  "target_url",
  "contact_route",
  "contact_route_verified_at",
  "discovery_source",
  "recommending_person",
  "introduction_available",
  "musical_fit",
  "relationship_warmth",
  "editorial_fit",
  "useful_reach",
  "direct_free_access",
  "pipeline_stage",
  "pitch_angle",
  "last_contacted_at",
  "follow_up_at",
  "outcome",
  "evidence_url",
  "published_at",
  "updated_at",
] as const;

export type CampaignEnrichmentCanonicalLead = {
  id: string;
  campaign_id: string;
  exact_edit_track_id: string | null;
  target_name: string;
  target_type: string;
  target_url: string | null;
  contact_route: string | null;
  contact_route_verified_at: string | null;
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
  last_contacted_at: string | null;
  follow_up_at: string | null;
  outcome: string | null;
  evidence_url: string | null;
  published_at: string | null;
  updated_at: string | null;
};

export type CampaignEnrichmentItem = CampaignEnrichmentQueueItem & {
  campaign: {
    goal: string | null;
    artist_name: string | null;
    release_title: string | null;
    track_titles: string[];
  };
  lead: {
    target_type: string;
    contact_route: string | null;
    contact_route_verified_at: string | null;
    pitch_angle: string | null;
    last_contacted_at: string | null;
    follow_up_at: string | null;
    outcome: string | null;
    evidence_url: string | null;
    published_at: string | null;
  };
  canonical_lead: CampaignEnrichmentCanonicalLead;
  prompt: { id: string; version: number; text: string } | null;
  accepted_research: CampaignEnrichmentSuggestion[];
  pending_suggestions: CampaignEnrichmentSuggestion[];
};

export type LocalToolSuccessEnvelope<T> = {
  version: typeof LOCAL_TOOL_API_VERSION;
  request_id: string;
  data: T;
};
export type LocalToolErrorCode =
  | "authentication_failed"
  | "scope_forbidden"
  | "invalid_request"
  | "not_found"
  | "stale_revision"
  | "claim_conflict"
  | "idempotency_conflict"
  | "service_unavailable"
  | "internal_error";
type LocalToolErrorBase = {
  message: string;
  retryable: boolean;
};
export type LocalToolErrorPayload =
  | (LocalToolErrorBase & {
      code: "claim_conflict";
      details?: LocalToolClaimConflictDetails;
    })
  | (LocalToolErrorBase & {
      code: Exclude<LocalToolErrorCode, "claim_conflict">;
      details?: never;
    });
export type LocalToolErrorEnvelope = {
  version: typeof LOCAL_TOOL_API_VERSION;
  request_id: string;
  error: LocalToolErrorPayload;
};
export type LocalToolEnvelope<T> = LocalToolSuccessEnvelope<T> | LocalToolErrorEnvelope;
