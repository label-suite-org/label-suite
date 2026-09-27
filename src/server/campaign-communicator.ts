import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  artists,
  campaign_communicator_prompts,
  campaign_enrichment_runs,
  campaign_enrichment_suggestions,
  campaign_leads,
  campaign_stations,
  org_memberships,
  campaign_outreach_drafts,
  campaign_outreach_events,
  campaigns,
  campaign_public_pages,
  campaign_public_page_revisions,
  contacts,
  ops_tasks,
  releases,
  tracks,
} from "../db/schema";
import { users } from "../db/auth-schema";
import { db } from "../lib/db";
import {
  buildAcceptedDraftContext,
  calculateSuggestedFollowUp,
  decideSuggestionSchema,
  generateDraftSchema,
  getDraftApprovalBlockers,
  getLeadReadyBlockers,
  recordSentSchema,
  radioUpdateDraftSchema,
  manualRadioUpdateDraftSchema,
  type CampaignPipelineStage,
  type CitationEvidence,
  type ReadyBlocker,
} from "./campaign-communicator-core";
import { campaignPipelineStageSchema } from "./campaign-outreach-core";
import type {
  AcceptedDraftSuggestion,
  CampaignCommunicatorProvider,
  GenerateDraftInput,
  ResearchSuggestionField,
} from "./campaign-communicator-provider";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import {
  campaignPublicPageContentSchema,
  isCampaignPublicPageContentHashValid,
} from "./campaign-public-page-core";
import { isCampaignPublicPageRevisionFresh } from "./campaign-public-page";
import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  type CampaignCharacterLimit,
  type CampaignDocument,
} from "../lib/campaign-rich-text";

export const RESEARCH_COOLDOWN_MS = 15 * 60 * 1000;

export const updateLeadPreparationSchema = z.object({
  campaign_id: z.string().min(1),
  expected_updated_at: z.string().datetime().optional(),
  contact_route: z.string().trim().min(1).max(500).nullable().optional(),
  contact_route_verified: z.boolean().optional(),
  exact_edit_track_id: z.string().trim().min(1).nullable().optional(),
  recommending_person: z.string().trim().min(1).max(500).nullable().optional(),
  introduction_available: z.boolean().nullable().optional(),
  musical_fit: z.string().trim().min(1).max(2000).nullable().optional(),
  pitch_angle: z.string().trim().min(1).max(2000).nullable().optional(),
  readiness_task_waiver_reason: z.string().trim().min(10).max(1000).nullable().optional(),
}).strict().refine((value) => (
  value.contact_route !== undefined
  || value.contact_route_verified !== undefined
  || value.exact_edit_track_id !== undefined
  || value.recommending_person !== undefined
  || value.introduction_available !== undefined
  || value.musical_fit !== undefined
  || value.pitch_angle !== undefined
  || value.readiness_task_waiver_reason !== undefined
), { message: "At least one preparation field must be updated" });

export type CampaignCommunicatorCampaign = {
  id: string;
  org_id: string;
  campaign_name: string;
  artist_name: string | null;
  release_title: string | null;
};

export type CampaignCommunicatorLead = {
  id: string;
  org_id: string;
  campaign_id: string;
  campaign_name: string;
  artist_name: string | null;
  release_title: string | null;
  contact_id: string | null;
  contact_name: string | null;
  target_name: string;
  target_url: string | null;
  contact_route: string | null;
  contact_route_verified_at: Date | null;
  exact_edit_track_id: string | null;
  musical_fit: string | null;
  pitch_angle: string | null;
  recommending_person: string | null;
  introduction_available: boolean | null;
  readiness_task_waiver_reason: string | null;
  pipeline_stage: CampaignPipelineStage;
  last_contacted_at: Date | null;
  follow_up_at: Date | null;
  updated_at: Date | null;
};

export type CampaignCommunicatorPrompt = {
  id: string;
  org_id: string;
  campaign_id: string;
  version: number;
  prompt: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignCommunicatorResearchRun = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  prompt_id: string | null;
  status: "running" | "completed" | "failed" | "refused";
  started_at: Date;
  completed_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignCommunicatorSuggestion = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  enrichment_run_id: string;
  source_kind?: "in_app_provider" | "codex_mcp";
  provenance?: {
    submitting_operator: { id: string; name: string } | null;
    created_at: Date | null;
    lead_revision: string | null;
  };
  suggestion_type: string;
  suggested_value: Record<string, unknown>;
  evidence: CitationEvidence[];
  status: "pending" | "accepted" | "rejected" | "superseded";
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignCommunicatorDraft = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string | null;
  enrichment_run_id: string | null;
  scope: "focused" | "radio_update";
  version: number;
  status: "draft" | "approved" | "superseded";
  subject: string | null;
  body: string;
  body_document?: CampaignDocument | null;
  body_html?: string | null;
  body_document_repair_required?: boolean;
  body_document_repair_reason?: "malformed" | "over_limit";
  context_snapshot: Record<string, unknown>;
  approval_hash: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignRadioPageRevision = {
  org_id: string;
  id: string;
  campaign_id: string;
  page_id: string;
  version: number;
  review_status: "draft" | "reviewed" | "superseded";
  content_hash: string | null;
  content: Record<string, unknown>;
  source_snapshot: Record<string, unknown>;
};

export type CampaignCommunicatorEvent = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string | null;
  draft_id: string | null;
  event_type: string;
  actor_user_id: string | null;
  occurred_at: Date;
  details: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type CampaignCommunicatorTask = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  status: string | null;
};

type PromptInsert = CampaignCommunicatorPrompt;
type ResearchRunInsert = CampaignCommunicatorResearchRun;
type SuggestionInsert = CampaignCommunicatorSuggestion;
type DraftInsert = CampaignCommunicatorDraft;
type EventInsert = CampaignCommunicatorEvent;

export interface CampaignCommunicatorTransaction {
  /** Lock order is always campaign first, then lead. */
  lockCampaign(orgId: string, campaignId: string): Promise<boolean>;
  lockLead(orgId: string, campaignId: string, leadId: string): Promise<boolean>;
  findCampaign(orgId: string, campaignId: string): Promise<CampaignCommunicatorCampaign | null>;
  listCampaignLeads(orgId: string, campaignId: string): Promise<CampaignCommunicatorLead[]>;
  findLead(orgId: string, leadId: string): Promise<CampaignCommunicatorLead | null>;
  findLatestPrompt(orgId: string, campaignId: string): Promise<CampaignCommunicatorPrompt | null>;
  findReviewedPageRevision(orgId: string, campaignId: string, revisionId: string): Promise<CampaignRadioPageRevision | null>;
  checkReviewedPageRevisionFresh(orgId: string, campaignId: string, revisionId: string): Promise<boolean>;
  listSuggestions(orgId: string, campaignId: string, leadId?: string): Promise<CampaignCommunicatorSuggestion[]>;
  findSuggestion(orgId: string, suggestionId: string): Promise<CampaignCommunicatorSuggestion | null>;
  listDrafts(orgId: string, campaignId: string, leadId?: string | null): Promise<CampaignCommunicatorDraft[]>;
  findDraft(orgId: string, draftId: string): Promise<CampaignCommunicatorDraft | null>;
  listEvents(orgId: string, campaignId: string, leadId?: string): Promise<CampaignCommunicatorEvent[]>;
  listLeadTasks(orgId: string, campaignId: string, leadId: string): Promise<CampaignCommunicatorTask[]>;
  findRunningResearch(orgId: string, leadId: string): Promise<CampaignCommunicatorResearchRun | null>;
  findRecentResearchStart(orgId: string, leadId: string, actorUserId: string, since: Date): Promise<CampaignCommunicatorEvent | null>;
  insertPrompt(row: PromptInsert): Promise<unknown>;
  insertResearchRun(row: ResearchRunInsert): Promise<unknown>;
  updateResearchRun(orgId: string, runId: string, changes: Partial<CampaignCommunicatorResearchRun>): Promise<unknown>;
  insertSuggestions(rows: SuggestionInsert[]): Promise<unknown>;
  updateSuggestion(orgId: string, suggestionId: string, changes: Partial<CampaignCommunicatorSuggestion>): Promise<boolean>;
  supersedeAcceptedSuggestions(
    orgId: string,
    campaignId: string,
    leadId: string,
    suggestionType: string,
    exceptSuggestionId: string,
    updatedAt: Date,
  ): Promise<unknown>;
  updateLead(
    orgId: string,
    campaignId: string,
    leadId: string,
    changes: Partial<CampaignCommunicatorLead>,
    expectedUpdatedAt?: Date,
  ): Promise<boolean>;
  supersedeDrafts(orgId: string, campaignId: string, leadId: string | null, updatedAt: Date): Promise<unknown>;
  insertDraft(row: DraftInsert): Promise<unknown>;
  approveDraft(orgId: string, draftId: string, changes: Partial<CampaignCommunicatorDraft>): Promise<boolean>;
  insertEvent(row: EventInsert): Promise<unknown>;
}

export interface CampaignCommunicatorStore extends CampaignCommunicatorTransaction {
  transaction<T>(callback: (tx: CampaignCommunicatorTransaction) => Promise<T>): Promise<T>;
}

export type CampaignCommunicatorDependencies = {
  store: CampaignCommunicatorStore;
  now: () => Date;
  randomUUID: () => string;
};

export async function getCommunicatorContext(
  orgId: string,
  campaignId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const campaign = await dependencies.store.findCampaign(orgId, campaignId);
  if (!campaign) throw new NotFoundError("Campaign not found");

  const [leads, prompt, suggestions, drafts, activity] = await Promise.all([
    dependencies.store.listCampaignLeads(orgId, campaignId),
    dependencies.store.findLatestPrompt(orgId, campaignId),
    dependencies.store.listSuggestions(orgId, campaignId),
    dependencies.store.listDrafts(orgId, campaignId),
    dependencies.store.listEvents(orgId, campaignId),
  ]);
  const taskRows = await Promise.all(leads.map((lead) => dependencies.store.listLeadTasks(orgId, campaignId, lead.id)));

  return {
    prompt,
    radio_drafts: drafts.filter((draft) => draft.scope === "radio_update" && draft.lead_id === null),
    leads: Object.fromEntries(leads.map((lead, index) => {
      const leadDrafts = drafts.filter((draft) => draft.lead_id === lead.id);
      const approvedDraft = leadDrafts.find((draft) => draft.status === "approved") ?? null;
      const tasks = taskRows[index];
      return [lead.id, {
        suggestions: suggestions.filter((suggestion) => suggestion.lead_id === lead.id),
        draft_versions: leadDrafts,
        ready_blockers: getLeadReadyBlockers(readinessInput(lead, tasks, approvedDraft?.id ?? null, false)),
        activity: activity.filter((event) => event.lead_id === lead.id),
      }];
    })),
  };
}

