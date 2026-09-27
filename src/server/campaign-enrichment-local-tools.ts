import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  artists,
  campaign_communicator_prompts,
  campaign_enrichment_claims,
  campaign_enrichment_runs,
  campaign_enrichment_suggestions,
  campaign_leads,
  campaign_outreach_events,
  campaigns,
  releases,
  tracks,
} from "../db/schema";
import {
  campaignEnrichmentEvidenceSchema,
  campaignEnrichmentEvidenceUrlSchema,
  campaignEnrichmentClaimRequestSchema,
  campaignEnrichmentProposalSubmissionSchema,
  campaignEnrichmentQueueQuerySchema,
  campaignEnrichmentReleaseRequestSchema,
  type CampaignEnrichmentClaimRequest,
  type CampaignEnrichmentItem,
  type CampaignEnrichmentQueueItem,
  type CampaignEnrichmentQueueQuery,
  type CampaignEnrichmentEvidence,
  type CampaignEnrichmentSuggestion,
  type EnrichmentProposalField,
} from "../lib/campaign-enrichment-local-tool-contract";
import {
  buildLeadRevision,
  buildSubmissionHash,
  compareEnrichmentQueueItems,
  type EnrichmentRelevantLead,
  type EnrichmentSuggestionIdentity,
} from "./campaign-enrichment-local-tools-core";
import { LocalToolError } from "./local-tools-api";
import type { LocalToolPrincipal } from "./local-tool-tokens";

const MAX_ITEM_SUGGESTIONS_PER_STATE = 50;
const MAX_RELEASE_TRACKS = 100;
const MAX_ACCEPTED_IDENTITIES_PER_ITEM = 100;
const MAX_QUEUE_ACCEPTED_IDENTITIES = 50 * MAX_ACCEPTED_IDENTITIES_PER_ITEM;
const MAX_LABEL_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;
const MAX_VALUE_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 20_000;

type TemporalValue = string | Date | null;

export type CampaignEnrichmentQueueSource = {
  org_id: string;
  campaign_id: string;
  campaign_name: string;
  lead: EnrichmentRelevantLead;
  exact_edit: string | null;
  accepted_suggestion_identities: EnrichmentSuggestionIdentity[];
  claim_expires_at: TemporalValue;
};

export type CampaignEnrichmentSuggestionSource = {
  id: string;
  suggestion_type: string;
  suggested_value: Record<string, unknown>;
  evidence: unknown;
  status: "pending" | "accepted" | "rejected" | "superseded";
  created_at: TemporalValue;
  updated_at: TemporalValue;
};

export type CampaignEnrichmentItemSource = CampaignEnrichmentQueueSource & {
  campaign_goal: string | null;
  artist_name: string | null;
  release_title: string | null;
  track_titles: string[];
  prompt: { id: string; version: number; text: string } | null;
  suggestions: CampaignEnrichmentSuggestionSource[];
};

export interface CampaignEnrichmentLocalToolStore {
  listQueueRows(
    orgId: string,
    query: CampaignEnrichmentQueueQuery,
    now: Date,
  ): Promise<CampaignEnrichmentQueueSource[]>;
  loadItem(orgId: string, leadId: string, now: Date): Promise<CampaignEnrichmentItemSource | null>;
  transaction<T>(operation: (transaction: CampaignEnrichmentClaimTransaction) => Promise<T>): Promise<T>;
}

export type CampaignEnrichmentLocalToolDependencies = {
  store: CampaignEnrichmentLocalToolStore;
  now: () => Date;
  randomUUID: () => string;
};

export type CampaignEnrichmentClaimRow = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  token_id: string;
  user_id: string;
  claimed_at: Date;
  renewed_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type CampaignEnrichmentClaimResult = CampaignEnrichmentClaimRow & {
  result_category: "claimed" | "renewed" | "reclaimed";
};

export type CampaignEnrichmentProposalRunRow = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  prompt_id: string | null;
  status: "completed";
  source_kind: "codex_mcp";
  submitted_by_user_id: string;
  local_tool_token_id: string;
  expected_lead_revision: string;
  idempotency_key: string;
  submission_hash: string;
  client_metadata: {
    name: "label-suite-codex";
    version: string;
    session_label: string | null;
  };
  started_at: Date;
  completed_at: Date;
  failure_reason: null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignEnrichmentProposalSuggestionRow = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  enrichment_run_id: string;
  suggestion_type: EnrichmentProposalField;
  suggested_value: { value: string; rationale: string };
  evidence: CampaignEnrichmentEvidence[];
  status: "pending" | "accepted" | "rejected" | "superseded";
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignEnrichmentProposalEventRow = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  draft_id: null;
  event_type: "enrichment_proposals_submitted";
  actor_user_id: string;
  occurred_at: Date;
  details: {
    enrichment_run_id: string;
    suggestion_ids: string[];
    suggestion_count: number;
  };
  created_at: Date;
  updated_at: Date;
};

export type CampaignEnrichmentProposalResult = {
  created: boolean;
  run_id: string;
  campaign_id: string;
  lead_id: string;
  suggestions: Array<{
    id: string;
    suggestion_type: EnrichmentProposalField;
  }>;
};

type CampaignEnrichmentProposalSuggestionCandidate = {
  suggestion_type: string;
  suggested_value: unknown;
  status: string;
};

type ValidatedCampaignEnrichmentProposalSuggestion<T> = Omit<
  T,
  "suggestion_type" | "suggested_value" | "status"
> & Pick<CampaignEnrichmentProposalSuggestionRow, "suggestion_type" | "suggested_value" | "status">;

export function validateCampaignEnrichmentProposalSuggestionRows<
  T extends CampaignEnrichmentProposalSuggestionCandidate,
>(rows: readonly T[]): Array<ValidatedCampaignEnrichmentProposalSuggestion<T>> {
  if (rows.some((row) => (
    !isEnrichmentProposalField(row.suggestion_type)
    || !isSuggestionStatus(row.status)
    || !isSuggestedValue(row.suggested_value)
  ))) {
    throw new LocalToolError("idempotency_conflict");
  }
  return rows.map((row) => ({
    ...row,
    suggestion_type: row.suggestion_type as EnrichmentProposalField,
    suggested_value: row.suggested_value as CampaignEnrichmentProposalSuggestionRow["suggested_value"],
    status: row.status as CampaignEnrichmentProposalSuggestionRow["status"],
  }));
}

