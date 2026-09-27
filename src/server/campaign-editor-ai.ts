import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  artists,
  campaign_communicator_prompts,
  campaign_enrichment_suggestions,
  campaign_editor_ai_runs,
  campaign_leads,
  campaign_outreach_drafts,
  campaign_public_pages,
  campaign_public_page_revisions,
  campaigns,
  releases,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import {
  buildEditorAiProposal,
  buildEditorAiProviderInput,
  buildEditorAiContext,
  decideProposal,
  type CampaignEditorAiAuthorizedContext,
  type CampaignEditorAiProposal,
  type CampaignEditorAiRunStatus,
  type CreateCampaignEditorAiRunInput,
} from "./campaign-editor-ai-core";
import type { CampaignEditorAiProvider } from "./campaign-editor-ai-provider";
import { CampaignEditorAiError } from "./openrouter-campaign-editor-ai";
import { ConflictError, NotFoundError } from "./errors";

export type CampaignEditorAiRunRow = {
  id: string;
  org_id: string;
  campaign_id: string;
  surface: CreateCampaignEditorAiRunInput["surface"];
  lead_id: string | null;
  draft_id: string | null;
  page_revision_id: string | null;
  operation: CreateCampaignEditorAiRunInput["operation"];
  scope: CreateCampaignEditorAiRunInput["scope"];
  selection_from: number | null;
  selection_to: number | null;
  input_document_hash: string;
  context_manifest: Record<string, unknown>;
  proposed_document: Record<string, unknown> | null;
  provider: string;
  model: string;
  rationale: string | null;
  citation_ids: string[];
  status: CampaignEditorAiRunStatus;
  failure_category: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignEditorAiLoadedContext = CampaignEditorAiAuthorizedContext & {
  /** Metadata only; it is persisted as the compact audit manifest, never sent to the provider. */
  manifest?: Record<string, unknown>;
  draft?: { id: string; lead_id?: string | null; scope?: "focused" | "radio_update"; version?: number; content_hash?: string } | null;
  page_revision?: { id: string; version?: number; content_hash?: string } | null;
};

/** This is the complete persistence boundary for the editor AI service. It contains no campaign/publication/outreach mutations. */
export interface CampaignEditorAiRunStore {
  loadContext(orgId: string, campaignId: string, input: CreateCampaignEditorAiRunInput): Promise<CampaignEditorAiLoadedContext | null>;
  insertRun(row: CampaignEditorAiRunRow): Promise<unknown>;
  updateRun(orgId: string, runId: string, expectedStatus: CampaignEditorAiRunStatus, changes: Partial<CampaignEditorAiRunRow>): Promise<boolean>;
  findRun(orgId: string, runId: string): Promise<CampaignEditorAiRunRow | null>;
}

export type CampaignEditorAiDependencies = {
  store: CampaignEditorAiRunStore;
  now: () => Date;
  randomUUID: () => string;
};

export type CampaignEditorAiRunDisplay = {
  provider: string;
  model: string;
  context_manifest: Record<string, unknown>;
  citations: Array<{ id: string; title: string; url: string }>;
};

export type CampaignEditorAiRunResult = CampaignEditorAiProposal & {
  run_id: string;
  display: CampaignEditorAiRunDisplay;
};

const defaultDependencies: CampaignEditorAiDependencies = {
  store: makeDatabaseStore(),
  now: () => new Date(),
  randomUUID,
};

/** Routes use the database-backed tenant store; service tests inject a small fake store. */
export function getCampaignEditorAiRunDependencies(): CampaignEditorAiDependencies {
  return defaultDependencies;
}

const failureCategories = new Set([
  "disabled", "refused", "timeout", "network", "provider", "malformed_output", "invalid_proposal", "unknown_citation",
]);

export const decideCampaignEditorAiRunSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  current_document_hash: z.string().regex(/^[a-f0-9]{64}$/, "Current document hash must be canonical lowercase SHA-256"),
}).strict();