export async function saveCommunicatorPrompt(
  orgId: string,
  campaignId: string,
  prompt: string,
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new HttpError("Communicator prompt is required");
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    if (!await tx.findCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    const latest = await tx.findLatestPrompt(orgId, campaignId);
    const row: CampaignCommunicatorPrompt = {
      id: dependencies.randomUUID(),
      org_id: orgId,
      campaign_id: campaignId,
      version: (latest?.version ?? 0) + 1,
      prompt: normalizedPrompt,
      created_by: userId,
      created_at: now,
      updated_at: now,
    };
    try {
      await tx.insertPrompt(row);
    } catch (error) {
      if (isUniqueViolation(error, "campaign_communicator_prompts_org_campaign_version_unique_idx")) {
        throw new ConflictError("Communicator prompt changed; reload and try again");
      }
      throw error;
    }
    await tx.supersedeDrafts(orgId, campaignId, null, now);
    const leads = await tx.listCampaignLeads(orgId, campaignId);
    for (const lead of leads) {
      if (!await tx.lockLead(orgId, campaignId, lead.id)) continue;
      await tx.supersedeDrafts(orgId, campaignId, lead.id, now);
      if (lead.pipeline_stage === "ready") {
        if (!await tx.updateLead(orgId, campaignId, lead.id, { pipeline_stage: "qualified", updated_at: now }, lead.updated_at ?? undefined)) {
          throw new ConflictError("Campaign lead changed while updating the communicator prompt");
        }
      }
    }
    return row;
  });
}

export async function runLeadResearch(
  orgId: string,
  leadId: string,
  userId: string,
  provider: CampaignCommunicatorProvider,
  requestedAt?: Date,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const now = requestedAt ?? dependencies.now();
  const lead = await dependencies.store.findLead(orgId, leadId);
  if (!lead) throw new NotFoundError("Campaign lead not found");
  const prompt = await dependencies.store.findLatestPrompt(orgId, lead.campaign_id);
  const run: CampaignCommunicatorResearchRun = {
    id: dependencies.randomUUID(),
    org_id: orgId,
    campaign_id: lead.campaign_id,
    lead_id: lead.id,
    prompt_id: prompt?.id ?? null,
    status: "running",
    started_at: now,
    completed_at: null,
    failure_reason: null,
    created_at: now,
    updated_at: now,
  };

  await dependencies.store.transaction(async (tx) => {
    if (await tx.findRunningResearch(orgId, leadId)) throw new ConflictError("Research is already running");
    const cooldownStart = new Date(now.getTime() - RESEARCH_COOLDOWN_MS);
    if (await tx.findRecentResearchStart(orgId, leadId, userId, cooldownStart)) {
      throw new ConflictError("Research was run too recently");
    }
    try {
      await tx.insertResearchRun(run);
    } catch (error) {
      if (isUniqueViolation(error, "campaign_enrichment_runs_org_lead_running_unique_idx")) {
        throw new ConflictError("Research is already running");
      }
      throw error;
    }
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: lead.campaign_id,
      leadId,
      draftId: null,
      eventType: "research_started",
      actorUserId: userId,
      occurredAt: now,
      details: { enrichment_run_id: run.id, provider: provider.id, model: provider.model },
    }));
  });

  if (provider.id === "disabled") {
    await finishResearchRun(dependencies, run, "refused", "Research provider unavailable", now, userId);
    throw new HttpError("Lead research is unavailable", 503);
  }

  try {
    const result = await provider.researchLead({
      campaign_name: lead.campaign_name,
      artist_name: lead.artist_name ?? lead.campaign_name,
      release_title: lead.release_title ?? lead.campaign_name,
      target_name: lead.target_name,
      target_url: lead.target_url,
    });
    const completedAt = dependencies.now();
    const rows = result.suggestions.map((item) => ({
      id: dependencies.randomUUID(),
      org_id: orgId,
      campaign_id: lead.campaign_id,
      lead_id: lead.id,
      enrichment_run_id: run.id,
      suggestion_type: item.field,
      suggested_value: { value: item.value, rationale: item.rationale },
      evidence: [...item.evidence],
      status: "pending" as const,
      resolved_by: null,
      resolved_at: null,
      created_at: completedAt,
      updated_at: completedAt,
    }));
    await dependencies.store.transaction(async (tx) => {
      if (rows.length) await tx.insertSuggestions(rows);
      await tx.updateResearchRun(orgId, run.id, {
        status: "completed",
        completed_at: completedAt,
        failure_reason: null,
        updated_at: completedAt,
      });
      await tx.insertEvent(makeEvent(dependencies, {
        orgId,
        campaignId: lead.campaign_id,
        leadId,
        draftId: null,
        eventType: "research_completed",
        actorUserId: userId,
        occurredAt: completedAt,
        details: { enrichment_run_id: run.id, suggestion_count: rows.length },
      }));
    });
    return { ...run, status: "completed" as const, completed_at: completedAt, suggestions: rows };
  } catch {
    const failedAt = dependencies.now();
    await finishResearchRun(dependencies, run, "failed", "Research provider failed", failedAt, userId);
    throw new HttpError("Lead research failed", 502);
  }
}

export async function decideSuggestion(
  orgId: string,
  suggestionId: string,
  input: { decision: "accepted" | "rejected"; expected_lead_updated_at: string },
  userId: string | null = null,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = decideSuggestionSchema.parse(input);
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    const suggestion = await tx.findSuggestion(orgId, suggestionId);
    if (!suggestion) throw new NotFoundError("Suggestion not found");
    if (suggestion.status !== "pending") throw new ConflictError("Suggestion has already been decided");
    const lead = await tx.findLead(orgId, suggestion.lead_id);
    if (!lead || lead.campaign_id !== suggestion.campaign_id) throw new NotFoundError("Campaign lead not found");

    if (payload.decision === "accepted") {
      if (!hasUsableEvidence(suggestion.evidence)) throw new ConflictError("Suggestion does not have usable citation evidence");
      const expected = new Date(payload.expected_lead_updated_at);
      if (!lead.updated_at || lead.updated_at.getTime() !== expected.getTime()) {
        throw new ConflictError("Lead changed while reviewing this suggestion");
      }
      const value = suggestionValue(suggestion);
      const previousValue = previousSuggestionValue(lead, suggestion, await tx.listSuggestions(orgId, lead.campaign_id, lead.id));
      const changes: Partial<CampaignCommunicatorLead> = { updated_at: now };
      if (isLeadSuggestionField(suggestion.suggestion_type)) changes[suggestion.suggestion_type] = value;
      if (suggestion.suggestion_type === "contact_route") changes.contact_route_verified_at = null;
      if (lead.pipeline_stage === "ready") changes.pipeline_stage = "qualified";
      if (!await tx.updateLead(orgId, lead.campaign_id, lead.id, changes, expected)) {
        throw new ConflictError("Lead changed while reviewing this suggestion");
      }
      await tx.supersedeDrafts(orgId, lead.campaign_id, lead.id, now);
      await tx.supersedeAcceptedSuggestions(
        orgId,
        lead.campaign_id,
        lead.id,
        suggestion.suggestion_type,
        suggestion.id,
        now,
      );
      if (!await tx.updateSuggestion(orgId, suggestion.id, {
        status: payload.decision,
        resolved_by: userId,
        resolved_at: now,
        updated_at: now,
      })) throw new ConflictError("Suggestion changed while reviewing it");
      await tx.insertEvent(makeEvent(dependencies, {
        orgId,
        campaignId: lead.campaign_id,
        leadId: lead.id,
        draftId: null,
        eventType: "suggestion_accepted",
        actorUserId: userId,
        occurredAt: now,
        details: {
          suggestion_id: suggestion.id,
          suggestion_type: suggestion.suggestion_type,
          previous_value: previousValue,
          accepted_value: value,
        },
      }));
      return { id: suggestion.id, status: payload.decision };
    }

    if (!await tx.updateSuggestion(orgId, suggestion.id, {
      status: payload.decision,
      resolved_by: userId,
      resolved_at: now,
      updated_at: now,
    })) throw new ConflictError("Suggestion changed while reviewing it");
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: lead.campaign_id,
      leadId: lead.id,
      draftId: null,
      eventType: "suggestion_rejected",
      actorUserId: userId,
      occurredAt: now,
      details: { suggestion_id: suggestion.id, suggestion_type: suggestion.suggestion_type },
    }));
    return { id: suggestion.id, status: payload.decision };
  });
}

export async function createGeneratedDraft(
  orgId: string,
  leadId: string,
  input: { campaign_id: string; instruction?: string | null },
  userId: string,
  provider: CampaignCommunicatorProvider,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = generateDraftSchema.parse(input);
  const lead = await dependencies.store.findLead(orgId, leadId);
  if (!lead || lead.campaign_id !== payload.campaign_id) throw new NotFoundError("Campaign lead not found");
  const [prompt, suggestions] = await Promise.all([
    dependencies.store.findLatestPrompt(orgId, lead.campaign_id),
    dependencies.store.listSuggestions(orgId, lead.campaign_id, lead.id),
  ]);
  const accepted = acceptedDraftSuggestions(suggestions);
  const generationSnapshot = {
    lead_updated_at: timestampIdentity(lead.updated_at),
    prompt: promptIdentity(prompt),
    accepted_suggestions: acceptedSuggestionIdentity(suggestions),
  };
  const instruction = [prompt?.prompt, payload.instruction].filter((value): value is string => Boolean(value?.trim())).join("\n\n") || null;
  const providerInput: GenerateDraftInput = {
    campaign_name: lead.campaign_name,
    artist_name: lead.artist_name ?? lead.campaign_name,
    release_title: lead.release_title ?? lead.campaign_name,
    recipient_name: lead.contact_name,
    target_name: lead.target_name,
    channel: inferChannel(lead.contact_route),
    instruction,
    suggestions: accepted,
  };
  const generated = await provider.generateDraft(providerInput);
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, payload.campaign_id)) throw new NotFoundError("Campaign not found");
    if (!await tx.lockLead(orgId, payload.campaign_id, leadId)) throw new NotFoundError("Campaign lead not found");
    const currentLead = await tx.findLead(orgId, leadId);
    if (!currentLead || currentLead.campaign_id !== payload.campaign_id) throw new NotFoundError("Campaign lead not found");
    const [currentPrompt, currentSuggestions] = await Promise.all([
      tx.findLatestPrompt(orgId, payload.campaign_id),
      tx.listSuggestions(orgId, payload.campaign_id, leadId),
    ]);
    const currentSnapshot = {
      lead_updated_at: timestampIdentity(currentLead.updated_at),
      prompt: promptIdentity(currentPrompt),
      accepted_suggestions: acceptedSuggestionIdentity(currentSuggestions),
    };
    if (JSON.stringify(currentSnapshot) !== JSON.stringify(generationSnapshot)) {
      throw new ConflictError("Communicator context changed; regenerate the draft");
    }
    const drafts = await tx.listDrafts(orgId, payload.campaign_id, leadId);
    const row = makeDraft(dependencies, {
      orgId,
      campaignId: payload.campaign_id,
      leadId,
      enrichmentRunId: latestRunId(suggestions),
      version: nextVersion(drafts),
      subject: generated.subject?.trim() || null,
      body: generated.body,
      contextSnapshot: { ...providerInput, prompt_id: prompt?.id ?? null, prompt_version: prompt?.version ?? null },
      now,
    });
    await tx.supersedeDrafts(orgId, payload.campaign_id, leadId, now);
    await tx.insertDraft(row);
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: payload.campaign_id,
      leadId,
      draftId: row.id,
      eventType: "draft_generated",
      actorUserId: userId,
      occurredAt: now,
      details: { provider: provider.id, model: provider.model, version: row.version },
    }));
    return row;
  });
}