export interface CampaignEnrichmentClaimTransaction {
  lockLead(orgId: string, leadId: string): Promise<EnrichmentRelevantLead | null>;
  listAcceptedSuggestionIdentities(
    orgId: string,
    campaignId: string,
    leadId: string,
  ): Promise<EnrichmentSuggestionIdentity[]>;
  findClaimForUpdate(
    orgId: string,
    campaignId: string,
    leadId: string,
  ): Promise<CampaignEnrichmentClaimRow | null>;
  findRunByIdempotencyKeyForUpdate(
    orgId: string,
    sourceKind: "codex_mcp",
    idempotencyKey: string,
  ): Promise<CampaignEnrichmentProposalRunRow | null>;
  listSuggestionsByRun(
    orgId: string,
    campaignId: string,
    leadId: string,
    runId: string,
  ): Promise<CampaignEnrichmentProposalSuggestionRow[]>;
  insertClaim(row: CampaignEnrichmentClaimRow): Promise<CampaignEnrichmentClaimRow>;
  updateClaim(
    orgId: string,
    campaignId: string,
    leadId: string,
    claimId: string,
    changes: Partial<CampaignEnrichmentClaimRow>,
  ): Promise<CampaignEnrichmentClaimRow | null>;
  insertRun(row: CampaignEnrichmentProposalRunRow): Promise<CampaignEnrichmentProposalRunRow>;
  insertSuggestions(rows: CampaignEnrichmentProposalSuggestionRow[]): Promise<void>;
  insertEvent(row: CampaignEnrichmentProposalEventRow): Promise<void>;
  deleteOwnedClaim(
    orgId: string,
    campaignId: string,
    leadId: string,
    claimId: string,
    tokenId: string,
    userId: string,
  ): Promise<boolean>;
}

export async function listCampaignEnrichmentQueue(
  principal: LocalToolPrincipal,
  input: unknown,
  dependencies: CampaignEnrichmentLocalToolDependencies = defaultDependencies,
): Promise<{ items: CampaignEnrichmentQueueItem[] }> {
  const query = campaignEnrichmentQueueQuerySchema.parse(input);
  const now = dependencies.now();
  const rows = await dependencies.store.listQueueRows(principal.orgId, query, now);
  const items = rows
    .filter((row) => row.org_id === principal.orgId)
    .filter((row) => !query.campaign_id || row.campaign_id === query.campaign_id)
    .filter((row) => queueStateMatches(row.claim_expires_at, query.state, now))
    .map((row) => {
      assertAcceptedIdentityBound(row.accepted_suggestion_identities);
      return toQueueItem(row, now);
    })
    .sort(compareEnrichmentQueueItems)
    .slice(0, query.limit);

  return { items };
}

export async function getCampaignEnrichmentItem(
  principal: LocalToolPrincipal,
  itemId: string,
  dependencies: CampaignEnrichmentLocalToolDependencies = defaultDependencies,
): Promise<CampaignEnrichmentItem> {
  const now = dependencies.now();
  const source = await dependencies.store.loadItem(principal.orgId, itemId, now);
  if (
    !source
    || source.org_id !== principal.orgId
    || source.lead.id !== itemId
    || source.lead.campaign_id !== source.campaign_id
  ) {
    throw new LocalToolError("not_found");
  }
  assertAcceptedIdentityBound(source.accepted_suggestion_identities);
  assertAcceptedIdentityBound(source.suggestions.filter((row) => row.status === "accepted"));

  const acceptedResearch = source.suggestions
    .filter((row) => row.status === "accepted")
    .slice(0, MAX_ITEM_SUGGESTIONS_PER_STATE)
    .flatMap((row) => projectSuggestion(row, "accepted"));
  const pendingSuggestions = source.suggestions
    .filter((row) => row.status === "pending")
    .slice(0, MAX_ITEM_SUGGESTIONS_PER_STATE)
    .flatMap((row) => projectSuggestion(row, "pending"));
  const revisionIdentities = new Map(
    source.accepted_suggestion_identities.map((row) => [row.id, row]),
  );
  for (const row of source.suggestions) {
    revisionIdentities.set(row.id, {
      id: row.id,
      suggestion_type: row.suggestion_type,
      status: row.status,
      updated_at: row.updated_at,
    });
  }
  const queueItem = toQueueItem({
    ...source,
    accepted_suggestion_identities: [...revisionIdentities.values()],
  }, now, acceptedResearch);

  return {
    ...queueItem,
    campaign: {
      goal: boundNullableText(source.campaign_goal, MAX_CONTEXT_LENGTH),
      artist_name: boundNullableText(source.artist_name, MAX_LABEL_LENGTH),
      release_title: boundNullableText(source.release_title, MAX_LABEL_LENGTH),
      track_titles: source.track_titles.slice(0, MAX_RELEASE_TRACKS)
        .map((title) => boundText(title, MAX_LABEL_LENGTH)),
    },
    lead: {
      target_type: source.lead.target_type,
      contact_route: boundNullableText(source.lead.contact_route, MAX_LABEL_LENGTH),
      contact_route_verified_at: toIso(source.lead.contact_route_verified_at),
      pitch_angle: boundNullableText(source.lead.pitch_angle, MAX_VALUE_LENGTH),
      last_contacted_at: toIso(source.lead.last_contacted_at),
      follow_up_at: toIso(source.lead.follow_up_at),
      outcome: boundNullableText(source.lead.outcome, MAX_VALUE_LENGTH),
      evidence_url: validEvidenceUrlOrNull(source.lead.evidence_url),
      published_at: toIso(source.lead.published_at),
    },
    canonical_lead: {
      id: source.lead.id,
      campaign_id: source.lead.campaign_id,
      exact_edit_track_id: source.lead.exact_edit_track_id,
      target_name: boundText(source.lead.target_name, MAX_LABEL_LENGTH),
      target_type: source.lead.target_type,
      target_url: boundNullableText(source.lead.target_url, MAX_URL_LENGTH),
      contact_route: boundNullableText(source.lead.contact_route, MAX_LABEL_LENGTH),
      contact_route_verified_at: toIso(source.lead.contact_route_verified_at),
      discovery_source: boundText(source.lead.discovery_source, MAX_LABEL_LENGTH),
      recommending_person: boundNullableText(source.lead.recommending_person, MAX_LABEL_LENGTH),
      introduction_available: source.lead.introduction_available,
      musical_fit: boundNullableText(source.lead.musical_fit, MAX_VALUE_LENGTH),
      relationship_warmth: source.lead.relationship_warmth,
      editorial_fit: source.lead.editorial_fit,
      useful_reach: source.lead.useful_reach,
      direct_free_access: source.lead.direct_free_access,
      pipeline_stage: source.lead.pipeline_stage,
      pitch_angle: boundNullableText(source.lead.pitch_angle, MAX_VALUE_LENGTH),
      last_contacted_at: toIso(source.lead.last_contacted_at),
      follow_up_at: toIso(source.lead.follow_up_at),
      outcome: boundNullableText(source.lead.outcome, MAX_VALUE_LENGTH),
      evidence_url: validEvidenceUrlOrNull(source.lead.evidence_url),
      published_at: toIso(source.lead.published_at),
      updated_at: toIso(source.lead.updated_at),
    },
    prompt: source.prompt
      ? { ...source.prompt, text: boundText(source.prompt.text, MAX_CONTEXT_LENGTH) }
      : null,
    accepted_research: acceptedResearch,
    pending_suggestions: pendingSuggestions,
  };
}