export async function createCampaignEditorAiRun(
  orgId: string,
  campaignId: string,
  actorId: string,
  rawRequest: CreateCampaignEditorAiRunInput,
  provider: CampaignEditorAiProvider,
  dependencies: CampaignEditorAiDependencies,
): Promise<CampaignEditorAiRunResult> {
  void actorId;
  const context = await dependencies.store.loadContext(orgId, campaignId, rawRequest);
  if (!context || context.campaign.id !== campaignId) throw new NotFoundError("Campaign context was not found");
  assertSurfaceReferences(context, rawRequest);

  // Validates the canonical input hash before a row or provider request is created.
  buildEditorAiProviderInput(rawRequest, context);
  const now = dependencies.now();
  const runId = dependencies.randomUUID();
  const running: CampaignEditorAiRunRow = {
    id: runId,
    org_id: orgId,
    campaign_id: campaignId,
    surface: rawRequest.surface,
    lead_id: rawRequest.lead_id,
    draft_id: rawRequest.draft_id,
    page_revision_id: rawRequest.page_revision_id,
    operation: rawRequest.operation,
    scope: rawRequest.scope,
    selection_from: rawRequest.selection?.from ?? null,
    selection_to: rawRequest.selection?.to ?? null,
    input_document_hash: rawRequest.input_document_hash,
    context_manifest: buildContextManifest(context),
    proposed_document: null,
    provider: provider.id,
    model: provider.model,
    rationale: null,
    citation_ids: [],
    status: "running",
    failure_category: null,
    decided_by: null,
    decided_at: null,
    created_at: now,
    updated_at: now,
  };
  await dependencies.store.insertRun(running);

  if (provider.id === "disabled") await failRun(dependencies, orgId, runId, "disabled");

  const proposal = await (async (): Promise<CampaignEditorAiProposal> => {
    try {
      const providerInput = buildEditorAiProviderInput(rawRequest, context);
      const providerResult = await provider.transform(providerInput);
      return buildEditorAiProposal({ request: rawRequest, authorizedContext: context, providerResult });
    } catch (error) {
      return failRun(dependencies, orgId, runId, failureCategoryFor(error));
    }
  })();
  await requireTransition(dependencies.store.updateRun(orgId, runId, "running", {
    proposed_document: proposal.proposed_document as unknown as Record<string, unknown>,
    rationale: proposal.rationale,
    citation_ids: proposal.citation_ids,
    status: "ready",
    updated_at: dependencies.now(),
  }));
  return {
    ...proposal,
    run_id: runId,
    display: buildRunDisplay(context, running.context_manifest, provider, proposal.citation_ids),
  };
}

export async function decideCampaignEditorAiRun(
  orgId: string,
  runId: string,
  actorId: string,
  input: z.infer<typeof decideCampaignEditorAiRunSchema>,
  dependencies: CampaignEditorAiDependencies,
): Promise<{ run_id: string; status: "accepted" | "rejected" | "stale" }> {
  const request = decideCampaignEditorAiRunSchema.parse(input);
  const run = await dependencies.store.findRun(orgId, runId);
  if (!run) throw new NotFoundError("Campaign editor AI run was not found");
  // A stale first decision remains audited, but a second decision is never a state transition.
  if (run.status !== "ready") throw new ConflictError("Only ready AI proposals can be decided");
  const outcome = decideProposal({
    storedHash: run.input_document_hash,
    currentHash: request.current_document_hash,
    decision: request.decision,
    currentStatus: run.status,
  });
  if (outcome.status === "invalid") throw new ConflictError("Only ready AI proposals can be decided");
  const now = dependencies.now();
  await requireTransition(dependencies.store.updateRun(orgId, runId, "ready", {
    status: outcome.status,
    decided_by: actorId,
    decided_at: now,
    updated_at: now,
  }));
  if (outcome.status === "stale") throw new ConflictError("Proposal is stale");
  return { run_id: runId, status: outcome.status };
}

export class CampaignEditorAiRunFailure extends Error {
  constructor(public readonly category: string) {
    super("Campaign editor AI request could not be completed");
    this.name = "CampaignEditorAiRunFailure";
  }
}