export async function createRadioUpdateDraft(
  orgId: string,
  campaignId: string,
  input: { page_revision_id: string; instruction?: string | null },
  userId: string,
  provider: CampaignCommunicatorProvider,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = radioUpdateDraftSchema.parse(input);
  const campaign = await dependencies.store.findCampaign(orgId, campaignId);
  if (!campaign) throw new NotFoundError("Campaign not found");
  const [revision, prompt] = await Promise.all([
    dependencies.store.findReviewedPageRevision(orgId, campaignId, payload.page_revision_id),
    dependencies.store.findLatestPrompt(orgId, campaignId),
  ]);
  if (!revision || revision.org_id !== orgId || revision.campaign_id !== campaignId) throw new NotFoundError("Reviewed campaign page revision not found");
  if (!await dependencies.store.checkReviewedPageRevisionFresh(orgId, campaignId, payload.page_revision_id)) throw new ConflictError("Reviewed radio page revision is stale");
  const generation = radioGenerationContext(campaign, revision, prompt, payload.instruction ?? null);
  const generated = await provider.generateDraft({
    campaign_name: campaign.campaign_name,
    artist_name: campaign.artist_name ?? campaign.campaign_name,
    release_title: campaign.release_title ?? campaign.campaign_name,
    recipient_name: null,
    target_name: "Independent radio network",
    channel: "email",
    instruction: generation.providerInstruction,
    suggestions: [],
  });
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    const currentRevision = await tx.findReviewedPageRevision(orgId, campaignId, payload.page_revision_id);
    const currentPrompt = await tx.findLatestPrompt(orgId, campaignId);
    if (!currentRevision || currentRevision.org_id !== orgId || currentRevision.campaign_id !== campaignId || !await tx.checkReviewedPageRevisionFresh(orgId, campaignId, payload.page_revision_id) || !isRadioRevisionIntegrityValid(currentRevision) || !sameRadioRevision(currentRevision, generation.revisionIdentity)
      || !samePrompt(currentPrompt, generation.promptIdentity)) {
      throw new ConflictError("Radio update context changed; regenerate the draft");
    }
    const drafts = await tx.listDrafts(orgId, campaignId, null);
    const row = makeDraft(dependencies, {
      orgId,
      campaignId,
      leadId: null,
      enrichmentRunId: null,
      version: nextVersion(drafts),
      subject: generated.subject?.trim() || null,
      body: generated.body,
      scope: "radio_update",
      contextSnapshot: generation.contextSnapshot,
      now,
    });
    await tx.supersedeDrafts(orgId, campaignId, null, now);
    await tx.insertDraft(row);
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId,
      leadId: null,
      draftId: row.id,
      eventType: "radio_update_draft_generated",
      actorUserId: userId,
      occurredAt: now,
      details: { provider: provider.id, model: provider.model, version: row.version, page_revision_id: payload.page_revision_id },
    }));
    return row;
  });
}

export const nativeRadioDraftSchema = z.object({
  expected_station_revision: z.string().min(1),
  target: z.discriminatedUnion("scope", [
    z.object({ scope: z.literal("focused"), lead_id: z.string().min(1), expected_lead_revision: z.string().min(1) }).strict(),
    z.object({ scope: z.literal("radio_update"), page_revision_id: z.string().min(1), expected_page_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  ]),
  source: z.object({ id: z.string().min(1), revision: z.string().min(1), content_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  subject: z.string().trim().max(500).nullable(), body: z.string().trim().min(1).max(10_000).optional(),
  body_document: z.unknown().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.body !== undefined) === (value.body_document !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Provide either plain text or a rich document", path: ["body"] });
  }
  if (value.body_document !== undefined) {
    try { deriveCampaignDocument(value.body_document, 10_000); }
    catch { ctx.addIssue({ code: "custom", message: "Invalid campaign document", path: ["body_document"] }); }
  }
});

export function nativeRadioDraftContentHash(draft: { subject: string | null; body: string; body_document: unknown }) {
  return createHash("sha256").update(JSON.stringify([draft.subject, draft.body, draft.body_document])).digest("hex");
}

export async function createNativeRadioDraft(orgId: string, campaignId: string, stationLinkId: string, actor: string, raw: unknown) {
  const input = nativeRadioDraftSchema.parse(raw);
  return db.transaction(async executor => {
    const [member] = await executor.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, actor))).for("share");
    if (!member) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    if (!["owner", "operator"].includes(member.role)) throw new HttpError("Insufficient permissions", 403);
    const tx = makeDrizzleTransaction(executor);
    if (!await tx.lockCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    const [parent] = await executor.select({ status: campaigns.status }).from(campaigns)
      .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)));
    if (parent.status === "archived") throw new ConflictError("Archived campaign is read-only");
    const [station] = await executor.select({ station_id: campaign_stations.station_id, revision: sql<string>`${campaign_stations.updated_at}::text` })
      .from(campaign_stations).where(and(eq(campaign_stations.org_id, orgId), eq(campaign_stations.campaign_id, campaignId), eq(campaign_stations.id, stationLinkId))).for("no key update");
    if (!station?.station_id) throw new NotFoundError("Campaign station not found");
    if (station.revision !== input.expected_station_revision) throw new ConflictError("Station preparation changed. Refresh before saving.");
    const target = input.target;
    const leadId = target.scope === "focused" ? target.lead_id : null;
    let context: Record<string, unknown>;
    if (target.scope === "focused") {
      const [lead] = await executor.select({ revision: sql<string>`${campaign_leads.updated_at}::text` }).from(campaign_leads)
        .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.station_id, station.station_id), eq(campaign_leads.id, target.lead_id))).for("no key update");
      if (!lead) throw new NotFoundError("Campaign station lead not found");
      if (lead.revision !== target.expected_lead_revision) throw new ConflictError("Recipient changed. Refresh before saving.");
      const recipient = await tx.findLead(orgId, target.lead_id);
      if (!recipient) throw new NotFoundError("Campaign lead not found");
      context = { scope: "focused", campaign_id: campaignId, lead_id: target.lead_id, lead_revision: lead.revision,
        target_name: recipient.target_name, recipient_name: recipient.contact_name, channel: inferChannel(recipient.contact_route) };
    } else {
      const campaign = await tx.findCampaign(orgId, campaignId);
      const revision = await tx.findReviewedPageRevision(orgId, campaignId, target.page_revision_id);
      if (!campaign || !revision) throw new NotFoundError("Reviewed campaign page revision not found");
      if (revision.content_hash !== target.expected_page_hash || !isRadioRevisionIntegrityValid(revision)
        || !await tx.checkReviewedPageRevisionFresh(orgId, campaignId, target.page_revision_id)) throw new ConflictError("Reviewed radio page revision changed. Refresh before saving.");
      context = radioGenerationContext(campaign, revision, await tx.findLatestPrompt(orgId, campaignId), null).contextSnapshot;
    }
    const drafts = await tx.listDrafts(orgId, campaignId, leadId);
    let source: CampaignCommunicatorDraft | undefined;
    if (input.source) {
      source = drafts.find(row => row.id === input.source!.id);
      if (!source || source.scope !== target.scope) throw new NotFoundError("Draft not found");
      const [identity] = await executor.select({ revision: sql<string>`${campaign_outreach_drafts.updated_at}::text`, subject: campaign_outreach_drafts.subject, body: campaign_outreach_drafts.body, body_document: campaign_outreach_drafts.body_document }).from(campaign_outreach_drafts)
        .where(and(eq(campaign_outreach_drafts.org_id, orgId), eq(campaign_outreach_drafts.id, source.id))).for("no key update");
      if (source.status !== "draft" || (identity.body_document && input.body_document === undefined) || source.version !== nextVersion(drafts) - 1
        || identity.revision !== input.source.revision || nativeRadioDraftContentHash(identity) !== input.source.content_sha256) {
        throw new ConflictError("Draft changed or requires the full editor. Refresh before saving.");
      }
      if (target.scope === "radio_update") {
        const priorRevision = radioRevisionIdentity(source.context_snapshot);
        const priorPrompt = radioPromptIdentity(source.context_snapshot);
        if (!priorRevision || priorRevision.id !== target.page_revision_id || priorRevision.content_hash !== target.expected_page_hash
          || priorPrompt === undefined || !samePrompt(await tx.findLatestPrompt(orgId, campaignId), priorPrompt)) {
          throw new ConflictError("Radio update context changed. Refresh before saving.");
        }
      }
    } else if (drafts.length) throw new ConflictError("A draft already exists. Refresh before saving.");
    const now = new Date();
    const row = makeDraft(defaultDependencies, { orgId, campaignId, leadId, enrichmentRunId: source?.enrichment_run_id ?? null,
      version: nextVersion(drafts), subject: input.subject || null, body: input.body, body_document: input.body_document, plainBody: input.body_document === undefined,
      scope: target.scope, contextSnapshot: context, now });
    await tx.supersedeDrafts(orgId, campaignId, leadId, now);
    await tx.insertDraft(row);
    await tx.insertEvent(makeEvent(defaultDependencies, { orgId, campaignId, leadId, draftId: row.id,
      eventType: source ? "draft_version_created" : target.scope === "radio_update" ? "radio_update_draft_manual" : "draft_manual",
      actorUserId: actor, occurredAt: now, details: { source_draft_id: source?.id ?? null, version: row.version, station_link_id: stationLinkId } }));
    return row;
  });
}