export async function claimCampaignEnrichmentItem(
  principal: LocalToolPrincipal,
  itemId: string,
  input: CampaignEnrichmentClaimRequest,
  dependencies: CampaignEnrichmentLocalToolDependencies = defaultDependencies,
): Promise<CampaignEnrichmentClaimResult> {
  const request = campaignEnrichmentClaimRequestSchema.parse(input);

  return dependencies.store.transaction(async (transaction) => {
    const lead = await transaction.lockLead(principal.orgId, itemId);
    if (!lead || lead.id !== itemId) throw new LocalToolError("not_found");
    const accepted = await transaction.listAcceptedSuggestionIdentities(
      principal.orgId,
      lead.campaign_id,
      lead.id,
    );
    assertAcceptedIdentityBound(accepted);
    if (buildLeadRevision(lead, accepted) !== request.expected_lead_revision) {
      throw new LocalToolError("stale_revision");
    }

    const claim = await transaction.findClaimForUpdate(principal.orgId, lead.campaign_id, lead.id);
    const now = dependencies.now();
    const expiresAt = new Date(now.getTime() + Math.min(request.lease_minutes, 20) * 60_000);
    if (!claim) {
      const row: CampaignEnrichmentClaimRow = {
        id: dependencies.randomUUID(),
        org_id: principal.orgId,
        campaign_id: lead.campaign_id,
        lead_id: lead.id,
        token_id: principal.tokenId,
        user_id: principal.userId,
        claimed_at: now,
        renewed_at: null,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      };
      return { ...await transaction.insertClaim(row), result_category: "claimed" };
    }

    const sameOwner = claim.token_id === principal.tokenId && claim.user_id === principal.userId;
    if (sameOwner) {
      const renewed = await transaction.updateClaim(
        principal.orgId,
        lead.campaign_id,
        lead.id,
        claim.id,
        { renewed_at: now, expires_at: expiresAt, updated_at: now },
      );
      if (!renewed) throw new Error("Owned campaign enrichment claim disappeared while locked");
      return { ...renewed, result_category: "renewed" };
    }

    if (claim.expires_at.getTime() > now.getTime()) {
      throw new LocalToolError("claim_conflict", {
        expires_at: claim.expires_at.toISOString(),
      });
    }

    const replacement = await transaction.updateClaim(
      principal.orgId,
      lead.campaign_id,
      lead.id,
      claim.id,
      {
        id: dependencies.randomUUID(),
        token_id: principal.tokenId,
        user_id: principal.userId,
        claimed_at: now,
        renewed_at: null,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      },
    );
    if (!replacement) throw new Error("Expired campaign enrichment claim disappeared while locked");
    return { ...replacement, result_category: "reclaimed" };
  });
}

export async function releaseCampaignEnrichmentItem(
  principal: LocalToolPrincipal,
  itemId: string,
  claimId: string,
  dependencies: CampaignEnrichmentLocalToolDependencies = defaultDependencies,
): Promise<{ released: true; result_category: "released" | "release_noop" }> {
  const release = campaignEnrichmentReleaseRequestSchema.parse({ claim_id: claimId });

  return dependencies.store.transaction(async (transaction) => {
    const lead = await transaction.lockLead(principal.orgId, itemId);
    if (!lead || lead.id !== itemId) return { released: true, result_category: "release_noop" };
    const claim = await transaction.findClaimForUpdate(principal.orgId, lead.campaign_id, lead.id);
    const now = dependencies.now();
    if (
      !claim
      || claim.id !== release.claim_id
      || claim.expires_at.getTime() <= now.getTime()
      || claim.token_id !== principal.tokenId
      || claim.user_id !== principal.userId
    ) {
      return { released: true, result_category: "release_noop" };
    }

    const released = await transaction.deleteOwnedClaim(
      principal.orgId,
      lead.campaign_id,
      lead.id,
      release.claim_id,
      principal.tokenId,
      principal.userId,
    );
    return { released: true, result_category: released ? "released" : "release_noop" };
  });
}