/** The provider failure category is preserved, but storage details remain private and reconcilable. */
export class CampaignEditorAiAuditPersistenceError extends Error {
  constructor(public readonly category: string) {
    super("Campaign editor AI audit persistence could not be completed");
    this.name = "CampaignEditorAiAuditPersistenceError";
  }
}

function failureCategoryFor(error: unknown): string {
  if (error instanceof CampaignEditorAiError && failureCategories.has(error.code)) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string" && failureCategories.has((error as { code: string }).code)) {
    return (error as { code: string }).code;
  }
  return "invalid_proposal";
}

function buildContextManifest(context: CampaignEditorAiLoadedContext): Record<string, unknown> {
  const supplied = asPlainRecord(context.manifest);
  return {
    campaign: mergeCompactReferences(context.campaign, supplied.campaign),
    release: context.release ? mergeCompactReferences(context.release, supplied.release) : null,
    tracks: compactReferenceList(supplied.tracks),
    lead: context.lead ? mergeCompactReferences(context.lead, supplied.lead) : null,
    draft: context.draft ? mergeCompactReferences(context.draft, supplied.draft) : null,
    page_revision: context.page_revision ? mergeCompactReferences(context.page_revision, supplied.page_revision) : null,
    prompt: context.prompt ? mergeCompactReferences(context.prompt, supplied.prompt) : null,
    citation_ids: buildEditorAiContext(context).accepted_research.flatMap((item) => item.citation_ids),
  };
}

/** A response-only projection for review UI; it deliberately excludes provider output and authoritative copy. */
function buildRunDisplay(
  context: CampaignEditorAiLoadedContext,
  contextManifest: Record<string, unknown>,
  provider: CampaignEditorAiProvider,
  proposalCitationIds: readonly string[],
): CampaignEditorAiRunDisplay {
  const proposalIds = new Set(proposalCitationIds);
  const usableIds = new Set(buildEditorAiContext(context).accepted_research.flatMap((item) => item.citation_ids));
  const citations = (context.accepted_research ?? context.research ?? []).flatMap((suggestion) => {
    if (suggestion.status !== "accepted") return [];
    const declared = new Set(suggestion.citation_ids ?? []);
    return (suggestion.evidence ?? []).flatMap((evidence) => {
      const id = typeof evidence.id === "string" ? evidence.id.trim() : "";
      const title = typeof evidence.title === "string" ? evidence.title.trim() : "";
      const url = safeCitationUrl(evidence.url);
      if (!id || !title || !url || (declared.size > 0 && !declared.has(id)) || !proposalIds.has(id) || !usableIds.has(id)) return [];
      return [{ id, title, url }];
    });
  });
  return {
    provider: provider.id,
    model: provider.model,
    context_manifest: contextManifest,
    citations: Array.from(new Map(citations.map((citation) => [citation.id, citation])).values()),
  };
}

function safeCitationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mergeCompactReferences(...values: unknown[]): Record<string, unknown> {
  return Object.assign({}, ...values.map(compactReference));
}

function compactReferenceList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(compactReference).filter((item) => typeof item.id === "string") : [];
}

function compactReference(value: unknown): Record<string, unknown> {
  const source = asPlainRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of ["id", "version", "content_hash", "updated_at"] as const) {
    const candidate = source[key];
    if (typeof candidate === "string" || typeof candidate === "number") result[key] = candidate;
  }
  return result;
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function requireTransition(updated: Promise<boolean>): Promise<void> {
  if (!await updated) throw new ConflictError("Campaign editor AI run changed before this transition could be recorded");
}

async function failRun(
  dependencies: CampaignEditorAiDependencies,
  orgId: string,
  runId: string,
  category: string,
): Promise<never> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const updated = await dependencies.store.updateRun(orgId, runId, "running", {
        status: "failed",
        failure_category: category,
        updated_at: dependencies.now(),
      });
      if (updated) throw new CampaignEditorAiRunFailure(category);
    } catch (error) {
      if (error instanceof CampaignEditorAiRunFailure) throw error;
    }
  }
  throw new CampaignEditorAiAuditPersistenceError(category);
}