export async function createManualRadioUpdateDraft(
  orgId: string,
  campaignId: string,
  input: { page_revision_id: string; subject: string | null; body?: string; body_document?: unknown },
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = manualRadioUpdateDraftSchema.parse(input);
  const campaign = await dependencies.store.findCampaign(orgId, campaignId);
  if (!campaign) throw new NotFoundError("Campaign not found");
  const [revision, prompt] = await Promise.all([
    dependencies.store.findReviewedPageRevision(orgId, campaignId, payload.page_revision_id),
    dependencies.store.findLatestPrompt(orgId, campaignId),
  ]);
  if (!revision || revision.org_id !== orgId || revision.campaign_id !== campaignId) throw new NotFoundError("Reviewed campaign page revision not found");
  if (!await dependencies.store.checkReviewedPageRevisionFresh(orgId, campaignId, payload.page_revision_id)) throw new ConflictError("Reviewed radio page revision is stale");
  const generation = radioGenerationContext(campaign, revision, prompt, null);
  const now = dependencies.now();
  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    const currentRevision = await tx.findReviewedPageRevision(orgId, campaignId, payload.page_revision_id);
    const currentPrompt = await tx.findLatestPrompt(orgId, campaignId);
    if (!currentRevision || currentRevision.org_id !== orgId || currentRevision.campaign_id !== campaignId || !await tx.checkReviewedPageRevisionFresh(orgId, campaignId, payload.page_revision_id) || !isRadioRevisionIntegrityValid(currentRevision) || !sameRadioRevision(currentRevision, generation.revisionIdentity)
      || !samePrompt(currentPrompt, generation.promptIdentity)) throw new ConflictError("Radio update context changed; reload the reviewed page");
    const drafts = await tx.listDrafts(orgId, campaignId, null);
    const row = makeDraft(dependencies, {
      orgId, campaignId, leadId: null, enrichmentRunId: null, version: nextVersion(drafts),
      subject: payload.subject?.trim() || null, body: payload.body, body_document: payload.body_document, scope: "radio_update",
      contextSnapshot: generation.contextSnapshot, now,
    });
    await tx.supersedeDrafts(orgId, campaignId, null, now);
    await tx.insertDraft(row);
    await tx.insertEvent(makeEvent(dependencies, {
      orgId, campaignId, leadId: null, draftId: row.id, eventType: "radio_update_draft_manual",
      actorUserId: userId, occurredAt: now, details: { version: row.version, page_revision_id: payload.page_revision_id },
    }));
    return row;
  });
}

export async function updateLeadPreparation(
  orgId: string,
  leadId: string,
  input: z.input<typeof updateLeadPreparationSchema>,
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = updateLeadPreparationSchema.parse(input);
  if (payload.exact_edit_track_id && dependencies === defaultDependencies) {
    const track = await db.select({ id: tracks.id }).from(tracks).where(and(
      eq(tracks.id, payload.exact_edit_track_id),
      eq(tracks.org_id, orgId),
    )).limit(1);
    if (!track.length) throw new ConflictError("Exact edit is unavailable in this workspace");
  }
  const now = dependencies.now();
  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, payload.campaign_id)) throw new NotFoundError("Campaign not found");
    if (!await tx.lockLead(orgId, payload.campaign_id, leadId)) throw new NotFoundError("Campaign lead not found");
    const lead = await tx.findLead(orgId, leadId);
    if (!lead || lead.campaign_id !== payload.campaign_id) throw new NotFoundError("Campaign lead not found");
    const changes: Partial<CampaignCommunicatorLead> = { updated_at: now };
    const contactRouteProvided = Object.prototype.hasOwnProperty.call(payload, "contact_route");
    const nextContactRoute = contactRouteProvided ? payload.contact_route ?? null : lead.contact_route;
    const routeChanged = contactRouteProvided && nextContactRoute !== lead.contact_route;

    if (contactRouteProvided) changes.contact_route = nextContactRoute;
    if (routeChanged) changes.contact_route_verified_at = null;
    if (payload.contact_route_verified !== undefined) {
      if (payload.contact_route_verified && routeChanged) {
        throw new ConflictError("Save the changed contact route before verifying it");
      }
      if (payload.contact_route_verified && !nextContactRoute) {
        throw new ConflictError("A contact route is required before verification");
      }
      changes.contact_route_verified_at = payload.contact_route_verified ? now : null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "exact_edit_track_id")) changes.exact_edit_track_id = payload.exact_edit_track_id ?? null;
    if (Object.prototype.hasOwnProperty.call(payload, "recommending_person")) changes.recommending_person = payload.recommending_person ?? null;
    if (Object.prototype.hasOwnProperty.call(payload, "introduction_available")) changes.introduction_available = payload.introduction_available ?? null;
    if (Object.prototype.hasOwnProperty.call(payload, "musical_fit")) changes.musical_fit = payload.musical_fit ?? null;
    if (Object.prototype.hasOwnProperty.call(payload, "pitch_angle")) changes.pitch_angle = payload.pitch_angle ?? null;
    if (Object.prototype.hasOwnProperty.call(payload, "readiness_task_waiver_reason")) {
      changes.readiness_task_waiver_reason = payload.readiness_task_waiver_reason ?? null;
    }

    const drafts = await tx.listDrafts(orgId, lead.campaign_id, lead.id);
    const approvedDraft = drafts.find((candidate) => candidate.status === "approved") ?? null;
    const tasks = await tx.listLeadTasks(orgId, lead.campaign_id, lead.id);
    const nextLead = { ...lead, ...changes };
    const readyBlockers = getLeadReadyBlockers(readinessInput(nextLead, tasks, approvedDraft?.id ?? null, false));
    if (routeChanged) {
      await tx.supersedeDrafts(orgId, lead.campaign_id, lead.id, now);
      changes.pipeline_stage = lead.pipeline_stage === "ready" ? "qualified" : lead.pipeline_stage;
    } else if (readyBlockers.length > 0 && lead.pipeline_stage === "ready") {
      changes.pipeline_stage = "qualified";
    } else if (readyBlockers.length === 0 && approvedDraft && lead.pipeline_stage === "qualified") {
      changes.pipeline_stage = "ready";
    }

    const expectedUpdatedAt = payload.expected_updated_at ? new Date(payload.expected_updated_at) : lead.updated_at ?? undefined;
    if (!await tx.updateLead(orgId, lead.campaign_id, lead.id, changes, expectedUpdatedAt)) {
      throw new ConflictError("Campaign lead changed while updating preparation");
    }
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: lead.campaign_id,
      leadId: lead.id,
      draftId: null,
      eventType: "lead_preparation_updated",
      actorUserId: userId,
      occurredAt: now,
      details: {
        contact_route_changed: routeChanged,
        contact_route_verified: Object.prototype.hasOwnProperty.call(changes, "contact_route_verified_at")
          ? Boolean(changes.contact_route_verified_at)
          : null,
        readiness_task_waiver_reason: Object.prototype.hasOwnProperty.call(payload, "readiness_task_waiver_reason")
          ? payload.readiness_task_waiver_reason ?? null
          : null,
      },
    }));
    return {
      id: lead.id,
      contact_route: nextContactRoute,
      contact_route_verified_at: Object.prototype.hasOwnProperty.call(changes, "contact_route_verified_at")
        ? changes.contact_route_verified_at ?? null
        : lead.contact_route_verified_at,
      readiness_task_waiver_reason: Object.prototype.hasOwnProperty.call(changes, "readiness_task_waiver_reason")
        ? changes.readiness_task_waiver_reason ?? null
        : lead.readiness_task_waiver_reason,
      exact_edit_track_id: Object.prototype.hasOwnProperty.call(changes, "exact_edit_track_id") ? changes.exact_edit_track_id ?? null : lead.exact_edit_track_id,
      recommending_person: Object.prototype.hasOwnProperty.call(changes, "recommending_person") ? changes.recommending_person ?? null : lead.recommending_person,
      introduction_available: Object.prototype.hasOwnProperty.call(changes, "introduction_available") ? changes.introduction_available ?? null : lead.introduction_available,
      musical_fit: Object.prototype.hasOwnProperty.call(changes, "musical_fit") ? changes.musical_fit ?? null : lead.musical_fit,
      pitch_angle: Object.prototype.hasOwnProperty.call(changes, "pitch_angle") ? changes.pitch_angle ?? null : lead.pitch_angle,
      ready_blockers: readyBlockers,
      updated_at: now,
    };
  });
}

export async function createManualDraftVersion(
  orgId: string,
  sourceDraftId: string,
  content: { subject: string | null; body?: string; body_document?: unknown },
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
  options: { expectedUpdatedAt?: string; expectedLeadId?: string; plainOnly?: boolean } = {},
) {
  const subject = content.subject?.trim() || null;
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    const initialSource = await tx.findDraft(orgId, sourceDraftId);
    if (!initialSource) throw new NotFoundError("Draft not found");
    if (initialSource.lead_id) {
      const initialLead = await tx.findLead(orgId, initialSource.lead_id);
      if (!initialLead || initialLead.campaign_id !== initialSource.campaign_id) throw new NotFoundError("Campaign lead not found");
    }
    if (!await tx.lockCampaign(orgId, initialSource.campaign_id)) throw new NotFoundError("Campaign not found");
    const source = await tx.findDraft(orgId, sourceDraftId);
    if (!source) throw new NotFoundError("Draft not found");
    if (options.expectedLeadId && source.lead_id !== options.expectedLeadId) throw new NotFoundError("Draft not found");
    if (options.expectedUpdatedAt && source.updated_at?.getTime() !== new Date(options.expectedUpdatedAt).getTime()) {
      throw new ConflictError("Draft changed while editing; reload the draft");
    }
    if (options.plainOnly && source.body_document) throw new ConflictError("Rich drafts are read-only in native editing");
    if (options.plainOnly && source.status !== "draft") throw new ConflictError("Only an unapproved draft can be edited in native");
    if (!source.lead_id && source.scope === "focused") throw new ConflictError("Focused draft is not linked to a lead");
    if (source.lead_id) {
      const lead = await tx.findLead(orgId, source.lead_id);
      if (!lead || lead.campaign_id !== source.campaign_id) throw new NotFoundError("Campaign lead not found");
    }
    if (!source.lead_id && source.scope === "radio_update") {
      const revisionIdentity = radioRevisionIdentity(source.context_snapshot);
      const promptIdentity = radioPromptIdentity(source.context_snapshot);
      const currentRevision = revisionIdentity ? await tx.findReviewedPageRevision(orgId, source.campaign_id, revisionIdentity.id) : null;
      const currentPrompt = await tx.findLatestPrompt(orgId, source.campaign_id);
      if (!revisionIdentity || promptIdentity === undefined || !samePrompt(currentPrompt, promptIdentity)
        || !currentRevision || currentRevision.org_id !== orgId || currentRevision.campaign_id !== source.campaign_id
        || !await tx.checkReviewedPageRevisionFresh(orgId, source.campaign_id, revisionIdentity.id)
        || !isRadioRevisionIntegrityValid(currentRevision) || !sameRadioRevision(currentRevision, revisionIdentity)) {
        throw new ConflictError("Radio update context changed; reload the reviewed page");
      }
    }
    const drafts = await tx.listDrafts(orgId, source.campaign_id, source.lead_id);
    const row = makeDraft(dependencies, {
      orgId,
      campaignId: source.campaign_id,
      leadId: source.lead_id,
      enrichmentRunId: source.enrichment_run_id,
      version: nextVersion(drafts),
      subject,
      body: content.body,
      body_document: content.body_document,
      contextSnapshot: source.context_snapshot,
      scope: source.scope,
      plainBody: options.plainOnly,
      now,
    });
    await tx.supersedeDrafts(orgId, source.campaign_id, source.lead_id, now);
    await tx.insertDraft(row);
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: source.campaign_id,
      leadId: source.lead_id,
      draftId: row.id,
      eventType: "draft_version_created",
      actorUserId: userId,
      occurredAt: now,
      details: { source_draft_id: source.id, version: row.version },
    }));
    return row;
  });
}