export async function submitCampaignEnrichmentProposal(
  principal: LocalToolPrincipal,
  itemId: string,
  input: unknown,
  dependencies: CampaignEnrichmentLocalToolDependencies = defaultDependencies,
): Promise<CampaignEnrichmentProposalResult> {
  const submission = campaignEnrichmentProposalSubmissionSchema.parse(input);
  const submissionHash = buildSubmissionHash(submission);

  return dependencies.store.transaction(async (transaction) => {
    const lead = await transaction.lockLead(principal.orgId, itemId);
    if (!lead || lead.id !== itemId) {
      const existingRun = await transaction.findRunByIdempotencyKeyForUpdate(
        principal.orgId,
        "codex_mcp",
        submission.idempotency_key,
      );
      if (existingRun && existingRun.lead_id !== itemId) {
        throw new LocalToolError("idempotency_conflict");
      }
      throw new LocalToolError("not_found");
    }

    const accepted = await transaction.listAcceptedSuggestionIdentities(
      principal.orgId,
      lead.campaign_id,
      lead.id,
    );
    assertAcceptedIdentityBound(accepted);
    const claim = await transaction.findClaimForUpdate(
      principal.orgId,
      lead.campaign_id,
      lead.id,
    );
    const existingRun = await transaction.findRunByIdempotencyKeyForUpdate(
      principal.orgId,
      "codex_mcp",
      submission.idempotency_key,
    );

    if (existingRun) {
      if (
        existingRun.lead_id !== lead.id
        || existingRun.campaign_id !== lead.campaign_id
        || existingRun.local_tool_token_id !== principal.tokenId
        || existingRun.expected_lead_revision !== submission.expected_lead_revision
        || existingRun.submission_hash !== submissionHash
        || existingRun.status !== "completed"
        || existingRun.client_metadata.name !== submission.client.name
        || existingRun.client_metadata.version !== submission.client.version
        || existingRun.client_metadata.session_label !== submission.client.session_label
      ) {
        throw new LocalToolError("idempotency_conflict");
      }
      const existingSuggestions = await transaction.listSuggestionsByRun(
        principal.orgId,
        lead.campaign_id,
        lead.id,
        existingRun.id,
      );
      return safeProposalResult(
        existingRun.id,
        existingSuggestions,
        submission.proposals.map((proposal) => proposal.field),
        false,
      );
    }

    const now = dependencies.now();
    if (
      !claim
      || claim.id !== submission.claim_id
      || claim.org_id !== principal.orgId
      || claim.campaign_id !== lead.campaign_id
      || claim.lead_id !== lead.id
      || claim.token_id !== principal.tokenId
      || claim.user_id !== principal.userId
      || claim.expires_at.getTime() <= now.getTime()
    ) {
      throw new LocalToolError("claim_conflict");
    }
    if (buildLeadRevision(lead, accepted) !== submission.expected_lead_revision) {
      throw new LocalToolError("stale_revision");
    }

    const run: CampaignEnrichmentProposalRunRow = {
      id: dependencies.randomUUID(),
      org_id: principal.orgId,
      campaign_id: lead.campaign_id,
      lead_id: lead.id,
      prompt_id: null,
      status: "completed",
      source_kind: "codex_mcp",
      submitted_by_user_id: principal.userId,
      local_tool_token_id: principal.tokenId,
      expected_lead_revision: submission.expected_lead_revision,
      idempotency_key: submission.idempotency_key,
      submission_hash: submissionHash,
      client_metadata: { ...submission.client },
      started_at: now,
      completed_at: now,
      failure_reason: null,
      created_at: now,
      updated_at: now,
    };
    const suggestions: CampaignEnrichmentProposalSuggestionRow[] = submission.proposals.map((proposal) => ({
      id: dependencies.randomUUID(),
      org_id: principal.orgId,
      campaign_id: lead.campaign_id,
      lead_id: lead.id,
      enrichment_run_id: run.id,
      suggestion_type: proposal.field,
      suggested_value: { value: proposal.value, rationale: proposal.rationale },
      evidence: proposal.evidence.map((entry) => ({ ...entry })),
      status: "pending",
      resolved_by: null,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    }));

    try {
      await transaction.insertRun(run);
    } catch (error) {
      if (isUniqueViolation(error, "campaign_enrichment_runs_local_tool_idempotency_unique_idx")) {
        throw new LocalToolError("idempotency_conflict");
      }
      throw error;
    }
    await transaction.insertSuggestions(suggestions);
    await transaction.insertEvent({
      id: dependencies.randomUUID(),
      org_id: principal.orgId,
      campaign_id: lead.campaign_id,
      lead_id: lead.id,
      draft_id: null,
      event_type: "enrichment_proposals_submitted",
      actor_user_id: principal.userId,
      occurred_at: now,
      details: {
        enrichment_run_id: run.id,
        suggestion_ids: suggestions.map((suggestion) => suggestion.id),
        suggestion_count: suggestions.length,
      },
      created_at: now,
      updated_at: now,
    });
    const released = await transaction.deleteOwnedClaim(
      principal.orgId,
      lead.campaign_id,
      lead.id,
      claim.id,
      principal.tokenId,
      principal.userId,
    );
    if (!released) throw new LocalToolError("claim_conflict");

    return safeProposalResult(
      run.id,
      suggestions,
      submission.proposals.map((proposal) => proposal.field),
      true,
    );
  });
}

function toQueueItem(
  source: CampaignEnrichmentQueueSource,
  now: Date,
  acceptedResearch: readonly CampaignEnrichmentSuggestion[] = [],
): CampaignEnrichmentQueueItem {
  const activeClaimExpiry = isFuture(source.claim_expires_at, now)
    ? toIso(source.claim_expires_at)
    : null;
  return {
    item_id: source.lead.id,
    campaign_id: source.campaign_id,
    campaign_name: boundText(source.campaign_name, MAX_LABEL_LENGTH),
    lead_id: source.lead.id,
    target_name: boundText(source.lead.target_name, MAX_LABEL_LENGTH),
    target_url: boundNullableText(source.lead.target_url, MAX_URL_LENGTH),
    discovery_source: boundText(source.lead.discovery_source, MAX_LABEL_LENGTH),
    recommending_person: boundNullableText(source.lead.recommending_person, MAX_LABEL_LENGTH),
    introduction_available: source.lead.introduction_available,
    relationship_warmth: source.lead.relationship_warmth,
    musical_fit: boundNullableText(source.lead.musical_fit, MAX_VALUE_LENGTH),
    exact_edit: boundNullableText(source.exact_edit, MAX_LABEL_LENGTH),
    editorial_fit: source.lead.editorial_fit,
    useful_reach: source.lead.useful_reach,
    direct_free_access: source.lead.direct_free_access,
    missing_enrichment_fields: missingEnrichmentFields(
      source.lead,
      source.accepted_suggestion_identities,
      acceptedResearch,
    ),
    lead_revision: buildLeadRevision(source.lead, source.accepted_suggestion_identities),
    pipeline_stage: source.lead.pipeline_stage,
    claim: activeClaimExpiry
      ? { status: "claimed", expires_at: activeClaimExpiry }
      : { status: "unclaimed", expires_at: null },
  };
}

function missingEnrichmentFields(
  lead: EnrichmentRelevantLead,
  acceptedIdentities: readonly EnrichmentSuggestionIdentity[],
  acceptedResearch: readonly CampaignEnrichmentSuggestion[],
): EnrichmentProposalField[] {
  const missing: EnrichmentProposalField[] = [];
  if (!hasText(lead.musical_fit)) missing.push("musical_fit");
  if (!hasText(lead.pitch_angle)) missing.push("pitch_angle");
  if (!hasText(lead.contact_route)) missing.push("contact_route");
  const hasProgrammingFocus = acceptedIdentities.some((row) => (
    row.status === "accepted" && row.suggestion_type === "programming_focus"
  )) || acceptedResearch.some((row) => row.suggestion_type === "programming_focus" && hasText(row.value));
  if (!hasProgrammingFocus) {
    missing.push("programming_focus");
  }
  return missing;
}