function assertSurfaceReferences(context: CampaignEditorAiLoadedContext, input: CreateCampaignEditorAiRunInput): void {
  if (input.surface === "focused_outreach_body") {
    if (!context.lead || !context.draft || context.lead.id !== input.lead_id || context.draft.id !== input.draft_id
      || context.draft.lead_id !== input.lead_id || context.draft.scope !== "focused") {
      throw new NotFoundError("Focused editor references were not found");
    }
  }
  if (input.surface === "radio_update_body") {
    if (!context.draft || !context.page_revision || context.draft.id !== input.draft_id || context.page_revision.id !== input.page_revision_id
      || context.draft.lead_id !== null || context.draft.scope !== "radio_update") {
      throw new NotFoundError("Radio editor references were not found");
    }
  }
}

function makeDatabaseStore(): CampaignEditorAiRunStore {
  return {
    async loadContext(orgId, campaignId, input) {
      const campaign = (await db.select({
        id: campaigns.id,
        name: campaigns.campaign_name,
        goal: campaigns.goal,
        notes: campaigns.notes,
        linked_release_id: campaigns.linked_release_id,
        updated_at: campaigns.updated_at,
      }).from(campaigns).where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId))).limit(1))[0];
      if (!campaign) return null;

      const release = campaign.linked_release_id
        ? (await db.select({ id: releases.id, title: releases.title, artist_name: artists.name, updated_at: releases.updated_at })
          .from(releases).leftJoin(artists, and(eq(artists.id, releases.artist_id), eq(artists.org_id, orgId)))
          .where(and(eq(releases.org_id, orgId), eq(releases.id, campaign.linked_release_id))).limit(1))[0] ?? null
        : null;
      if (campaign.linked_release_id && !release) return null;
      const releaseTracks = release
        ? await db.select({ id: tracks.id, title: tracks.title, updated_at: tracks.updated_at }).from(tracks)
          .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, release.id))).orderBy(tracks.position)
        : [];

      const lead = input.lead_id
        ? (await db.select({ id: campaign_leads.id, target_name: campaign_leads.target_name, musical_fit: campaign_leads.musical_fit, pitch_angle: campaign_leads.pitch_angle, updated_at: campaign_leads.updated_at })
          .from(campaign_leads).where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.id, input.lead_id))).limit(1))[0] ?? null
        : null;
      if (input.lead_id && !lead) return null;

      const draft = input.draft_id
        ? (await db.select({ id: campaign_outreach_drafts.id, lead_id: campaign_outreach_drafts.lead_id, scope: campaign_outreach_drafts.scope, version: campaign_outreach_drafts.version, approval_hash: campaign_outreach_drafts.approval_hash, updated_at: campaign_outreach_drafts.updated_at })
          .from(campaign_outreach_drafts).where(and(eq(campaign_outreach_drafts.org_id, orgId), eq(campaign_outreach_drafts.campaign_id, campaignId), eq(campaign_outreach_drafts.id, input.draft_id))).limit(1))[0] ?? null
        : null;
      if (input.draft_id && (!draft
        || (input.lead_id !== null && draft.lead_id !== input.lead_id)
        || (input.surface === "focused_outreach_body" && draft.scope !== "focused")
        || (input.surface === "radio_update_body" && draft.scope !== "radio_update"))) return null;

      const revision = input.page_revision_id
        ? (await db.select({ id: campaign_public_page_revisions.id, version: campaign_public_page_revisions.version, content_hash: campaign_public_page_revisions.content_hash, updated_at: campaign_public_page_revisions.updated_at })
          .from(campaign_public_page_revisions).innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
          .where(and(eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId), eq(campaign_public_page_revisions.id, input.page_revision_id))).limit(1))[0] ?? null
        : null;
      if (input.page_revision_id && !revision) return null;

      const prompt = (await db.select({ id: campaign_communicator_prompts.id, version: campaign_communicator_prompts.version, text: campaign_communicator_prompts.prompt, updated_at: campaign_communicator_prompts.updated_at })
        .from(campaign_communicator_prompts).where(and(eq(campaign_communicator_prompts.org_id, orgId), eq(campaign_communicator_prompts.campaign_id, campaignId)))
        .orderBy(desc(campaign_communicator_prompts.version)).limit(1))[0] ?? null;
      const suggestions = lead
        ? await db.select().from(campaign_enrichment_suggestions).where(and(eq(campaign_enrichment_suggestions.org_id, orgId), eq(campaign_enrichment_suggestions.campaign_id, campaignId), eq(campaign_enrichment_suggestions.lead_id, lead.id), eq(campaign_enrichment_suggestions.status, "accepted")))
        : [];

      return {
        campaign: { id: campaign.id, name: campaign.name, goal: campaign.goal ?? "", notes: campaign.notes ?? "" },
        release: release ? { id: release.id, title: release.title, artist_name: release.artist_name, track_titles: releaseTracks.map((track) => track.title) } : null,
        lead: lead ? { id: lead.id, target_name: lead.target_name, musical_fit: lead.musical_fit, pitch_angle: lead.pitch_angle } : null,
        draft: draft ? { id: draft.id, lead_id: draft.lead_id, scope: draft.scope === "focused" || draft.scope === "radio_update" ? draft.scope : undefined, version: draft.version, content_hash: draft.approval_hash ?? undefined } : null,
        page_revision: revision ? { id: revision.id, version: revision.version, content_hash: revision.content_hash } : null,
        prompt: prompt ? { id: prompt.id, version: prompt.version, text: prompt.text } : null,
        research: suggestions.map((suggestion) => ({
          id: suggestion.id,
          status: suggestion.status,
          suggested_value: suggestion.suggested_value,
          evidence: ((suggestion.evidence ?? []) as Array<Record<string, unknown>>).map((evidence, index) => ({
            id: typeof evidence.id === "string" && evidence.id ? evidence.id : `${suggestion.id}:${index + 1}`,
            title: typeof evidence.title === "string" ? evidence.title : "",
            url: typeof evidence.url === "string" ? evidence.url : "",
            retrieved_at: typeof evidence.retrieved_at === "string" ? evidence.retrieved_at : "",
            citation_text: typeof evidence.citation_text === "string" ? evidence.citation_text : "",
          })),
        })),
        manifest: {
          campaign: { id: campaign.id, updated_at: freshnessTimestamp(campaign.updated_at) },
          release: release ? { id: release.id, updated_at: freshnessTimestamp(release.updated_at) } : null,
          tracks: releaseTracks.map((track) => ({ id: track.id, updated_at: freshnessTimestamp(track.updated_at) })),
          lead: lead ? { id: lead.id, updated_at: freshnessTimestamp(lead.updated_at) } : null,
          prompt: prompt ? { id: prompt.id, version: prompt.version, updated_at: freshnessTimestamp(prompt.updated_at) } : null,
        },
      };
    },
    async insertRun(row) {
      await db.insert(campaign_editor_ai_runs).values(row);
    },
    async updateRun(orgId, runId, expectedStatus, changes) {
      const updated = await db.update(campaign_editor_ai_runs).set(changes).where(and(eq(campaign_editor_ai_runs.org_id, orgId), eq(campaign_editor_ai_runs.id, runId), eq(campaign_editor_ai_runs.status, expectedStatus))).returning({ id: campaign_editor_ai_runs.id });
      return updated.length === 1;
    },
    async findRun(orgId, runId) {
      const row = (await db.select().from(campaign_editor_ai_runs).where(and(eq(campaign_editor_ai_runs.org_id, orgId), eq(campaign_editor_ai_runs.id, runId))).limit(1))[0];
      return row ? row as CampaignEditorAiRunRow : null;
    },
  };
}

function freshnessTimestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