export async function approveDraft(
  orgId: string,
  draftId: string,
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
  options: { expectedDraftUpdatedAt?: string; expectedLeadUpdatedAt?: string; expectedLeadId?: string } = {},
) {
  const now = dependencies.now();
  return dependencies.store.transaction(async (tx) => {
    const draft = await tx.findDraft(orgId, draftId);
    if (!draft) throw new NotFoundError("Draft not found");
    if (options.expectedLeadId && draft.lead_id !== options.expectedLeadId) throw new NotFoundError("Draft not found");
    if (options.expectedDraftUpdatedAt && draft.updated_at?.getTime() !== new Date(options.expectedDraftUpdatedAt).getTime()) {
      throw new ConflictError("Draft changed while approving it");
    }
    if (draft.status !== "draft") throw new ConflictError("Draft is not awaiting approval");
    assertDraftBodyReadyForApproval(draft);
    if (!await tx.lockCampaign(orgId, draft.campaign_id)) throw new NotFoundError("Campaign not found");
    if (!draft.lead_id && draft.scope === "radio_update") {
      const radioRevision = radioRevisionIdentity(draft.context_snapshot);
      if (!radioRevision) throw new ConflictError("Radio draft is missing its reviewed page revision");
      const currentRevision = radioRevision
        ? await tx.findReviewedPageRevision(orgId, draft.campaign_id, radioRevision.id)
        : null;
      if (!currentRevision || currentRevision.org_id !== orgId || currentRevision.campaign_id !== draft.campaign_id || !await tx.checkReviewedPageRevisionFresh(orgId, draft.campaign_id, radioRevision.id) || !isRadioRevisionIntegrityValid(currentRevision) || !sameRadioRevision(currentRevision, radioRevision)) {
        throw new ConflictError("Reviewed radio page revision changed; regenerate the draft");
      }
      const promptIdentity = radioPromptIdentity(draft.context_snapshot);
      const currentPrompt = await tx.findLatestPrompt(orgId, draft.campaign_id);
      if (promptIdentity === undefined || !samePrompt(currentPrompt, promptIdentity)) {
        throw new ConflictError("Communicator prompt changed; regenerate the draft");
      }
      const approvalHash = hashDraftContent(draft.subject, draft.body_document ?? draft.body);
      if (!await tx.approveDraft(orgId, draft.id, {
        status: "approved",
        approval_hash: approvalHash,
        approved_by: userId,
        approved_at: now,
        updated_at: now,
      })) throw new ConflictError("Draft changed while approving it");
      await tx.insertEvent(makeEvent(dependencies, {
        orgId,
        campaignId: draft.campaign_id,
        leadId: null,
        draftId: draft.id,
        eventType: "radio_update_draft_approved",
        actorUserId: userId,
        occurredAt: now,
        details: { approval_hash: approvalHash, version: draft.version, page_revision_id: radioRevision.id },
      }));
      return { id: draft.id, approval_hash: approvalHash, scope: "radio_update" as const };
    }
    if (!draft.lead_id) throw new ConflictError("Draft is not linked to a lead");
    if (!await tx.lockLead(orgId, draft.campaign_id, draft.lead_id)) throw new NotFoundError("Campaign lead not found");
    const currentDraft = await tx.findDraft(orgId, draftId);
    if (!currentDraft || currentDraft.status !== "draft") throw new ConflictError("Draft changed while approving it");
    if (options.expectedDraftUpdatedAt && currentDraft.updated_at?.getTime() !== new Date(options.expectedDraftUpdatedAt).getTime()) {
      throw new ConflictError("Draft changed while approving it");
    }
    const lead = await tx.findLead(orgId, draft.lead_id);
    if (!lead || lead.campaign_id !== draft.campaign_id) throw new NotFoundError("Campaign lead not found");
    if (options.expectedLeadUpdatedAt && lead.updated_at?.getTime() !== new Date(options.expectedLeadUpdatedAt).getTime()) {
      throw new ConflictError("Campaign lead changed while approving the draft");
    }
    const tasks = await tx.listLeadTasks(orgId, draft.campaign_id, lead.id);
    const blockers = getDraftApprovalBlockers(readinessInput(lead, tasks, null, draft.scope === "radio_update"));
    if (blockers.length) throw new ConflictError("Lead preparation is incomplete");

    const approvalHash = hashDraftContent(draft.subject, draft.body_document ?? draft.body);
    if (!await tx.approveDraft(orgId, draft.id, {
      status: "approved",
      approval_hash: approvalHash,
      approved_by: userId,
      approved_at: now,
      updated_at: now,
    })) throw new ConflictError("Draft changed while approving it");
    if (!await tx.updateLead(orgId, draft.campaign_id, lead.id, { pipeline_stage: "ready", updated_at: now }, lead.updated_at ?? undefined)) {
      throw new ConflictError("Campaign lead changed while approving the draft");
    }
    await tx.insertEvent(makeEvent(dependencies, {
      orgId,
      campaignId: draft.campaign_id,
      leadId: lead.id,
      draftId: draft.id,
      eventType: "draft_approved",
      actorUserId: userId,
      occurredAt: now,
      details: { approval_hash: approvalHash, version: draft.version },
    }));
    return { id: draft.id, approval_hash: approvalHash, pipeline_stage: "ready" as const };
  });
}

export async function overrideLeadStage(
  orgId: string,
  leadId: string,
  campaignId: string,
  pipelineStage: CampaignPipelineStage,
  reason: string,
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const stage = campaignPipelineStageSchema.parse(pipelineStage);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10) throw new HttpError("Stage override reason must be at least 10 characters");
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    const initialLead = await tx.findLead(orgId, leadId);
    if (!initialLead || initialLead.campaign_id !== campaignId) throw new NotFoundError("Campaign lead not found");
    if (!await tx.lockCampaign(orgId, campaignId)) throw new NotFoundError("Campaign not found");
    if (!await tx.lockLead(orgId, campaignId, leadId)) throw new NotFoundError("Campaign lead not found");
    const lead = await tx.findLead(orgId, leadId);
    if (!lead || lead.campaign_id !== campaignId) throw new NotFoundError("Campaign lead not found");
    const previousStage = lead.pipeline_stage;
    if (!await tx.updateLead(orgId, lead.campaign_id, lead.id, { pipeline_stage: stage, updated_at: now })) {
      throw new ConflictError("Campaign lead changed while overriding its stage");
    }
    const event = makeEvent(dependencies, {
      orgId,
      campaignId: lead.campaign_id,
      leadId: lead.id,
      draftId: null,
      eventType: "stage_overridden",
      actorUserId: userId,
      occurredAt: now,
      details: { from_stage: previousStage, to_stage: stage, reason: normalizedReason },
    });
    await tx.insertEvent(event);
    return { event_type: event.event_type, pipeline_stage: stage };
  });
}

export async function recordExternalSend(
  orgId: string,
  leadId: string,
  input: {
    campaign_id: string;
    approved_draft_id: string;
    channel: "email" | "instagram_dm" | "soundcloud_message" | "other";
    sent_at: string;
    destination?: string | null;
    follow_up_at?: string | null;
  },
  userId: string,
  dependencies: CampaignCommunicatorDependencies = defaultDependencies,
) {
  const payload = recordSentSchema.parse(input);
  const sentAt = new Date(payload.sent_at);
  const followUpAt = payload.follow_up_at === undefined
    ? calculateSuggestedFollowUp(sentAt)
    : payload.follow_up_at === null ? null : new Date(payload.follow_up_at);
  const now = dependencies.now();

  return dependencies.store.transaction(async (tx) => {
    if (!await tx.lockCampaign(orgId, payload.campaign_id)) throw new NotFoundError("Campaign not found");
    if (!await tx.lockLead(orgId, payload.campaign_id, leadId)) throw new NotFoundError("Campaign lead not found");
    const lead = await tx.findLead(orgId, leadId);
    if (!lead || lead.campaign_id !== payload.campaign_id) throw new NotFoundError("Campaign lead not found");
    const draft = await tx.findDraft(orgId, payload.approved_draft_id);
    if (!draft || draft.campaign_id !== payload.campaign_id || draft.lead_id !== lead.id || draft.status !== "approved" || !draft.approval_hash) {
      throw new ConflictError("Approved draft not found for this lead");
    }
    const tasks = await tx.listLeadTasks(orgId, lead.campaign_id, lead.id);
    const blockers = getLeadReadyBlockers(readinessInput(lead, tasks, draft.id, draft.scope === "radio_update"));
    if (lead.pipeline_stage !== "ready" || blockers.length) {
      throw new ConflictError("Lead is no longer ready to record a send");
    }
    const event = makeEvent(dependencies, {
      orgId,
      campaignId: lead.campaign_id,
      leadId: lead.id,
      draftId: draft.id,
      eventType: "external_send_recorded",
      actorUserId: userId,
      occurredAt: sentAt,
      details: { channel: payload.channel, destination: payload.destination ?? null },
    });
    await tx.insertEvent(event);
    if (!await tx.updateLead(orgId, lead.campaign_id, lead.id, {
      pipeline_stage: "sent",
      last_contacted_at: sentAt,
      follow_up_at: followUpAt,
      updated_at: now,
    })) throw new ConflictError("Campaign lead changed while recording the send");
    return { event_type: event.event_type, pipeline_stage: "sent" as const, last_contacted_at: sentAt, follow_up_at: followUpAt };
  });
}

export function hashDraftContent(subject: string | null, body: unknown) {
  const normalized = normalizeCampaignDraftBody({
    body_document: typeof body === "string" ? undefined : body,
    body: typeof body === "string" ? body : undefined,
  }, 20_000);
  return createHash("sha256").update(JSON.stringify({
    subject: normalizeDraftContent(subject ?? ""),
    body_document: normalized.document,
  })).digest("hex");
}