function projectSuggestion(
  source: CampaignEnrichmentSuggestionSource,
  status: "pending" | "accepted",
): CampaignEnrichmentSuggestion[] {
  if (!isEnrichmentProposalField(source.suggestion_type)) return [];
  const value = source.suggested_value.value;
  if (typeof value !== "string" || !value.trim()) return [];
  const rationale = source.suggested_value.rationale;
  const evidence = Array.isArray(source.evidence)
    ? source.evidence.flatMap((entry) => {
      const parsed = campaignEnrichmentEvidenceSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }).slice(0, 8)
    : [];

  return [{
    id: source.id,
    suggestion_type: source.suggestion_type,
    value: boundText(value, MAX_VALUE_LENGTH),
    rationale: typeof rationale === "string" && rationale.trim()
      ? boundText(rationale, MAX_VALUE_LENGTH)
      : null,
    evidence,
    status,
    created_at: toIso(source.created_at) ?? new Date(0).toISOString(),
    updated_at: toIso(source.updated_at) ?? new Date(0).toISOString(),
  }];
}

function isEnrichmentProposalField(value: string): value is EnrichmentProposalField {
  return value === "musical_fit"
    || value === "pitch_angle"
    || value === "contact_route"
    || value === "programming_focus";
}

function queueStateMatches(
  expiresAt: TemporalValue,
  state: CampaignEnrichmentQueueQuery["state"],
  now: Date,
) {
  if (state === "all") return true;
  return state === "claimed" ? isFuture(expiresAt, now) : !isFuture(expiresAt, now);
}

function isFuture(value: TemporalValue, now: Date) {
  const instant = value instanceof Date ? value : value ? new Date(value) : null;
  return Boolean(instant && !Number.isNaN(instant.getTime()) && instant.getTime() > now.getTime());
}