function radioGenerationContext(
  campaign: CampaignCommunicatorCampaign,
  revision: CampaignRadioPageRevision,
  prompt: CampaignCommunicatorPrompt | null,
  instruction: string | null,
) {
  const content = revision.content;
  const parsedContent = campaignPublicPageContentSchema.safeParse(content);
  if (!parsedContent.success || !isCampaignPublicPageContentHashValid(content, revision.content_hash)) {
    throw new ConflictError("Reviewed radio page content is invalid or stale");
  }
  const source = revision.source_snapshot;
  const sourceRelease = asRecord(source.release);
  const sourceArtwork = asRecord(source.artwork);
  const releaseFacts = {
    release_date: sourceRelease.releaseDate ?? sourceRelease.release_date ?? null,
    catalog_number: sourceRelease.catalogNumber ?? sourceRelease.catalog_number ?? null,
    tracks: sanitizeRadioTracks(sourceRelease.tracks),
  };
  const editorial = {
    label_line: parsedContent.data.label_line,
    title: parsedContent.data.title,
    release_note: parsedContent.data.release_note,
    listen_url: parsedContent.data.listen_url,
    download_url: parsedContent.data.download_url ?? null,
    metadata_url: parsedContent.data.metadata_url ?? null,
    contact_name: parsedContent.data.contact_name,
    contact_email: parsedContent.data.contact_email,
    network_statement: "Shared with our independent radio network.",
    artwork_url: typeof sourceArtwork.fileLink === "string" ? sourceArtwork.fileLink : null,
  };
  const context = {
    page_revision: { version: revision.version, content_hash: revision.content_hash },
    editorial,
    release_facts: releaseFacts,
    campaign_voice_prompt: prompt?.prompt ?? null,
    operator_instruction: instruction?.trim() || null,
  };
  return {
    revisionIdentity: { id: revision.id, version: revision.version, content_hash: revision.content_hash },
    promptIdentity: promptIdentity(prompt),
    contextSnapshot: {
      scope: "radio_update",
      page_revision_id: revision.id,
      page_revision_version: revision.version,
      page_content_hash: revision.content_hash,
      prompt_id: prompt?.id ?? null,
      prompt_version: prompt?.version ?? null,
      campaign_voice_prompt: prompt?.prompt ?? null,
      campaign_id: campaign.id,
      editorial,
      release_facts: releaseFacts,
      network_statement: "Shared with our independent radio network.",
      operator_instruction: instruction?.trim() || null,
    },
    providerInstruction: `Draft a concise, factual email for an independent radio network from this reviewed public-page context. Do not personalize to a person or station, invent citations, browse, use tools, or send anything. Preserve exact links and the network statement.\n\n${JSON.stringify(context)}`,
  };
}

function radioRevisionIdentity(value: Record<string, unknown>) {
  const id = typeof value.page_revision_id === "string" ? value.page_revision_id : null;
  const version = typeof value.page_revision_version === "number" ? value.page_revision_version : null;
  const contentHash = typeof value.page_content_hash === "string" ? value.page_content_hash : null;
  return id && version !== null ? { id, version, content_hash: contentHash } : null;
}

function sameRadioRevision(value: CampaignRadioPageRevision, identity: { id: string; version: number; content_hash: string | null }) {
  return value.id === identity.id
    && value.review_status === "reviewed"
    && value.version === identity.version
    && value.content_hash === identity.content_hash;
}

function isRadioRevisionIntegrityValid(value: CampaignRadioPageRevision) {
  const parsed = campaignPublicPageContentSchema.safeParse(value.content);
  return value.review_status === "reviewed"
    && Boolean(value.content_hash)
    && parsed.success
    && isCampaignPublicPageContentHashValid(value.content, value.content_hash);
}

function samePrompt(value: CampaignCommunicatorPrompt | null, identity: { id: string; version: number } | null) {
  return value === null && identity === null ? true : value?.id === identity?.id && value?.version === identity?.version;
}

/** null means no prompt was captured; undefined means a malformed mixed identity. */
function radioPromptIdentity(value: Record<string, unknown>): { id: string; version: number } | null | undefined {
  const id = value.prompt_id;
  const version = value.prompt_version;
  if (id == null && version == null) return null;
  if (typeof id === "string" && id && typeof version === "number" && Number.isInteger(version) && version > 0) return { id, version };
  return undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function sanitizeRadioTracks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((track) => {
    if (!track || typeof track !== "object") return [];
    const item = track as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : null;
    if (!title) return [];
    const duration = typeof item.duration === "number" || item.duration === null ? item.duration : null;
    const credits = Array.isArray(item.credits)
      ? item.credits.flatMap((credit) => {
        if (!credit || typeof credit !== "object") return [];
        const value = credit as Record<string, unknown>;
        return typeof value.name === "string" && typeof value.role === "string" ? [{ name: value.name, role: value.role }] : [];
      })
      : [];
    return [{ title, duration, credits }];
  });
}

async function finishResearchRun(
  dependencies: CampaignCommunicatorDependencies,
  run: CampaignCommunicatorResearchRun,
  status: "failed" | "refused",
  failureReason: string,
  completedAt: Date,
  userId: string,
) {
  await dependencies.store.transaction(async (tx) => {
    await tx.updateResearchRun(run.org_id, run.id, {
      status,
      completed_at: completedAt,
      failure_reason: failureReason,
      updated_at: completedAt,
    });
    await tx.insertEvent(makeEvent(dependencies, {
      orgId: run.org_id,
      campaignId: run.campaign_id,
      leadId: run.lead_id,
      draftId: null,
      eventType: status === "failed" ? "research_failed" : "research_refused",
      actorUserId: userId,
      occurredAt: completedAt,
      details: { enrichment_run_id: run.id, reason: failureReason },
    }));
  });
}

function readinessInput(
  lead: CampaignCommunicatorLead,
  tasks: CampaignCommunicatorTask[],
  approvedDraftId: string | null,
  campaignWideUpdate: boolean,
) {
  return {
    contact_route: lead.contact_route,
    contact_route_verified_at: lead.contact_route_verified_at,
    exact_edit_track_id: lead.exact_edit_track_id,
    campaign_wide_update: campaignWideUpdate,
    musical_fit: lead.musical_fit,
    pitch_angle: lead.pitch_angle,
    batch_update_assigned: campaignWideUpdate,
    recommending_person: lead.recommending_person,
    introduction_available: lead.introduction_available,
    approved_draft_id: approvedDraftId,
    tasks,
    readiness_task_waiver_reason: lead.readiness_task_waiver_reason,
  };
}

function acceptedDraftSuggestions(suggestions: CampaignCommunicatorSuggestion[]): AcceptedDraftSuggestion[] {
  const accepted = currentAcceptedSuggestions(suggestions);
  return accepted.flatMap((suggestion) => {
    const value = suggestion.suggested_value.value;
    const rationale = suggestion.suggested_value.rationale;
    if (!isResearchSuggestionField(suggestion.suggestion_type) || typeof value !== "string" || typeof rationale !== "string" || !hasUsableEvidence(suggestion.evidence)) return [];
    return [{
      field: suggestion.suggestion_type,
      value,
      rationale,
      status: "accepted" as const,
      evidence: suggestion.evidence as [CitationEvidence, ...CitationEvidence[]],
    }];
  });
}

function makeDraft(
  dependencies: CampaignCommunicatorDependencies,
  input: {
    orgId: string;
    campaignId: string;
    leadId: string | null;
    enrichmentRunId: string | null;
    version: number;
    subject: string | null;
    body?: string;
    body_document?: unknown;
    plainBody?: boolean;
    contextSnapshot: Record<string, unknown>;
    scope?: "focused" | "radio_update";
    now: Date;
  },
): CampaignCommunicatorDraft {
  const normalized = input.plainBody
    ? (() => {
      const body = normalizeDraftContent(input.body ?? "");
      if (!body || body.length > 10_000) throw new HttpError("Draft body is required");
      return { body, document: null, html: null };
    })()
    : normalizeCampaignDraftBody(input);
  return {
    id: dependencies.randomUUID(),
    org_id: input.orgId,
    campaign_id: input.campaignId,
    lead_id: input.leadId,
    enrichment_run_id: input.enrichmentRunId,
    scope: input.scope ?? "focused",
    version: input.version,
    status: "draft",
    subject: input.subject,
    body: normalized.body,
    body_document: normalized.document,
    body_html: normalized.html,
    context_snapshot: structuredClone(input.contextSnapshot),
    approval_hash: null,
    approved_by: null,
    approved_at: null,
    created_at: input.now,
    updated_at: input.now,
  };
}

function makeEvent(
  dependencies: CampaignCommunicatorDependencies,
  input: {
    orgId: string;
    campaignId: string;
    leadId: string | null;
    draftId: string | null;
    eventType: string;
    actorUserId: string | null;
    occurredAt: Date;
    details: Record<string, unknown>;
  },
): CampaignCommunicatorEvent {
  return {
    id: dependencies.randomUUID(),
    org_id: input.orgId,
    campaign_id: input.campaignId,
    lead_id: input.leadId,
    draft_id: input.draftId,
    event_type: input.eventType,
    actor_user_id: input.actorUserId,
    occurred_at: input.occurredAt,
    details: structuredClone(input.details),
    created_at: input.occurredAt,
    updated_at: input.occurredAt,
  };
}

function suggestionValue(suggestion: CampaignCommunicatorSuggestion) {
  const value = suggestion.suggested_value.value;
  if (typeof value !== "string" || !value.trim()) throw new ConflictError("Suggestion value is invalid");
  return value.trim();
}

function normalizeDraftContent(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function normalizeCampaignDraftBody(
  input: { body_document?: unknown; body?: string },
  characterLimit: CampaignCharacterLimit = 10_000,
) {
  if (input.body_document === undefined && typeof input.body !== "string") {
    throw new HttpError("Draft body is required");
  }
  let derived;
  try {
    derived = deriveCampaignDocument(
      input.body_document ?? legacyTextToCampaignDocument(input.body ?? ""),
      characterLimit,
    );
  } catch {
    throw new HttpError("Draft body document is invalid", 400);
  }
  if (!derived.plainText.trim()) throw new HttpError("Draft body is required");
  return { document: derived.document, body: derived.plainText, html: derived.html };
}

/** Read-only projection for historical draft rows. Invalid stored JSON never becomes an implicit write. */
export function presentCampaignDraftBody(input: { body_document?: unknown; body?: string }, characterLimit: CampaignCharacterLimit = 20_000) {
  const legacyText = input.body ?? "";
  const legacy = legacyTextToCampaignDocument(legacyText);
  let malformed = false;
  let derived;
  try {
    derived = deriveCampaignDocument(input.body_document ?? legacy, characterLimit);
  } catch {
    malformed = true;
    try {
      derived = deriveCampaignDocument(legacy, characterLimit);
    } catch {
      // Historical text remains visible in the DTO, while the read-only editor
      // receives the bounded portion it can safely parse and never provider input.
      derived = deriveCampaignDocument(legacyTextToCampaignDocument(legacyText.slice(0, characterLimit)), characterLimit);
      return {
        document: derived.document,
        body: legacyText,
        html: derived.html,
        repair_required: true,
        repair_reason: "over_limit" as const,
      };
    }
  }
  let overLimit = false;
  try { deriveCampaignDocument(derived.document, 10_000); } catch { overLimit = true; }
  return {
    document: derived.document,
    body: derived.plainText,
    html: derived.html,
    repair_required: malformed || overLimit,
    repair_reason: overLimit ? "over_limit" as const : malformed ? "malformed" as const : undefined,
  };
}

function assertDraftBodyReadyForApproval(draft: Pick<CampaignCommunicatorDraft, "body" | "body_document" | "body_document_repair_required">): void {
  if (draft.body_document_repair_required) throw new ConflictError("Draft body must be repaired before approval");
  try {
    normalizeCampaignDraftBody({ body_document: draft.body_document ?? undefined, body: draft.body }, 10_000);
  } catch {
    throw new ConflictError("Draft body must be repaired before approval");
  }
}

function nextVersion(rows: readonly { version: number }[]) {
  return Math.max(0, ...rows.map((row) => row.version)) + 1;
}

function latestRunId(suggestions: CampaignCommunicatorSuggestion[]) {
  return currentAcceptedSuggestions(suggestions)[0]?.enrichment_run_id ?? null;
}

function currentAcceptedSuggestions(suggestions: CampaignCommunicatorSuggestion[]) {
  const accepted = buildAcceptedDraftContext<CampaignCommunicatorSuggestion, { suggestions: CampaignCommunicatorSuggestion[] }>({ suggestions }).suggestions;
  const current = new Map<string, CampaignCommunicatorSuggestion>();
  for (const suggestion of [...accepted].sort(compareSuggestionRecency)) {
    if (!current.has(suggestion.suggestion_type)) current.set(suggestion.suggestion_type, suggestion);
  }
  return [...current.values()].sort((left, right) => left.suggestion_type.localeCompare(right.suggestion_type));
}

function compareSuggestionRecency(left: CampaignCommunicatorSuggestion, right: CampaignCommunicatorSuggestion) {
  return right.created_at.getTime() - left.created_at.getTime()
    || right.updated_at.getTime() - left.updated_at.getTime()
    || right.id.localeCompare(left.id);
}

function acceptedSuggestionIdentity(suggestions: CampaignCommunicatorSuggestion[]) {
  return currentAcceptedSuggestions(suggestions).map((suggestion) => ({
    id: suggestion.id,
    suggestion_type: suggestion.suggestion_type,
    status: suggestion.status,
    updated_at: timestampIdentity(suggestion.updated_at),
  }));
}

function promptIdentity(prompt: CampaignCommunicatorPrompt | null) {
  return prompt ? { id: prompt.id, version: prompt.version } : null;
}

function timestampIdentity(value: Date | null) {
  return value?.toISOString() ?? null;
}

function previousSuggestionValue(
  lead: CampaignCommunicatorLead,
  suggestion: CampaignCommunicatorSuggestion,
  suggestions: CampaignCommunicatorSuggestion[],
) {
  if (isLeadSuggestionField(suggestion.suggestion_type)) return normalizeOptionalValue(lead[suggestion.suggestion_type]);
  const previous = currentAcceptedSuggestions(suggestions).find((candidate) => (
    candidate.id !== suggestion.id && candidate.suggestion_type === suggestion.suggestion_type
  ));
  return previous ? suggestionValue(previous) : null;
}

function normalizeOptionalValue(value: string | null) {
  return value?.trim() || null;
}

function inferChannel(contactRoute: string | null): GenerateDraftInput["channel"] {
  const route = contactRoute?.toLowerCase() ?? "";
  if (route.includes("instagram")) return "instagram_dm";
  if (route.includes("soundcloud")) return "soundcloud_message";
  if (route.includes("@") || route.startsWith("mailto:")) return "email";
  return "other";
}

function isLeadSuggestionField(value: string): value is "musical_fit" | "pitch_angle" | "contact_route" {
  return value === "musical_fit" || value === "pitch_angle" || value === "contact_route";
}

function isResearchSuggestionField(value: string): value is ResearchSuggestionField {
  return isLeadSuggestionField(value) || value === "programming_focus";
}

function hasUsableEvidence(evidence: readonly CitationEvidence[]) {
  return evidence.some((item) => {
    if (!item.title.trim() || !item.citation_text.trim() || Number.isNaN(new Date(item.retrieved_at).getTime())) return false;
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  });
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

type DrizzleExecutor = Pick<typeof db, "select" | "insert" | "update">;

function makeDrizzleTransaction(executor: DrizzleExecutor): CampaignCommunicatorTransaction {
  return {
    async lockCampaign(orgId, campaignId) {
      const rows = await executor.select({ id: campaigns.id }).from(campaigns).where(and(
        eq(campaigns.org_id, orgId),
        eq(campaigns.id, campaignId),
      )).for("update").limit(1);
      return rows.length === 1;
    },
    async lockLead(orgId, campaignId, leadId) {
      const rows = await executor.select({ id: campaign_leads.id }).from(campaign_leads).where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.campaign_id, campaignId),
        eq(campaign_leads.id, leadId),
      )).for("update").limit(1);
      return rows.length === 1;
    },
    async findCampaign(orgId, campaignId) {
      const row = (await executor.select({
        id: campaigns.id,
        org_id: campaigns.org_id,
        campaign_name: campaigns.campaign_name,
        artist_name: artists.name,
        release_title: releases.title,
      }).from(campaigns)
        .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
        .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))).limit(1))[0];
      return row ?? null;
    },
    async listCampaignLeads(orgId, campaignId) {
      const rows = await leadQuery(executor, orgId).where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.campaign_id, campaignId),
      ));
      return rows.map(toLead);
    },
    async findLead(orgId, leadId) {
      const row = (await leadQuery(executor, orgId).where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.id, leadId),
      )).limit(1))[0];
      return row ? toLead(row) : null;
    },
    async findLatestPrompt(orgId, campaignId) {
      const row = (await executor.select().from(campaign_communicator_prompts).where(and(
        eq(campaign_communicator_prompts.org_id, orgId),
        eq(campaign_communicator_prompts.campaign_id, campaignId),
      )).orderBy(desc(campaign_communicator_prompts.version)).limit(1))[0];
      return row ? toPrompt(row) : null;
    },
    async findReviewedPageRevision(orgId, campaignId, revisionId) {
      const row = (await executor.select({ revision: campaign_public_page_revisions, page: campaign_public_pages })
        .from(campaign_public_page_revisions)
        .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
        .where(and(
          eq(campaign_public_page_revisions.id, revisionId),
          eq(campaign_public_page_revisions.org_id, orgId),
          eq(campaign_public_page_revisions.review_status, "reviewed"),
          eq(campaign_public_pages.org_id, orgId),
          eq(campaign_public_pages.campaign_id, campaignId),
        )).limit(1))[0];
      if (!row) return null;
      return {
        org_id: row.revision.org_id,
        id: row.revision.id,
        campaign_id: row.page.campaign_id,
        page_id: row.revision.page_id,
        version: row.revision.version,
        review_status: row.revision.review_status as CampaignRadioPageRevision["review_status"],
        content_hash: row.revision.content_hash,
        content: row.revision.content as Record<string, unknown>,
        source_snapshot: row.revision.source_snapshot as Record<string, unknown>,
      };
    },
    async checkReviewedPageRevisionFresh(orgId, campaignId, revisionId) {
      return isCampaignPublicPageRevisionFresh(orgId, campaignId, revisionId, executor);
    },
    async listSuggestions(orgId, campaignId, leadId) {
      const conditions = [
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, campaignId),
      ];
      if (leadId) conditions.push(eq(campaign_enrichment_suggestions.lead_id, leadId));
      const rows = await executor.select({
        suggestion: campaign_enrichment_suggestions,
        sourceKind: campaign_enrichment_runs.source_kind,
        submittedByUserId: campaign_enrichment_runs.submitted_by_user_id,
        submittedByUserName: users.name,
        expectedLeadRevision: campaign_enrichment_runs.expected_lead_revision,
      }).from(campaign_enrichment_suggestions)
        .innerJoin(campaign_enrichment_runs, and(
          eq(campaign_enrichment_runs.id, campaign_enrichment_suggestions.enrichment_run_id),
          eq(campaign_enrichment_runs.org_id, orgId),
          eq(campaign_enrichment_runs.campaign_id, campaignId),
        ))
        .leftJoin(users, eq(users.id, campaign_enrichment_runs.submitted_by_user_id))
        .where(and(...conditions)).orderBy(desc(campaign_enrichment_suggestions.created_at));
      return rows.map((row) => toSuggestion(row.suggestion, row));
    },
    async findSuggestion(orgId, suggestionId) {
      const row = (await executor.select({
        suggestion: campaign_enrichment_suggestions,
        sourceKind: campaign_enrichment_runs.source_kind,
        submittedByUserId: campaign_enrichment_runs.submitted_by_user_id,
        submittedByUserName: users.name,
        expectedLeadRevision: campaign_enrichment_runs.expected_lead_revision,
      }).from(campaign_enrichment_suggestions)
        .innerJoin(campaign_enrichment_runs, and(
          eq(campaign_enrichment_runs.id, campaign_enrichment_suggestions.enrichment_run_id),
          eq(campaign_enrichment_runs.org_id, orgId),
          eq(campaign_enrichment_runs.campaign_id, campaign_enrichment_suggestions.campaign_id),
        ))
        .leftJoin(users, eq(users.id, campaign_enrichment_runs.submitted_by_user_id))
        .where(and(
          eq(campaign_enrichment_suggestions.org_id, orgId),
          eq(campaign_enrichment_suggestions.id, suggestionId),
        )).limit(1))[0];
      return row ? toSuggestion(row.suggestion, row) : null;
    },
    async listDrafts(orgId, campaignId, leadId) {
      const conditions = [
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
      ];
      if (leadId !== undefined) {
        conditions.push(leadId === null
          ? isNull(campaign_outreach_drafts.lead_id)
          : eq(campaign_outreach_drafts.lead_id, leadId));
      }
      const rows = await executor.select().from(campaign_outreach_drafts)
        .where(and(...conditions)).orderBy(desc(campaign_outreach_drafts.version));
      return rows.map(toDraft);
    },
    async findDraft(orgId, draftId) {
      const row = (await executor.select().from(campaign_outreach_drafts).where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.id, draftId),
      )).limit(1))[0];
      return row ? toDraft(row) : null;
    },
    async listEvents(orgId, campaignId, leadId) {
      const conditions = [
        eq(campaign_outreach_events.org_id, orgId),
        eq(campaign_outreach_events.campaign_id, campaignId),
      ];
      if (leadId) conditions.push(eq(campaign_outreach_events.lead_id, leadId));
      const rows = await executor.select().from(campaign_outreach_events)
        .where(and(...conditions)).orderBy(desc(campaign_outreach_events.occurred_at));
      return rows.map(toEvent);
    },
    async listLeadTasks(orgId, campaignId, leadId) {
      return executor.select({
        id: ops_tasks.id,
        org_id: ops_tasks.org_id,
        campaign_id: ops_tasks.linked_campaign_id,
        lead_id: ops_tasks.linked_campaign_lead_id,
        status: ops_tasks.status,
      }).from(ops_tasks).where(and(
        eq(ops_tasks.org_id, orgId),
        eq(ops_tasks.linked_campaign_id, campaignId),
        eq(ops_tasks.linked_campaign_lead_id, leadId),
      )).then((rows) => rows.flatMap((row) => row.campaign_id && row.lead_id ? [{ ...row, campaign_id: row.campaign_id, lead_id: row.lead_id }] : []));
    },
    async findRunningResearch(orgId, leadId) {
      const row = (await executor.select().from(campaign_enrichment_runs).where(and(
        eq(campaign_enrichment_runs.org_id, orgId),
        eq(campaign_enrichment_runs.lead_id, leadId),
        eq(campaign_enrichment_runs.status, "running"),
      )).limit(1))[0];
      return row ? toResearchRun(row) : null;
    },
    async findRecentResearchStart(orgId, leadId, actorUserId, since) {
      const row = (await executor.select().from(campaign_outreach_events).where(and(
        eq(campaign_outreach_events.org_id, orgId),
        eq(campaign_outreach_events.lead_id, leadId),
        eq(campaign_outreach_events.actor_user_id, actorUserId),
        eq(campaign_outreach_events.event_type, "research_started"),
        gte(campaign_outreach_events.occurred_at, since),
      )).orderBy(desc(campaign_outreach_events.occurred_at)).limit(1))[0];
      return row ? toEvent(row) : null;
    },
    async insertPrompt(row) {
      await executor.insert(campaign_communicator_prompts).values(row);
    },
    async insertResearchRun(row) {
      await executor.insert(campaign_enrichment_runs).values(row);
    },
    async updateResearchRun(orgId, runId, changes) {
      await executor.update(campaign_enrichment_runs).set(researchRunChanges(changes)).where(and(
        eq(campaign_enrichment_runs.org_id, orgId),
        eq(campaign_enrichment_runs.id, runId),
      ));
    },
    async insertSuggestions(rows) {
      if (rows.length) await executor.insert(campaign_enrichment_suggestions).values(rows);
    },
    async updateSuggestion(orgId, suggestionId, changes) {
      const rows = await executor.update(campaign_enrichment_suggestions).set(suggestionChanges(changes)).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.id, suggestionId),
        eq(campaign_enrichment_suggestions.status, "pending"),
      )).returning({ id: campaign_enrichment_suggestions.id });
      return rows.length === 1;
    },
    async supersedeAcceptedSuggestions(orgId, campaignId, leadId, suggestionType, exceptSuggestionId, updatedAt) {
      await executor.update(campaign_enrichment_suggestions).set({ status: "superseded", updated_at: updatedAt }).where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, campaignId),
        eq(campaign_enrichment_suggestions.lead_id, leadId),
        eq(campaign_enrichment_suggestions.suggestion_type, suggestionType),
        eq(campaign_enrichment_suggestions.status, "accepted"),
        ne(campaign_enrichment_suggestions.id, exceptSuggestionId),
      ));
    },
    async updateLead(orgId, campaignId, leadId, changes, expectedUpdatedAt) {
      const conditions = [
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.campaign_id, campaignId),
        eq(campaign_leads.id, leadId),
      ];
      if (expectedUpdatedAt) conditions.push(eq(campaign_leads.updated_at, expectedUpdatedAt));
      const rows = await executor.update(campaign_leads).set(leadChanges(changes)).where(and(...conditions)).returning({ id: campaign_leads.id });
      return rows.length === 1;
    },
    async supersedeDrafts(orgId, campaignId, leadId, updatedAt) {
      const conditions = [
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
        leadId === null ? isNull(campaign_outreach_drafts.lead_id) : eq(campaign_outreach_drafts.lead_id, leadId),
        ne(campaign_outreach_drafts.status, "superseded"),
      ];
      await executor.update(campaign_outreach_drafts).set({ status: "superseded", updated_at: updatedAt }).where(and(...conditions));
    },
    async insertDraft(row) {
      await executor.insert(campaign_outreach_drafts).values(row as typeof campaign_outreach_drafts.$inferInsert);
    },
    async approveDraft(orgId, draftId, changes) {
      const rows = await executor.update(campaign_outreach_drafts).set(draftChanges(changes)).where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.id, draftId),
        eq(campaign_outreach_drafts.status, "draft"),
      )).returning({ id: campaign_outreach_drafts.id });
      return rows.length === 1;
    },
    async insertEvent(row) {
      await executor.insert(campaign_outreach_events).values(row);
    },
  };
}