function toIso(value: TemporalValue): string | null {
  if (value === null) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

function boundText(value: string, limit: number) {
  return value.length <= limit ? value : value.slice(0, limit);
}

function boundNullableText(value: string | null, limit: number) {
  return value === null ? null : boundText(value, limit);
}

function validEvidenceUrlOrNull(value: string | null) {
  if (value === null) return null;
  const parsed = campaignEnrichmentEvidenceUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function assertAcceptedIdentityBound(rows: readonly { status: string }[]) {
  if (rows.filter((row) => row.status === "accepted").length > MAX_ACCEPTED_IDENTITIES_PER_ITEM) {
    throw new LocalToolError("service_unavailable");
  }
}

function safeProposalResult(
  runId: string,
  suggestions: readonly CampaignEnrichmentProposalSuggestionRow[],
  expectedFields: readonly EnrichmentProposalField[],
  created: boolean,
): CampaignEnrichmentProposalResult {
  const safeSuggestions = suggestions.flatMap((suggestion) => (
    isEnrichmentProposalField(suggestion.suggestion_type)
      ? [{ id: suggestion.id, suggestion_type: suggestion.suggestion_type }]
      : []
  ));
  if (
    suggestions.length < 1
    || suggestions.length > 8
    || suggestions.length !== expectedFields.length
    || safeSuggestions.length !== suggestions.length
    || new Set(safeSuggestions.map((suggestion) => suggestion.id)).size !== safeSuggestions.length
    || new Set(safeSuggestions.map((suggestion) => suggestion.suggestion_type)).size !== safeSuggestions.length
    || expectedFields.some((field) => !safeSuggestions.some((suggestion) => suggestion.suggestion_type === field))
    || suggestions.some((suggestion) => (
      suggestion.campaign_id !== suggestions[0]?.campaign_id
      || suggestion.lead_id !== suggestions[0]?.lead_id
    ))
  ) {
    throw new LocalToolError("idempotency_conflict");
  }
  return {
    created,
    run_id: runId,
    campaign_id: suggestions[0].campaign_id,
    lead_id: suggestions[0].lead_id,
    suggestions: safeSuggestions,
  };
}

function isUniqueViolation(error: unknown, constraint: string) {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

function isProposalClientMetadata(
  value: Record<string, unknown>,
): value is CampaignEnrichmentProposalRunRow["client_metadata"] {
  const keys = Object.keys(value);
  return keys.length === 3
    && keys.every((key) => key === "name" || key === "version" || key === "session_label")
    && value.name === "label-suite-codex"
    && typeof value.version === "string"
    && value.version.trim().length > 0
    && value.version.length <= 40
    && (value.session_label === null || (
      typeof value.session_label === "string"
      && value.session_label.trim().length > 0
      && value.session_label.length <= 120
    ));
}

function isSuggestionStatus(value: string): value is CampaignEnrichmentProposalSuggestionRow["status"] {
  return value === "pending" || value === "accepted" || value === "rejected" || value === "superseded";
}

function isSuggestedValue(
  value: unknown,
): value is CampaignEnrichmentProposalSuggestionRow["suggested_value"] {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { value?: unknown }).value === "string"
    && typeof (value as { rationale?: unknown }).rationale === "string",
  );
}

const drizzleStore: CampaignEnrichmentLocalToolStore = {
  async listQueueRows(orgId, query, now) {
    const { db } = await import("../lib/db");
    const conditions = [
      eq(campaign_leads.org_id, orgId),
      eq(campaigns.org_id, orgId),
    ];
    if (query.campaign_id) {
      conditions.push(eq(campaign_leads.campaign_id, query.campaign_id));
      conditions.push(eq(campaigns.id, query.campaign_id));
    }
    if (query.state === "claimed") {
      conditions.push(gt(campaign_enrichment_claims.expires_at, now));
    } else if (query.state === "unclaimed") {
      conditions.push(or(
        isNull(campaign_enrichment_claims.id),
        lte(campaign_enrichment_claims.expires_at, now),
      )!);
    }

    const rows = await db.select({
      org_id: campaign_leads.org_id,
      campaign_id: campaign_leads.campaign_id,
      campaign_name: campaigns.campaign_name,
      exact_edit: tracks.title,
      claim_expires_at: campaign_enrichment_claims.expires_at,
      lead_id: campaign_leads.id,
      exact_edit_track_id: campaign_leads.exact_edit_track_id,
      target_name: campaign_leads.target_name,
      target_type: campaign_leads.target_type,
      target_url: campaign_leads.target_url,
      contact_route: campaign_leads.contact_route,
      contact_route_verified_at: campaign_leads.contact_route_verified_at,
      discovery_source: campaign_leads.discovery_source,
      recommending_person: campaign_leads.recommending_person,
      introduction_available: campaign_leads.introduction_available,
      musical_fit: campaign_leads.musical_fit,
      relationship_warmth: campaign_leads.relationship_warmth,
      editorial_fit: campaign_leads.editorial_fit,
      useful_reach: campaign_leads.useful_reach,
      direct_free_access: campaign_leads.direct_free_access,
      pipeline_stage: campaign_leads.pipeline_stage,
      pitch_angle: campaign_leads.pitch_angle,
      last_contacted_at: campaign_leads.last_contacted_at,
      follow_up_at: campaign_leads.follow_up_at,
      outcome: campaign_leads.outcome,
      evidence_url: campaign_leads.evidence_url,
      published_at: campaign_leads.published_at,
      updated_at: campaign_leads.updated_at,
    }).from(campaign_leads)
      .innerJoin(campaigns, and(
        eq(campaigns.org_id, orgId),
        eq(campaigns.id, campaign_leads.campaign_id),
      ))
      .leftJoin(tracks, and(
        eq(tracks.org_id, orgId),
        eq(tracks.id, campaign_leads.exact_edit_track_id),
      ))
      .leftJoin(campaign_enrichment_claims, and(
        eq(campaign_enrichment_claims.org_id, orgId),
        eq(campaign_enrichment_claims.campaign_id, campaign_leads.campaign_id),
        eq(campaign_enrichment_claims.lead_id, campaign_leads.id),
      ))
      .where(and(...conditions))
      .orderBy(
        desc(sql<number>`case when ${campaign_leads.introduction_available} = true then 1 else 0 end`),
        desc(sql<number>`case when lower(trim(${campaign_leads.discovery_source})) in ('friend recommendation', 'existing relationship') then 1 else 0 end`),
        desc(campaign_leads.relationship_warmth),
        desc(campaign_leads.editorial_fit),
        desc(campaign_leads.useful_reach),
        desc(campaign_leads.direct_free_access),
        asc(campaign_leads.id),
      )
      .limit(query.limit);

    const identities = rows.length
      ? await db.select({
        id: campaign_enrichment_suggestions.id,
        campaign_id: campaign_enrichment_suggestions.campaign_id,
        lead_id: campaign_enrichment_suggestions.lead_id,
        suggestion_type: campaign_enrichment_suggestions.suggestion_type,
        status: campaign_enrichment_suggestions.status,
        updated_at: campaign_enrichment_suggestions.updated_at,
      }).from(campaign_enrichment_suggestions).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.status, "accepted"),
        inArray(campaign_enrichment_suggestions.lead_id, rows.map((row) => row.lead_id)),
        query.campaign_id
          ? eq(campaign_enrichment_suggestions.campaign_id, query.campaign_id)
          : inArray(campaign_enrichment_suggestions.campaign_id, [...new Set(rows.map((row) => row.campaign_id))]),
      )).limit(MAX_QUEUE_ACCEPTED_IDENTITIES + 1)
      : [];
    if (identities.length > MAX_QUEUE_ACCEPTED_IDENTITIES) {
      throw new LocalToolError("service_unavailable");
    }

    return rows.map((row) => ({
      org_id: row.org_id,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      exact_edit: row.exact_edit,
      claim_expires_at: row.claim_expires_at,
      accepted_suggestion_identities: identities.flatMap((identity) => (
        identity.lead_id === row.lead_id && identity.campaign_id === row.campaign_id
          ? [{
            id: identity.id,
            suggestion_type: identity.suggestion_type,
            status: identity.status as EnrichmentSuggestionIdentity["status"],
            updated_at: identity.updated_at,
          }]
          : []
      )),
      lead: {
        id: row.lead_id,
        campaign_id: row.campaign_id,
        exact_edit_track_id: row.exact_edit_track_id,
        target_name: row.target_name,
        target_type: row.target_type,
        target_url: row.target_url,
        contact_route: row.contact_route,
        contact_route_verified_at: row.contact_route_verified_at,
        discovery_source: row.discovery_source,
        recommending_person: row.recommending_person,
        introduction_available: row.introduction_available,
        musical_fit: row.musical_fit,
        relationship_warmth: row.relationship_warmth,
        editorial_fit: row.editorial_fit,
        useful_reach: row.useful_reach,
        direct_free_access: row.direct_free_access,
        pipeline_stage: row.pipeline_stage,
        pitch_angle: row.pitch_angle,
        last_contacted_at: row.last_contacted_at,
        follow_up_at: row.follow_up_at,
        outcome: row.outcome,
        evidence_url: row.evidence_url,
        published_at: row.published_at,
        updated_at: row.updated_at,
      },
    }));
  },

  async loadItem(orgId, leadId, _now) {
    const { db } = await import("../lib/db");
    const row = (await db.select({
      org_id: campaign_leads.org_id,
      campaign_id: campaign_leads.campaign_id,
      campaign_name: campaigns.campaign_name,
      campaign_goal: campaigns.goal,
      linked_release_id: campaigns.linked_release_id,
      artist_name: artists.name,
      release_title: releases.title,
      exact_edit: tracks.title,
      lead_id: campaign_leads.id,
      exact_edit_track_id: campaign_leads.exact_edit_track_id,
      target_name: campaign_leads.target_name,
      target_type: campaign_leads.target_type,
      target_url: campaign_leads.target_url,
      contact_route: campaign_leads.contact_route,
      contact_route_verified_at: campaign_leads.contact_route_verified_at,
      discovery_source: campaign_leads.discovery_source,
      recommending_person: campaign_leads.recommending_person,
      introduction_available: campaign_leads.introduction_available,
      musical_fit: campaign_leads.musical_fit,
      relationship_warmth: campaign_leads.relationship_warmth,
      editorial_fit: campaign_leads.editorial_fit,
      useful_reach: campaign_leads.useful_reach,
      direct_free_access: campaign_leads.direct_free_access,
      pipeline_stage: campaign_leads.pipeline_stage,
      pitch_angle: campaign_leads.pitch_angle,
      last_contacted_at: campaign_leads.last_contacted_at,
      follow_up_at: campaign_leads.follow_up_at,
      outcome: campaign_leads.outcome,
      evidence_url: campaign_leads.evidence_url,
      published_at: campaign_leads.published_at,
      updated_at: campaign_leads.updated_at,
    }).from(campaign_leads)
      .innerJoin(campaigns, and(
        eq(campaigns.org_id, orgId),
        eq(campaigns.id, campaign_leads.campaign_id),
      ))
      .leftJoin(releases, and(
        eq(releases.org_id, orgId),
        eq(releases.id, campaigns.linked_release_id),
      ))
      .leftJoin(artists, and(
        eq(artists.org_id, orgId),
        eq(artists.id, campaigns.linked_artist_id),
      ))
      .leftJoin(tracks, and(
        eq(tracks.org_id, orgId),
        eq(tracks.id, campaign_leads.exact_edit_track_id),
      ))
      .where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.id, leadId),
      )).limit(1))[0];
    if (!row) return null;

    const [releaseTracks, prompt, acceptedIdentities, acceptedRows, pendingRows, claim] = await Promise.all([
      row.linked_release_id
        ? db.select({ title: tracks.title }).from(tracks).where(and(
          eq(tracks.org_id, orgId),
          eq(tracks.release_id, row.linked_release_id),
        )).orderBy(asc(tracks.position), asc(tracks.id)).limit(MAX_RELEASE_TRACKS)
        : Promise.resolve([]),
      db.select({
        id: campaign_communicator_prompts.id,
        version: campaign_communicator_prompts.version,
        text: campaign_communicator_prompts.prompt,
      }).from(campaign_communicator_prompts).where(and(
        eq(campaign_communicator_prompts.org_id, orgId),
        eq(campaign_communicator_prompts.campaign_id, row.campaign_id),
      )).orderBy(desc(campaign_communicator_prompts.version), desc(campaign_communicator_prompts.id)).limit(1),
      db.select({
        id: campaign_enrichment_suggestions.id,
        suggestion_type: campaign_enrichment_suggestions.suggestion_type,
        status: campaign_enrichment_suggestions.status,
        updated_at: campaign_enrichment_suggestions.updated_at,
      }).from(campaign_enrichment_suggestions).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, row.campaign_id),
        eq(campaign_enrichment_suggestions.lead_id, row.lead_id),
        eq(campaign_enrichment_suggestions.status, "accepted"),
      )).limit(MAX_ACCEPTED_IDENTITIES_PER_ITEM + 1),
      loadSuggestionRows(db, orgId, row.campaign_id, row.lead_id, "accepted"),
      loadSuggestionRows(db, orgId, row.campaign_id, row.lead_id, "pending"),
      db.select({ expires_at: campaign_enrichment_claims.expires_at })
        .from(campaign_enrichment_claims).where(and(
          eq(campaign_enrichment_claims.org_id, orgId),
          eq(campaign_enrichment_claims.campaign_id, row.campaign_id),
          eq(campaign_enrichment_claims.lead_id, row.lead_id),
        )).limit(1),
    ]);

    return {
      org_id: row.org_id,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      campaign_goal: row.campaign_goal,
      artist_name: row.artist_name,
      release_title: row.release_title,
      track_titles: releaseTracks.map((track) => track.title),
      exact_edit: row.exact_edit,
      claim_expires_at: claim[0]?.expires_at ?? null,
      prompt: prompt[0] ?? null,
      accepted_suggestion_identities: acceptedIdentities.map((identity) => ({
        id: identity.id,
        suggestion_type: identity.suggestion_type,
        status: identity.status as EnrichmentSuggestionIdentity["status"],
        updated_at: identity.updated_at,
      })),
      suggestions: [...acceptedRows, ...pendingRows],
      lead: {
        id: row.lead_id,
        campaign_id: row.campaign_id,
        exact_edit_track_id: row.exact_edit_track_id,
        target_name: row.target_name,
        target_type: row.target_type,
        target_url: row.target_url,
        contact_route: row.contact_route,
        contact_route_verified_at: row.contact_route_verified_at,
        discovery_source: row.discovery_source,
        recommending_person: row.recommending_person,
        introduction_available: row.introduction_available,
        musical_fit: row.musical_fit,
        relationship_warmth: row.relationship_warmth,
        editorial_fit: row.editorial_fit,
        useful_reach: row.useful_reach,
        direct_free_access: row.direct_free_access,
        pipeline_stage: row.pipeline_stage,
        pitch_angle: row.pitch_angle,
        last_contacted_at: row.last_contacted_at,
        follow_up_at: row.follow_up_at,
        outcome: row.outcome,
        evidence_url: row.evidence_url,
        published_at: row.published_at,
        updated_at: row.updated_at,
      },
    };
  },

  async transaction(operation) {
    const { db } = await import("../lib/db");
    return db.transaction(async (transaction) => operation(makeDrizzleClaimTransaction(transaction)));
  },
};