function leadQuery(executor: DrizzleExecutor, orgId: string) {
  return executor.select({
    id: campaign_leads.id,
    org_id: campaign_leads.org_id,
    campaign_id: campaign_leads.campaign_id,
    campaign_name: campaigns.campaign_name,
    artist_name: artists.name,
    release_title: releases.title,
    contact_id: campaign_leads.contact_id,
    contact_name: contacts.name,
    target_name: campaign_leads.target_name,
    target_url: campaign_leads.target_url,
    contact_route: campaign_leads.contact_route,
    contact_route_verified_at: campaign_leads.contact_route_verified_at,
    exact_edit_track_id: campaign_leads.exact_edit_track_id,
    musical_fit: campaign_leads.musical_fit,
    pitch_angle: campaign_leads.pitch_angle,
    recommending_person: campaign_leads.recommending_person,
    introduction_available: campaign_leads.introduction_available,
    readiness_task_waiver_reason: campaign_leads.readiness_task_waiver_reason,
    pipeline_stage: campaign_leads.pipeline_stage,
    last_contacted_at: campaign_leads.last_contacted_at,
    follow_up_at: campaign_leads.follow_up_at,
    updated_at: campaign_leads.updated_at,
  }).from(campaign_leads)
    .innerJoin(campaigns, and(eq(campaign_leads.campaign_id, campaigns.id), eq(campaigns.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(contacts, and(eq(campaign_leads.contact_id, contacts.id), eq(contacts.org_id, orgId)));
}

function toLead(row: Awaited<ReturnType<typeof leadQuery>>[number]): CampaignCommunicatorLead {
  return { ...row, pipeline_stage: campaignPipelineStageSchema.parse(row.pipeline_stage) };
}

function toPrompt(row: typeof campaign_communicator_prompts.$inferSelect): CampaignCommunicatorPrompt {
  return { ...row, created_at: row.created_at ?? new Date(0), updated_at: row.updated_at ?? new Date(0) };
}

function toResearchRun(row: typeof campaign_enrichment_runs.$inferSelect): CampaignCommunicatorResearchRun {
  return {
    ...row,
    status: row.status as CampaignCommunicatorResearchRun["status"],
    started_at: row.started_at ?? new Date(0),
    created_at: row.created_at ?? new Date(0),
    updated_at: row.updated_at ?? new Date(0),
  };
}

function toSuggestion(
  row: typeof campaign_enrichment_suggestions.$inferSelect,
  provenance?: {
    sourceKind?: string | null;
    submittedByUserId?: string | null;
    submittedByUserName?: string | null;
    expectedLeadRevision?: string | null;
  },
): CampaignCommunicatorSuggestion {
  const sourceKind = provenance?.sourceKind === "codex_mcp" ? "codex_mcp" : "in_app_provider";
  const projectedProvenance = projectCampaignCommunicatorProvenance({
    ...provenance,
    sourceKind,
    createdAt: row.created_at,
  });
  return {
    ...row,
    source_kind: sourceKind,
    ...(projectedProvenance ? { provenance: projectedProvenance } : {}),
    status: row.status as CampaignCommunicatorSuggestion["status"],
    created_at: row.created_at ?? new Date(0),
    updated_at: row.updated_at ?? new Date(0),
  };
}

export function projectCampaignCommunicatorProvenance(input: {
  sourceKind?: string | null;
  submittedByUserId?: string | null;
  submittedByUserName?: string | null;
  expectedLeadRevision?: string | null;
  createdAt?: Date | null;
}): CampaignCommunicatorSuggestion["provenance"] {
  if (input.sourceKind !== "codex_mcp") return undefined;
  const submittedByUserId = boundedNonEmptyText(input.submittedByUserId, 128);
  const submittedByUserName = boundedNonEmptyText(input.submittedByUserName, 120);
  return {
    submitting_operator: submittedByUserId && submittedByUserName
      ? { id: submittedByUserId, name: submittedByUserName }
      : null,
    created_at: input.createdAt ?? null,
    lead_revision: input.expectedLeadRevision?.match(/^[a-f0-9]{64}$/)
      ? input.expectedLeadRevision
      : null,
  };
}

function boundedNonEmptyText(value: string | null | undefined, limit: number) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, limit);
}

export function toDraft(row: typeof campaign_outreach_drafts.$inferSelect): CampaignCommunicatorDraft {
  const normalized = presentCampaignDraftBody({ body_document: row.body_document ?? undefined, body: row.body }, 20_000);
  return {
    ...row,
    body: normalized.body,
    body_document: normalized.document,
    body_html: normalized.html,
    body_document_repair_required: normalized.repair_required || undefined,
    body_document_repair_reason: normalized.repair_reason,
    scope: row.scope as CampaignCommunicatorDraft["scope"],
    status: row.status as CampaignCommunicatorDraft["status"],
    created_at: row.created_at ?? new Date(0),
    updated_at: row.updated_at ?? new Date(0),
  };
}

function toEvent(row: typeof campaign_outreach_events.$inferSelect): CampaignCommunicatorEvent {
  return { ...row, created_at: row.created_at ?? new Date(0), updated_at: row.updated_at ?? new Date(0) };
}

function researchRunChanges(changes: Partial<CampaignCommunicatorResearchRun>): Partial<typeof campaign_enrichment_runs.$inferInsert> {
  return pick(changes, ["status", "completed_at", "failure_reason", "updated_at"]);
}

function suggestionChanges(changes: Partial<CampaignCommunicatorSuggestion>): Partial<typeof campaign_enrichment_suggestions.$inferInsert> {
  return pick(changes, ["status", "resolved_by", "resolved_at", "updated_at"]);
}

function leadChanges(changes: Partial<CampaignCommunicatorLead>): Partial<typeof campaign_leads.$inferInsert> {
  return pick(changes, [
    "contact_route", "contact_route_verified_at", "exact_edit_track_id", "recommending_person", "introduction_available", "musical_fit", "pitch_angle", "pipeline_stage",
    "last_contacted_at", "follow_up_at", "readiness_task_waiver_reason", "updated_at",
  ] as const);
}

function draftChanges(changes: Partial<CampaignCommunicatorDraft>): Partial<typeof campaign_outreach_drafts.$inferInsert> {
  return pick(changes, ["status", "approval_hash", "approved_by", "approved_at", "updated_at"]);
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) if (key in source) result[key] = source[key];
  return result;
}

const drizzleStore: CampaignCommunicatorStore = {
  ...makeDrizzleTransaction(db),
  transaction: (callback) => db.transaction((tx) => callback(makeDrizzleTransaction(tx))),
};

const defaultDependencies: CampaignCommunicatorDependencies = {
  store: drizzleStore,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

export type CampaignCommunicatorContext = Awaited<ReturnType<typeof getCommunicatorContext>>;
export type CampaignCommunicatorReadyBlocker = ReadyBlocker;