type DrizzleClaimExecutor = Pick<
  Awaited<typeof import("../lib/db")>["db"],
  "select" | "insert" | "update" | "delete"
>;

function makeDrizzleClaimTransaction(executor: DrizzleClaimExecutor): CampaignEnrichmentClaimTransaction {
  return {
    async lockLead(orgId, leadId) {
      const row = (await executor.select({
        id: campaign_leads.id,
        campaign_id: campaign_leads.campaign_id,
        exact_edit_track_id: campaign_leads.exact_edit_track_id,
        target_name: campaign_leads.target_name,
        target_type: campaign_leads.target_type,
        target_url: campaign_leads.target_url,
        contact_route: campaign_leads.contact_route,
        contact_route_verified_at: campaign_leads.contact_route_verified_at,
        discovery_source: campaign_leads.discovery_source,
        recommending_person: campaign_leads.recommending_person,
        introduction_available: campaign_leads.introduction_available,
        musical_fit: campaign_leads.musical_fit,
        relationship_warmth: campaign_leads.relationship_warmth,
        editorial_fit: campaign_leads.editorial_fit,
        useful_reach: campaign_leads.useful_reach,
        direct_free_access: campaign_leads.direct_free_access,
        pipeline_stage: campaign_leads.pipeline_stage,
        pitch_angle: campaign_leads.pitch_angle,
        last_contacted_at: campaign_leads.last_contacted_at,
        follow_up_at: campaign_leads.follow_up_at,
        outcome: campaign_leads.outcome,
        evidence_url: campaign_leads.evidence_url,
        published_at: campaign_leads.published_at,
        updated_at: campaign_leads.updated_at,
      }).from(campaign_leads).where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.id, leadId),
      )).for("update").limit(1))[0];
      return row ?? null;
    },
    async listAcceptedSuggestionIdentities(orgId, campaignId, leadId) {
      const rows = await executor.select({
        id: campaign_enrichment_suggestions.id,
        suggestion_type: campaign_enrichment_suggestions.suggestion_type,
        status: campaign_enrichment_suggestions.status,
        updated_at: campaign_enrichment_suggestions.updated_at,
      }).from(campaign_enrichment_suggestions).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, campaignId),
        eq(campaign_enrichment_suggestions.lead_id, leadId),
        eq(campaign_enrichment_suggestions.status, "accepted"),
      )).limit(MAX_ACCEPTED_IDENTITIES_PER_ITEM + 1);
      if (rows.length > MAX_ACCEPTED_IDENTITIES_PER_ITEM) {
        throw new LocalToolError("service_unavailable");
      }
      return rows.map((row) => ({
        ...row,
        status: row.status as EnrichmentSuggestionIdentity["status"],
      }));
    },
    async findClaimForUpdate(orgId, campaignId, leadId) {
      const row = (await executor.select().from(campaign_enrichment_claims).where(and(
        eq(campaign_enrichment_claims.org_id, orgId),
        eq(campaign_enrichment_claims.campaign_id, campaignId),
        eq(campaign_enrichment_claims.lead_id, leadId),
      )).for("update").limit(1))[0];
      return row ?? null;
    },
    async findRunByIdempotencyKeyForUpdate(orgId, sourceKind, idempotencyKey) {
      const row = (await executor.select().from(campaign_enrichment_runs).where(and(
        eq(campaign_enrichment_runs.org_id, orgId),
        eq(campaign_enrichment_runs.source_kind, sourceKind),
        eq(campaign_enrichment_runs.idempotency_key, idempotencyKey),
      )).for("update").limit(1))[0];
      if (!row) return null;
      if (
        row.status !== "completed"
        || row.source_kind !== "codex_mcp"
        || !row.submitted_by_user_id
        || !row.local_tool_token_id
        || !row.expected_lead_revision
        || !row.idempotency_key
        || !row.submission_hash
        || !row.started_at
        || !row.completed_at
        || !row.created_at
        || !row.updated_at
        || row.failure_reason !== null
        || !isProposalClientMetadata(row.client_metadata)
      ) {
        throw new LocalToolError("idempotency_conflict");
      }
      return {
        ...row,
        status: row.status,
        source_kind: row.source_kind,
        submitted_by_user_id: row.submitted_by_user_id,
        local_tool_token_id: row.local_tool_token_id,
        expected_lead_revision: row.expected_lead_revision,
        idempotency_key: row.idempotency_key,
        submission_hash: row.submission_hash,
        client_metadata: row.client_metadata,
        started_at: row.started_at,
        completed_at: row.completed_at,
        failure_reason: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    },
    async listSuggestionsByRun(orgId, campaignId, leadId, runId) {
      const rows = await executor.select().from(campaign_enrichment_suggestions).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, campaignId),
        eq(campaign_enrichment_suggestions.lead_id, leadId),
        eq(campaign_enrichment_suggestions.enrichment_run_id, runId),
      )).orderBy(asc(campaign_enrichment_suggestions.created_at), asc(campaign_enrichment_suggestions.id))
        .limit(9);
      return validateCampaignEnrichmentProposalSuggestionRows(rows).map((row) => ({
        ...row,
        evidence: row.evidence,
        resolved_at: row.resolved_at,
        created_at: row.created_at ?? new Date(0),
        updated_at: row.updated_at ?? new Date(0),
      }));
    },
    async insertClaim(row) {
      const inserted = (await executor.insert(campaign_enrichment_claims).values(row).returning())[0];
      if (!inserted) throw new Error("Campaign enrichment claim insert returned no record");
      return inserted;
    },
    async updateClaim(orgId, campaignId, leadId, claimId, changes) {
      return (await executor.update(campaign_enrichment_claims).set(changes).where(and(
        eq(campaign_enrichment_claims.org_id, orgId),
        eq(campaign_enrichment_claims.campaign_id, campaignId),
        eq(campaign_enrichment_claims.lead_id, leadId),
        eq(campaign_enrichment_claims.id, claimId),
      )).returning())[0] ?? null;
    },
    async insertRun(row) {
      const inserted = (await executor.insert(campaign_enrichment_runs).values(row).returning())[0];
      if (!inserted) throw new Error("Campaign enrichment proposal run insert returned no record");
      return row;
    },
    async insertSuggestions(rows) {
      if (rows.length) await executor.insert(campaign_enrichment_suggestions).values(rows);
    },
    async insertEvent(row) {
      await executor.insert(campaign_outreach_events).values(row);
    },
    async deleteOwnedClaim(orgId, campaignId, leadId, claimId, tokenId, userId) {
      const rows = await executor.delete(campaign_enrichment_claims).where(and(
        eq(campaign_enrichment_claims.org_id, orgId),
        eq(campaign_enrichment_claims.campaign_id, campaignId),
        eq(campaign_enrichment_claims.lead_id, leadId),
        eq(campaign_enrichment_claims.id, claimId),
        eq(campaign_enrichment_claims.token_id, tokenId),
        eq(campaign_enrichment_claims.user_id, userId),
      )).returning({ id: campaign_enrichment_claims.id });
      return rows.length === 1;
    },
  };
}

async function loadSuggestionRows(
  executor: Pick<Awaited<typeof import("../lib/db")>["db"], "select">,
  orgId: string,
  campaignId: string,
  leadId: string,
  status: "accepted" | "pending",
): Promise<CampaignEnrichmentSuggestionSource[]> {
  const rows = await executor.select({
    id: campaign_enrichment_suggestions.id,
    suggestion_type: campaign_enrichment_suggestions.suggestion_type,
    suggested_value: campaign_enrichment_suggestions.suggested_value,
    evidence: campaign_enrichment_suggestions.evidence,
    status: campaign_enrichment_suggestions.status,
    created_at: campaign_enrichment_suggestions.created_at,
    updated_at: campaign_enrichment_suggestions.updated_at,
  }).from(campaign_enrichment_suggestions).where(and(
    eq(campaign_enrichment_suggestions.org_id, orgId),
    eq(campaign_enrichment_suggestions.campaign_id, campaignId),
    eq(campaign_enrichment_suggestions.lead_id, leadId),
    eq(campaign_enrichment_suggestions.status, status),
  )).orderBy(desc(campaign_enrichment_suggestions.created_at), desc(campaign_enrichment_suggestions.id))
    .limit(MAX_ITEM_SUGGESTIONS_PER_STATE);
  return rows.map((row) => ({
    ...row,
    status: row.status as CampaignEnrichmentSuggestionSource["status"],
  }));
}

const defaultDependencies: CampaignEnrichmentLocalToolDependencies = {
  store: drizzleStore,
  now: () => new Date(),
  randomUUID,
};
