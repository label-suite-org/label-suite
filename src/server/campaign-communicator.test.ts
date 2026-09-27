import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CampaignCommunicatorProvider } from "./campaign-communicator-provider";
import type { CampaignDocument } from "../lib/campaign-rich-text";

vi.mock("../lib/db", () => ({ db: {} }));

import {
  approveDraft,
  createGeneratedDraft,
  createRadioUpdateDraft,
  createManualRadioUpdateDraft,
  createManualDraftVersion,
  decideSuggestion,
  recordExternalSend,
  runLeadResearch,
  saveCommunicatorPrompt,
  overrideLeadStage,
  updateLeadPreparation,
  updateLeadPreparationSchema,
  hashDraftContent,
  presentCampaignDraftBody,
  toDraft,
  type CampaignCommunicatorDependencies,
  type CampaignCommunicatorDraft,
  type CampaignCommunicatorEvent,
  type CampaignCommunicatorLead,
  type CampaignCommunicatorPrompt,
  type CampaignCommunicatorResearchRun,
  type CampaignCommunicatorSuggestion,
  type CampaignRadioPageRevision,
  type CampaignCommunicatorTransaction,
  getCommunicatorContext,
  projectCampaignCommunicatorProvenance,
} from "./campaign-communicator";

const ORG = "org-1";
const CAMPAIGN = "campaign-1";
const LEAD = "lead-1";
const USER = "user-1";
const NOW = new Date("2026-08-04T10:00:00.000Z");

function doc(text: string): CampaignDocument {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function lead(overrides: Partial<CampaignCommunicatorLead> = {}): CampaignCommunicatorLead {
  return {
    id: LEAD,
    org_id: ORG,
    campaign_id: CAMPAIGN,
    campaign_name: "Fountain",
    artist_name: "Fountain",
    release_title: "Fountain Edits",
    contact_id: "contact-1",
    contact_name: "Editor",
    target_name: "Night Radio",
    target_url: "https://example.com/night-radio",
    contact_route: "editor@example.com",
    contact_route_verified_at: new Date("2026-08-01T10:00:00.000Z"),
    exact_edit_track_id: "track-1",
    musical_fit: "Leftfield dance music",
    pitch_angle: "Exclusive edit for the evening show",
    recommending_person: null,
    introduction_available: null,
    readiness_task_waiver_reason: null,
    pipeline_stage: "qualified",
    last_contacted_at: null,
    follow_up_at: null,
    updated_at: new Date("2026-08-04T09:00:00.000Z"),
    ...overrides,
  };
}

function suggestion(overrides: Partial<CampaignCommunicatorSuggestion> = {}): CampaignCommunicatorSuggestion {
  return {
    id: "suggestion-1",
    org_id: ORG,
    campaign_id: CAMPAIGN,
    lead_id: LEAD,
    enrichment_run_id: "run-1",
    suggestion_type: "musical_fit",
    suggested_value: { value: "Warm, leftfield club music", rationale: "Recent programming" },
    evidence: [{
      title: "Night Radio archive",
      url: "https://example.com/night-radio/archive",
      retrieved_at: "2026-08-04T08:00:00.000Z",
      citation_text: "Recent programming includes leftfield club music.",
    }],
    status: "pending",
    resolved_by: null,
    resolved_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function draft(overrides: Partial<CampaignCommunicatorDraft> = {}): CampaignCommunicatorDraft {
  return {
    id: "draft-1",
    org_id: ORG,
    campaign_id: CAMPAIGN,
    lead_id: LEAD,
    enrichment_run_id: "run-1",
    scope: "focused",
    version: 1,
    status: "draft",
    subject: "Fountain for Night Radio",
    body: "Hello Editor,\n\nHere is the Fountain edit.",
    body_document: doc("Hello Editor,\n\nHere is the Fountain edit."),
    body_html: "<p>Hello Editor,<br><br>Here is the Fountain edit.</p>",
    context_snapshot: { campaign_name: "Fountain", suggestions: [] },
    approval_hash: null,
    approved_by: null,
    approved_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function createHarness() {
  const state = {
    campaigns: [{ id: CAMPAIGN, org_id: ORG, campaign_name: "Fountain", artist_name: "Fountain", release_title: "Fountain Edits" }],
    leads: [lead()],
    prompts: [{
      id: "prompt-1", org_id: ORG, campaign_id: CAMPAIGN, version: 1, prompt: "Direct",
      created_by: USER, created_at: NOW, updated_at: NOW,
    }] as CampaignCommunicatorPrompt[],
    runs: [] as CampaignCommunicatorResearchRun[],
    suggestions: [] as CampaignCommunicatorSuggestion[],
    drafts: [] as CampaignCommunicatorDraft[],
    pageRevisions: [] as CampaignRadioPageRevision[],
    pageRevisionFresh: true,
    events: [] as CampaignCommunicatorEvent[],
    tasks: [{ id: "task-1", org_id: ORG, campaign_id: CAMPAIGN, lead_id: LEAD, status: "todo" }],
  };
  let sequence = 1;

  const tx: CampaignCommunicatorTransaction = {
    lockCampaign: async (orgId, campaignId) => state.campaigns.some((row) => row.org_id === orgId && row.id === campaignId),
    lockLead: async (orgId, campaignId, leadId) => state.leads.some((row) => (
      row.org_id === orgId && row.campaign_id === campaignId && row.id === leadId
    )),
    findCampaign: async (orgId, campaignId) => state.campaigns.find((row) => row.org_id === orgId && row.id === campaignId) ?? null,
    listCampaignLeads: async (orgId, campaignId) => state.leads.filter((row) => row.org_id === orgId && row.campaign_id === campaignId),
    findLead: async (orgId, leadId) => state.leads.find((row) => row.org_id === orgId && row.id === leadId) ?? null,
    findLatestPrompt: async (orgId, campaignId) => state.prompts
      .filter((row) => row.org_id === orgId && row.campaign_id === campaignId)
      .sort((a, b) => b.version - a.version)[0] ?? null,
    findReviewedPageRevision: async (orgId, campaignId, revisionId) => state.pageRevisions.find((row) => row.org_id === orgId && row.campaign_id === campaignId && row.id === revisionId && row.review_status === "reviewed") ?? null,
    checkReviewedPageRevisionFresh: async () => state.pageRevisionFresh,
    listSuggestions: async (orgId, campaignId, leadId) => state.suggestions.filter((row) => (
      row.org_id === orgId && row.campaign_id === campaignId && (!leadId || row.lead_id === leadId)
    )),
    findSuggestion: async (orgId, suggestionId) => state.suggestions.find((row) => row.org_id === orgId && row.id === suggestionId) ?? null,
    listDrafts: async (orgId, campaignId, leadId) => state.drafts.filter((row) => (
      row.org_id === orgId && row.campaign_id === campaignId && (leadId === undefined || row.lead_id === leadId)
    )),
    findDraft: async (orgId, draftId) => state.drafts.find((row) => row.org_id === orgId && row.id === draftId) ?? null,
    listEvents: async (orgId, campaignId, leadId) => state.events.filter((row) => (
      row.org_id === orgId && row.campaign_id === campaignId && (leadId === undefined || row.lead_id === leadId)
    )),
    listLeadTasks: async (orgId, campaignId, leadId) => state.tasks.filter((row) => (
      row.org_id === orgId && row.campaign_id === campaignId && row.lead_id === leadId
    )),
    findRunningResearch: async (orgId, leadId) => state.runs.find((row) => row.org_id === orgId && row.lead_id === leadId && row.status === "running") ?? null,
    findRecentResearchStart: async (orgId, leadId, actorUserId, since) => state.events.find((row) => (
      row.org_id === orgId && row.lead_id === leadId && row.actor_user_id === actorUserId
      && row.event_type === "research_started" && row.occurred_at >= since
    )) ?? null,
    insertPrompt: async (row) => state.prompts.push(row),
    insertResearchRun: async (row) => {
      if (state.runs.some((candidate) => candidate.org_id === row.org_id && candidate.lead_id === row.lead_id && candidate.status === "running")) {
        throw Object.assign(new Error("private unique detail"), { code: "23505", constraint: "campaign_enrichment_runs_org_lead_running_unique_idx" });
      }
      state.runs.push(row);
    },
    updateResearchRun: async (orgId, runId, changes) => {
      const row = state.runs.find((candidate) => candidate.org_id === orgId && candidate.id === runId);
      if (row) Object.assign(row, changes);
    },
    insertSuggestions: async (rows) => state.suggestions.push(...rows),
    updateSuggestion: async (orgId, suggestionId, changes) => {
      const row = state.suggestions.find((candidate) => candidate.org_id === orgId && candidate.id === suggestionId);
      if (!row) return false;
      Object.assign(row, changes);
      return true;
    },
    supersedeAcceptedSuggestions: async (orgId, campaignId, leadId, suggestionType, exceptSuggestionId, updatedAt) => {
      for (const row of state.suggestions) {
        if (
          row.org_id === orgId
          && row.campaign_id === campaignId
          && row.lead_id === leadId
          && row.suggestion_type === suggestionType
          && row.id !== exceptSuggestionId
          && row.status === "accepted"
        ) {
          row.status = "superseded";
          row.updated_at = updatedAt;
        }
      }
    },
    updateLead: async (orgId, campaignId, leadId, changes, expectedUpdatedAt) => {
      const row = state.leads.find((candidate) => candidate.org_id === orgId && candidate.campaign_id === campaignId && candidate.id === leadId);
      if (!row || (expectedUpdatedAt && row.updated_at?.getTime() !== expectedUpdatedAt.getTime())) return false;
      Object.assign(row, changes);
      return true;
    },
    supersedeDrafts: async (orgId, campaignId, leadId, updatedAt) => {
      for (const row of state.drafts) {
        if (row.org_id === orgId && row.campaign_id === campaignId && row.lead_id === leadId && row.status !== "superseded") {
          row.status = "superseded";
          row.updated_at = updatedAt;
        }
      }
    },
    insertDraft: async (row) => state.drafts.push(row),
    approveDraft: async (orgId, draftId, changes) => {
      const row = state.drafts.find((candidate) => candidate.org_id === orgId && candidate.id === draftId && candidate.status === "draft");
      if (!row) return false;
      Object.assign(row, changes);
      return true;
    },
    insertEvent: async (row) => state.events.push(row),
  };

  const store = {
    ...tx,
    transaction: async <T>(callback: (transaction: CampaignCommunicatorTransaction) => Promise<T>) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  };

  const dependencies: CampaignCommunicatorDependencies = {
    store,
    now: () => new Date(NOW),
    randomUUID: () => `generated-${sequence++}`,
  };
  return { dependencies, state };
}

describe("tenant-scoped campaign communicator persistence", () => {
  test("projects bounded authoritative Codex provenance and preserves in-app provider semantics", () => {
    expect(projectCampaignCommunicatorProvenance({
      sourceKind: "codex_mcp",
      submittedByUserId: `user-${"i".repeat(200)}`,
      submittedByUserName: `Operator ${"n".repeat(200)}`,
      expectedLeadRevision: "c".repeat(64),
      createdAt: NOW,
    })).toEqual({
      submitting_operator: {
        id: `user-${"i".repeat(123)}`,
        name: `Operator ${"n".repeat(111)}`,
      },
      created_at: NOW,
      lead_revision: "c".repeat(64),
    });
    expect(projectCampaignCommunicatorProvenance({
      sourceKind: "codex_mcp",
      submittedByUserId: null,
      submittedByUserName: null,
      expectedLeadRevision: null,
      createdAt: null,
    })).toEqual({ submitting_operator: null, created_at: null, lead_revision: null });
    expect(projectCampaignCommunicatorProvenance({
      sourceKind: "in_app_provider",
      submittedByUserId: USER,
      submittedByUserName: "Provider operator",
      expectedLeadRevision: "d".repeat(64),
      createdAt: NOW,
    })).toBeUndefined();
  });

  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("hides another tenant's suggestion and does not mutate it", async () => {
    harness.state.suggestions.push(suggestion());

    await expect(decideSuggestion("other-org", "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T09:00:00.000Z",
    }, USER, harness.dependencies)).rejects.toThrow("Suggestion not found");

    expect(harness.state.suggestions[0].status).toBe("pending");
    expect(harness.state.leads[0].musical_fit).toBe("Leftfield dance music");
  });

  test("increments the tenant campaign prompt version without overwriting history", async () => {
    const result = await saveCommunicatorPrompt(ORG, CAMPAIGN, "  Warm and direct  ", USER, harness.dependencies);

    expect(result.version).toBe(2);
    expect(harness.state.prompts.map((row) => [row.version, row.prompt])).toEqual([
      [1, "Direct"],
      [2, "Warm and direct"],
    ]);
  });

  test("rejects an active research run before calling the provider", async () => {
    harness.state.runs.push({
      id: "running-1", org_id: ORG, campaign_id: CAMPAIGN, lead_id: LEAD, prompt_id: "prompt-1",
      status: "running", started_at: new Date("2026-08-04T09:58:00.000Z"), completed_at: null,
      failure_reason: null, created_at: NOW, updated_at: NOW,
    });
    const provider = researchProvider();

    await expect(runLeadResearch(ORG, LEAD, USER, provider, NOW, harness.dependencies))
      .rejects.toThrow("Research is already running");
    expect(provider.researchLead).not.toHaveBeenCalled();
  });

  test("enforces a recent same-operator lead cooldown", async () => {
    harness.state.events.push(event({
      event_type: "research_started",
      actor_user_id: USER,
      occurred_at: new Date("2026-08-04T09:55:00.000Z"),
      details: { enrichment_run_id: "old-run" },
    }));

    await expect(runLeadResearch(ORG, LEAD, USER, researchProvider(), NOW, harness.dependencies))
      .rejects.toThrow("Research was run too recently");
  });

  test("records a sanitized failed research outcome without provider payloads", async () => {
    const provider = researchProvider();
    vi.mocked(provider.researchLead).mockRejectedValue(new Error("private provider token and payload"));

    await expect(runLeadResearch(ORG, LEAD, USER, provider, NOW, harness.dependencies))
      .rejects.toThrow("Lead research failed");

    expect(harness.state.runs[0]).toMatchObject({ status: "failed", failure_reason: "Research provider failed" });
    expect(JSON.stringify(harness.state)).not.toContain("private provider token and payload");
  });

  test("atomically rejects stale accepted facts and preserves draft and lead state", async () => {
    harness.state.suggestions.push(suggestion());
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "old-hash", approved_by: USER, approved_at: NOW }));

    await expect(decideSuggestion(ORG, "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T08:59:59.000Z",
    }, USER, harness.dependencies)).rejects.toThrow("Lead changed while reviewing this suggestion");

    expect(harness.state.suggestions[0].status).toBe("pending");
    expect(harness.state.drafts[0].status).toBe("approved");
    expect(harness.state.leads[0].musical_fit).toBe("Leftfield dance music");
  });

  test("accepts a cited fact and invalidates the previously approved draft", async () => {
    harness.state.suggestions.push(suggestion());
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "old-hash", approved_by: USER, approved_at: NOW }));

    const result = await decideSuggestion(ORG, "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T09:00:00.000Z",
    }, USER, harness.dependencies);

    expect(result.status).toBe("accepted");
    expect(harness.state.leads[0].musical_fit).toBe("Warm, leftfield club music");
    expect(harness.state.suggestions[0].status).toBe("accepted");
    expect(harness.state.drafts[0]).toMatchObject({ status: "superseded", approval_hash: "old-hash" });
    expect(harness.state.events.at(-1)).toMatchObject({
      event_type: "suggestion_accepted",
      details: {
        suggestion_id: "suggestion-1",
        suggestion_type: "musical_fit",
        previous_value: "Leftfield dance music",
        accepted_value: "Warm, leftfield club music",
      },
    });
  });

  test("keeps an MCP-created proposal pending until the human decision path accepts it", async () => {
    const mcpSuggestion = suggestion({
      enrichment_run_id: "run-codex-mcp",
      source_kind: "codex_mcp",
      provenance: {
        submitting_operator: { id: USER, name: "Release Gate Operator" },
        created_at: NOW,
        lead_revision: "a".repeat(64),
      },
      status: "pending",
    });
    const originalEvidence = structuredClone(mcpSuggestion.evidence);
    harness.state.leads[0].pipeline_stage = "ready";
    harness.state.suggestions.push(mcpSuggestion);
    harness.state.drafts.push(draft({
      status: "approved",
      approval_hash: "old-hash",
      approved_by: USER,
      approved_at: NOW,
    }));

    expect(harness.state.suggestions[0].status).toBe("pending");
    expect(harness.state.leads[0]).toMatchObject({
      musical_fit: "Leftfield dance music",
      pipeline_stage: "ready",
    });
    await expect(decideSuggestion(ORG, "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T08:59:59.000Z",
    }, USER, harness.dependencies)).rejects.toThrow("Lead changed while reviewing this suggestion");

    const result = await decideSuggestion(ORG, "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T09:00:00.000Z",
    }, USER, harness.dependencies);

    expect(result).toEqual({ id: "suggestion-1", status: "accepted" });
    expect(harness.state.suggestions[0]).toMatchObject({
      status: "accepted",
      resolved_by: USER,
      resolved_at: NOW,
      evidence: originalEvidence,
    });
    expect(harness.state.leads[0]).toMatchObject({
      musical_fit: "Warm, leftfield club music",
      pipeline_stage: "qualified",
    });
    expect(harness.state.drafts[0]).toMatchObject({ status: "superseded", approval_hash: "old-hash" });
    expect(harness.state.events.at(-1)).toMatchObject({
      event_type: "suggestion_accepted",
      actor_user_id: USER,
      details: {
        suggestion_id: "suggestion-1",
        suggestion_type: "musical_fit",
        previous_value: "Leftfield dance music",
        accepted_value: "Warm, leftfield club music",
      },
    });
  });

  test("returns the authoritative pending Codex run provenance without mutating it", async () => {
    const mcpSuggestion = suggestion({
      enrichment_run_id: "run-codex-mcp",
      source_kind: "codex_mcp",
      provenance: {
        submitting_operator: { id: USER, name: "Release Gate Operator" },
        created_at: NOW,
        lead_revision: "b".repeat(64),
      },
      status: "pending",
    });
    harness.state.suggestions.push(mcpSuggestion);

    const context = await getCommunicatorContext(ORG, CAMPAIGN, harness.dependencies);

    expect(context.leads[LEAD]?.suggestions).toContainEqual(expect.objectContaining({
      id: "suggestion-1",
      source_kind: "codex_mcp",
      provenance: {
        submitting_operator: { id: USER, name: "Release Gate Operator" },
        created_at: NOW,
        lead_revision: "b".repeat(64),
      },
      status: "pending",
      created_at: NOW,
      suggested_value: {
        value: "Warm, leftfield club music",
        rationale: "Recent programming",
      },
    }));
    expect(harness.state.suggestions[0]).toEqual(mcpSuggestion);
  });

  test("supersedes the prior accepted value when accepting a same-field replacement", async () => {
    harness.state.suggestions.push(
      suggestion({ id: "suggestion-old", status: "accepted", suggested_value: { value: "Earlier fit", rationale: "Earlier evidence" } }),
      suggestion({ id: "suggestion-new", suggested_value: { value: "Current fit", rationale: "Current evidence" } }),
    );

    await decideSuggestion(ORG, "suggestion-new", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T09:00:00.000Z",
    }, USER, harness.dependencies);

    expect(harness.state.suggestions.map((row) => [row.id, row.status])).toEqual([
      ["suggestion-old", "superseded"],
      ["suggestion-new", "accepted"],
    ]);
    expect(harness.state.events.at(-1)?.details).toMatchObject({
      previous_value: "Leftfield dance music",
      accepted_value: "Current fit",
    });
  });

  test("clears contact-route verification when accepting a replacement route", async () => {
    harness.state.suggestions.push(suggestion({
      suggestion_type: "contact_route",
      suggested_value: { value: "new-editor@example.com", rationale: "Current contact page" },
    }));

    await decideSuggestion(ORG, "suggestion-1", {
      decision: "accepted",
      expected_lead_updated_at: "2026-08-04T09:00:00.000Z",
    }, USER, harness.dependencies);

    expect(harness.state.leads[0]).toMatchObject({
      contact_route: "new-editor@example.com",
      contact_route_verified_at: null,
    });
  });

  test("generates a new draft version from accepted cited facts only", async () => {
    harness.state.suggestions.push(
      suggestion({ status: "accepted" }),
      suggestion({ id: "suggestion-2", status: "rejected", suggested_value: { value: "Rejected", rationale: "Rejected" } }),
    );
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "old", approved_by: USER, approved_at: NOW }));
    const provider = researchProvider();

    const result = await createGeneratedDraft(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      instruction: "Mention the edit",
    }, USER, provider, harness.dependencies);

    expect(provider.generateDraft).toHaveBeenCalledWith(expect.objectContaining({
      instruction: "Direct\n\nMention the edit",
      suggestions: [expect.objectContaining({ value: "Warm, leftfield club music", status: "accepted" })],
    }));
    expect(result).toMatchObject({ version: 2, status: "draft", subject: "Subject", body: "Body", body_document: doc("Body"), body_html: "<p>Body</p>" });
    expect(harness.state.drafts[0]).toMatchObject({ status: "superseded", approval_hash: "old" });
  });

  test("persists a rich manual body as a new unapproved version without mutating the approved source", async () => {
    const approved = draft({ status: "approved", approval_hash: "approved-content", approved_by: USER, approved_at: NOW });
    harness.state.drafts.push(approved);

    const result = await createManualDraftVersion(ORG, approved.id, {
      subject: "Revised subject",
      body_document: doc("Listen here"),
    }, USER, harness.dependencies);

    expect(result).toMatchObject({ version: 2, status: "draft", body: "Listen here", body_document: doc("Listen here"), body_html: "<p>Listen here</p>" });
    expect(harness.state.drafts[0]).toMatchObject({ status: "superseded", approval_hash: "approved-content", approved_by: USER });
    expect(result.approval_hash).toBeNull();
  });

  test("invalidates approval when formatting changes despite identical plain text", () => {
    expect(hashDraftContent("Subject", doc("Listen here"))).not.toBe(hashDraftContent("Subject", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Listen here", marks: [{ type: "bold" }] }] }],
    }));
  });

  test("converts an over-limit legacy draft document on read without applying the write limit", () => {
    const body = "x".repeat(10_001);
    const row = toDraft({
      id: "legacy-draft",
      org_id: ORG,
      campaign_id: CAMPAIGN,
      lead_id: LEAD,
      enrichment_run_id: null,
      scope: "focused",
      version: 1,
      status: "draft",
      subject: "Legacy",
      body,
      body_document: null,
      body_html: null,
      context_snapshot: {},
      approval_hash: null,
      approved_by: null,
      approved_at: null,
      created_at: NOW,
      updated_at: NOW,
    } as never);

    expect(row.body).toBe(body);
    expect(row.body_document).toMatchObject({ type: "doc" });
    expect(row.body_html).toContain("<p>");
  });

  test("never newly approves a readable legacy draft over the 10,000-character write limit", async () => {
    harness.state.drafts.push(draft({ body: "x".repeat(10_001), body_document: null }));

    await expect(approveDraft(ORG, "draft-1", USER, harness.dependencies)).rejects.toThrow("Draft body must be repaired before approval");
    expect(harness.state.drafts[0]).toMatchObject({ status: "draft", approval_hash: null });
  });

  test("never approves a read-projected malformed document before an explicit repaired version exists", async () => {
    harness.state.drafts.push({ ...draft(), body_document_repair_required: true, body_document_repair_reason: "malformed" });

    await expect(approveDraft(ORG, "draft-1", USER, harness.dependencies)).rejects.toThrow("Draft body must be repaired before approval");
    expect(harness.state.drafts[0]).toMatchObject({ status: "draft", approval_hash: null });
  });

  test("falls back to valid legacy text and flags malformed stored rich draft JSON for repair", () => {
    const row = toDraft({
      id: "malformed-draft",
      org_id: ORG,
      campaign_id: CAMPAIGN,
      lead_id: LEAD,
      enrichment_run_id: null,
      scope: "focused",
      version: 1,
      status: "draft",
      subject: "Legacy fallback",
      body: "Readable legacy copy",
      body_document: { type: "table" },
      body_html: null,
      context_snapshot: {},
      approval_hash: null,
      approved_by: null,
      approved_at: null,
      created_at: NOW,
      updated_at: NOW,
    } as never);

    expect(row).toMatchObject({
      body: "Readable legacy copy",
      body_document: doc("Readable legacy copy"),
      body_document_repair_required: true,
    });
  });

  test("keeps a historical over-limit document readable but requires an authoring repair", () => {
    const body = "x".repeat(10_001);
    const row = toDraft({
      id: "over-limit-draft", org_id: ORG, campaign_id: CAMPAIGN, lead_id: LEAD,
      enrichment_run_id: null, scope: "focused", version: 1, status: "draft", subject: null,
      body, body_document: doc(body), body_html: null, context_snapshot: {},
      approval_hash: null, approved_by: null, approved_at: null, created_at: NOW, updated_at: NOW,
    } as never);

    expect(row).toMatchObject({ body, body_document_repair_required: true, body_document_repair_reason: "over_limit" });
  });

  test("keeps historical legacy text beyond the read editor cap visible without throwing", () => {
    const body = "x".repeat(20_001);
    expect(presentCampaignDraftBody({ body_document: { type: "table" }, body }, 20_000)).toMatchObject({
      body,
      repair_required: true,
      repair_reason: "over_limit",
      document: { type: "doc" },
    });
  });

  test("generates a leadless radio-update draft from a reviewed page without lead readiness", async () => {
    harness.state.pageRevisions.push(radioRevision());
    const provider = researchProvider();
    vi.mocked(provider.generateDraft).mockResolvedValue({ subject: "Fountain Edits for radio", body: "Shared with our independent radio network." });

    const result = await createRadioUpdateDraft(ORG, CAMPAIGN, { page_revision_id: "page-rev-1", instruction: "Keep it short." }, USER, provider, harness.dependencies);

    expect(result).toMatchObject({ lead_id: null, scope: "radio_update", version: 1 });
    expect(provider.generateDraft).toHaveBeenCalledWith(expect.objectContaining({
      recipient_name: null,
      target_name: "Independent radio network",
      channel: "email",
      suggestions: [],
      instruction: expect.stringContaining("Fountain Edits"),
    }));
    expect(harness.state.leads[0].pipeline_stage).toBe("qualified");
  });

  test("stores a manual rich radio body with derived HTML and compatibility text", async () => {
    harness.state.pageRevisions.push(radioRevision());

    const result = await createManualRadioUpdateDraft(ORG, CAMPAIGN, {
      page_revision_id: "page-rev-1",
      subject: "Fountain Edits",
      body_document: doc("Listen here"),
    }, USER, harness.dependencies);

    expect(result).toMatchObject({
      body_document: doc("Listen here"),
      body_html: "<p>Listen here</p>",
      body: "Listen here",
      status: "draft",
      scope: "radio_update",
    });
  });

  test("rejects a radio provider result when the reviewed page changes during generation", async () => {
    harness.state.pageRevisions.push(radioRevision());
    const provider = researchProvider();
    vi.mocked(provider.generateDraft).mockImplementation(async () => {
      harness.state.pageRevisions[0].content_hash = "changed";
      return { subject: "Stale", body: "Stale" };
    });

    await expect(createRadioUpdateDraft(ORG, CAMPAIGN, { page_revision_id: "page-rev-1" }, USER, provider, harness.dependencies))
      .rejects.toThrow("Radio update context changed");
    expect(harness.state.drafts).toHaveLength(0);
  });

  test("rejects a radio provider result when reviewed content changes but stored hash does not", async () => {
    harness.state.pageRevisions.push(radioRevision());
    const provider = researchProvider();
    vi.mocked(provider.generateDraft).mockImplementation(async () => {
      harness.state.pageRevisions[0].content = { ...harness.state.pageRevisions[0].content, title: "Changed after review" };
      return { subject: "Stale", body: "Stale" };
    });

    await expect(createRadioUpdateDraft(ORG, CAMPAIGN, { page_revision_id: "page-rev-1" }, USER, provider, harness.dependencies))
      .rejects.toThrow("Radio update context changed");
    expect(harness.state.drafts).toHaveLength(0);
  });

  test("rejects a radio provider result when canonical page freshness changes during generation", async () => {
    harness.state.pageRevisions.push(radioRevision());
    const provider = researchProvider();
    vi.mocked(provider.generateDraft).mockImplementation(async () => {
      harness.state.pageRevisionFresh = false;
      return { subject: "Stale", body: "Stale" };
    });

    await expect(createRadioUpdateDraft(ORG, CAMPAIGN, { page_revision_id: "page-rev-1" }, USER, provider, harness.dependencies))
      .rejects.toThrow("Radio update context changed");
    expect(harness.state.drafts).toHaveLength(0);
  });

  test("keeps internal page and source identifiers out of the provider payload", async () => {
    harness.state.pageRevisions.push(radioRevision({ source_snapshot: {
      release: { id: "release-secret", releaseDate: "2026-08-01", catalogNumber: "TN-01", tracks: [{ id: "track-secret", title: "Fountain", duration: 180, credits: [{ name: "Producer", role: "Producer", work_id: "work-secret" }] }] },
      artwork: { id: "art-secret", fileLink: "https://example.com/art.jpg", storage_key: "private/key" },
    }}));
    const provider = researchProvider();
    await createRadioUpdateDraft(ORG, CAMPAIGN, { page_revision_id: "page-rev-1" }, USER, provider, harness.dependencies);
    const payload = JSON.stringify(vi.mocked(provider.generateDraft).mock.calls[0]?.[0]);
    expect(payload).toContain("Fountain");
    expect(payload).not.toContain("release-secret");
    expect(payload).not.toContain("track-secret");
    expect(payload).not.toContain("art-secret");
    expect(payload).not.toContain("storage_key");
  });

  test("approves a leadless radio draft while preserving lead stage", async () => {
    harness.state.pageRevisions.push(radioRevision());
    harness.state.drafts.push(draft({ id: "radio-draft", lead_id: null, scope: "radio_update", context_snapshot: {
      page_revision_id: "page-rev-1", page_revision_version: 1, page_content_hash: radioContentHash(), prompt_id: "prompt-1", prompt_version: 1,
    }}));

    const result = await approveDraft(ORG, "radio-draft", USER, harness.dependencies);

    expect(result).toMatchObject({ id: "radio-draft", scope: "radio_update" });
    expect(harness.state.drafts[0]).toMatchObject({ status: "approved", approved_by: USER });
    expect(harness.state.leads[0].pipeline_stage).toBe("qualified");
  });

  test("allows radio approval when the captured campaign prompt was absent", async () => {
    harness.state.prompts = [];
    harness.state.pageRevisions.push(radioRevision());
    harness.state.drafts.push(draft({ id: "radio-draft", lead_id: null, scope: "radio_update", context_snapshot: {
      page_revision_id: "page-rev-1", page_revision_version: 1, page_content_hash: radioContentHash(), prompt_id: null, prompt_version: null,
    }}));

    await expect(approveDraft(ORG, "radio-draft", USER, harness.dependencies)).resolves.toMatchObject({ scope: "radio_update" });
  });

  test("supersedes leadless radio drafts when the campaign prompt is saved", async () => {
    harness.state.pageRevisions.push(radioRevision());
    harness.state.drafts.push(draft({ id: "radio-draft", lead_id: null, scope: "radio_update", context_snapshot: {
      page_revision_id: "page-rev-1", page_revision_version: 1, page_content_hash: radioContentHash(), prompt_id: "prompt-1", prompt_version: 1,
    }}));

    await saveCommunicatorPrompt(ORG, CAMPAIGN, "New voice", USER, harness.dependencies);

    expect(harness.state.drafts[0].status).toBe("superseded");
  });

  test("rejects radio manual continuation after the campaign prompt changes", async () => {
    harness.state.pageRevisions.push(radioRevision());
    harness.state.drafts.push(draft({ id: "radio-draft", lead_id: null, scope: "radio_update", context_snapshot: {
      page_revision_id: "page-rev-1", page_revision_version: 1, page_content_hash: radioContentHash(), prompt_id: "prompt-1", prompt_version: 1,
    }}));
    harness.state.prompts.push({ ...harness.state.prompts[0], id: "prompt-2", version: 2, prompt: "New voice" });

    await expect(createManualDraftVersion(ORG, "radio-draft", { subject: "Subject", body: "Body" }, USER, harness.dependencies))
      .rejects.toThrow("Radio update context changed");
  });

  test("rejects radio approval when canonical page freshness is stale", async () => {
    harness.state.pageRevisions.push(radioRevision());
    harness.state.drafts.push(draft({ id: "radio-draft", lead_id: null, scope: "radio_update", context_snapshot: {
      page_revision_id: "page-rev-1", page_revision_version: 1, page_content_hash: radioContentHash(), prompt_id: "prompt-1", prompt_version: 1,
    }}));
    harness.state.pageRevisionFresh = false;

    await expect(approveDraft(ORG, "radio-draft", USER, harness.dependencies)).rejects.toThrow("Reviewed radio page revision changed");
    expect(harness.state.drafts[0].status).toBe("draft");
  });

  test.each([
    ["lead", (state: ReturnType<typeof createHarness>["state"]) => {
      state.leads[0].updated_at = new Date("2026-08-04T09:30:00.000Z");
    }],
    ["prompt", (state: ReturnType<typeof createHarness>["state"]) => {
      state.prompts.push({ ...state.prompts[0], id: "prompt-2", version: 2, prompt: "New prompt" });
    }],
    ["accepted facts", (state: ReturnType<typeof createHarness>["state"]) => {
      state.suggestions[0].status = "rejected";
    }],
  ] as const)("rejects a generated draft when %s changes during the provider call", async (_boundary, mutate) => {
    harness.state.suggestions.push(suggestion({ status: "accepted" }));
    const provider = researchProvider();
    vi.mocked(provider.generateDraft).mockImplementation(async () => {
      mutate(harness.state);
      return { subject: "Stale subject", body: "Stale body" };
    });

    await expect(createGeneratedDraft(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      instruction: null,
    }, USER, provider, harness.dependencies)).rejects.toThrow("Communicator context changed; regenerate the draft");

    expect(harness.state.drafts).toHaveLength(0);
  });

  test("supports the operator preparation workflow with server-stamped verification and waiver", async () => {
    harness.state.leads[0].contact_route = null;
    harness.state.leads[0].contact_route_verified_at = null;
    harness.state.tasks.length = 0;
    await updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      contact_route: " editor@example.com ",
    }, USER, harness.dependencies);
    expect(harness.state.leads[0]).toMatchObject({ contact_route: "editor@example.com", contact_route_verified_at: null });

    await updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      contact_route_verified: true,
    }, USER, harness.dependencies);
    expect(harness.state.leads[0].contact_route_verified_at).toEqual(NOW);

    await updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      readiness_task_waiver_reason: "Operator is handling this lead directly",
    }, USER, harness.dependencies);
    harness.state.drafts.push(draft());
    await expect(approveDraft(ORG, "draft-1", USER, harness.dependencies)).resolves.toMatchObject({ pipeline_stage: "ready" });
  });

  test("supports the allowlisted preparation fields and rejects a stale loaded revision", async () => {
    const result = await updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      expected_updated_at: "2026-08-04T09:00:00.000Z",
      exact_edit_track_id: "track-2",
      recommending_person: "A trusted editor",
      introduction_available: true,
      musical_fit: "Warm leftfield fit",
      pitch_angle: "A focused premiere angle",
    }, USER, harness.dependencies);
    expect(result).toMatchObject({ exact_edit_track_id: "track-2", recommending_person: "A trusted editor", introduction_available: true, musical_fit: "Warm leftfield fit", pitch_angle: "A focused premiere angle" });
    harness.state.leads[0].updated_at = new Date("2026-08-04T11:00:00.000Z");
    await expect(updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      expected_updated_at: "2026-08-04T09:00:00.000Z",
      musical_fit: "Stale update",
    }, USER, harness.dependencies)).rejects.toThrow("Campaign lead changed while updating preparation");
  });

  test("exposes a strict preparation schema that never accepts a client verification timestamp", () => {
    expect(updateLeadPreparationSchema.safeParse({
      campaign_id: CAMPAIGN,
      contact_route_verified_at: "2026-08-04T10:00:00.000Z",
    }).success).toBe(false);
    expect(updateLeadPreparationSchema.safeParse({
      campaign_id: CAMPAIGN,
      contact_route_verified: true,
    }).success).toBe(true);
  });

  test("clears server verification when the operator changes the contact route", async () => {
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "approved-content", approved_by: USER, approved_at: NOW }));
    harness.state.leads[0].pipeline_stage = "ready";
    await updateLeadPreparation(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      contact_route: "new-editor@example.com",
    }, USER, harness.dependencies);

    expect(harness.state.leads[0]).toMatchObject({
      contact_route: "new-editor@example.com",
      contact_route_verified_at: null,
      pipeline_stage: "qualified",
    });
    expect(harness.state.drafts[0].status).toBe("superseded");
  });

  test("rejects recording a send after readiness becomes stale", async () => {
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "approved-content", approved_by: USER, approved_at: NOW }));
    harness.state.leads[0].pipeline_stage = "ready";
    harness.state.leads[0].contact_route_verified_at = null;

    await expect(recordExternalSend(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      approved_draft_id: "draft-1",
      channel: "email",
      sent_at: "2026-08-04T10:00:00.000Z",
    }, USER, harness.dependencies)).rejects.toThrow("Lead is no longer ready");

    expect(harness.state.leads[0].pipeline_stage).toBe("ready");
    expect(harness.state.events).toHaveLength(0);
  });

  test("rejects approval when lead preparation is incomplete", async () => {
    harness.state.leads[0].contact_route = null;
    harness.state.drafts.push(draft());

    await expect(approveDraft(ORG, "draft-1", USER, harness.dependencies))
      .rejects.toThrow("Lead preparation is incomplete");

    expect(harness.state.drafts[0].status).toBe("draft");
    expect(harness.state.leads[0].pipeline_stage).toBe("qualified");
  });

  test("stores a normalized SHA-256 approval hash and promotes the prepared lead", async () => {
    harness.state.drafts.push(draft({
      subject: "  Fountain for Night Radio\r\n",
      body: "Hello Editor,\r\n\r\nHere is the Fountain edit.  ",
      body_document: doc("Hello Editor,\n\nHere is the Fountain edit."),
      body_html: "<p>Hello Editor,<br><br>Here is the Fountain edit.</p>",
    }));

    const result = await approveDraft(ORG, "draft-1", USER, harness.dependencies);
    const expectedHash = createHash("sha256").update(JSON.stringify({
      subject: "Fountain for Night Radio",
      body_document: doc("Hello Editor,\n\nHere is the Fountain edit."),
    })).digest("hex");

    expect(result).toMatchObject({ pipeline_stage: "ready", approval_hash: expectedHash });
    expect(harness.state.drafts[0]).toMatchObject({ status: "approved", approval_hash: expectedHash, approved_by: USER });
    expect(harness.state.leads[0].pipeline_stage).toBe("ready");
  });

  test("approves only the loaded draft and lead revisions for the native path", async () => {
    harness.state.drafts.push(draft());

    const result = await approveDraft(ORG, "draft-1", USER, harness.dependencies, {
      expectedDraftUpdatedAt: NOW.toISOString(),
      expectedLeadUpdatedAt: "2026-08-04T09:00:00.000Z",
      expectedLeadId: LEAD,
    });

    expect(result).toMatchObject({ id: "draft-1", pipeline_stage: "ready" });
    expect(harness.state.drafts[0]).toMatchObject({ status: "approved", approved_by: USER });
    expect(harness.state.leads[0].pipeline_stage).toBe("ready");
    expect(harness.state.events.at(-1)).toMatchObject({ event_type: "draft_approved", actor_user_id: USER, draft_id: "draft-1", lead_id: LEAD });
  });

  test("rejects a stale native approval revision without approving or recording activity", async () => {
    harness.state.drafts.push(draft({ updated_at: new Date("2026-08-16T10:00:00.000Z") }));

    await expect(approveDraft(ORG, "draft-1", USER, harness.dependencies, {
      expectedDraftUpdatedAt: "2026-08-16T09:00:00.000Z",
      expectedLeadUpdatedAt: NOW.toISOString(),
      expectedLeadId: LEAD,
    })).rejects.toThrow("Draft changed while approving it");

    expect(harness.state.drafts[0].status).toBe("draft");
    expect(harness.state.leads[0].pipeline_stage).toBe("qualified");
    expect(harness.state.events).toHaveLength(0);
  });

  test("restores manual edits as a new version while preserving the source version", async () => {
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "approved-content", approved_by: USER, approved_at: NOW }));

    const result = await createManualDraftVersion(ORG, "draft-1", {
      subject: "Revised subject",
      body: "Revised body",
    }, USER, harness.dependencies);

    expect(result).toMatchObject({ version: 2, status: "draft", subject: "Revised subject", body: "Revised body" });
    expect(harness.state.drafts[0]).toMatchObject({ version: 1, approval_hash: "approved-content", approved_by: USER });
    expect(harness.state.drafts).toHaveLength(2);
  });

  test("saves a plain draft only when its loaded revision is current", async () => {
    harness.state.drafts.push(draft({ body_document: null, body_html: null }));

    const result = await createManualDraftVersion(ORG, "draft-1", {
      subject: "Updated subject",
      body: "Updated body",
    }, USER, harness.dependencies, {
      expectedUpdatedAt: NOW.toISOString(),
      expectedLeadId: LEAD,
      plainOnly: true,
    });

    expect(result).toMatchObject({ version: 2, status: "draft", subject: "Updated subject", body: "Updated body", body_document: null });
    expect(harness.state.drafts[0].status).toBe("superseded");
  });

  test("rejects stale plain draft revisions without creating a version", async () => {
    harness.state.drafts.push(draft({ body_document: null, body_html: null }));

    await expect(createManualDraftVersion(ORG, "draft-1", {
      subject: "Updated subject",
      body: "Updated body",
    }, USER, harness.dependencies, {
      expectedUpdatedAt: "2026-08-04T08:59:59.000Z",
      expectedLeadId: LEAD,
      plainOnly: true,
    })).rejects.toThrow("Draft changed while editing; reload the draft");

    expect(harness.state.drafts).toHaveLength(1);
    expect(harness.state.drafts[0].status).toBe("draft");
  });

  test("keeps rich drafts read-only for the native path", async () => {
    harness.state.drafts.push(draft());

    await expect(createManualDraftVersion(ORG, "draft-1", {
      subject: "Updated subject",
      body: "Flattened body",
    }, USER, harness.dependencies, {
      expectedUpdatedAt: NOW.toISOString(),
      expectedLeadId: LEAD,
      plainOnly: true,
    })).rejects.toThrow("Rich drafts are read-only in native editing");

    expect(harness.state.drafts).toHaveLength(1);
    expect(harness.state.drafts[0].body_document).toEqual(doc("Hello Editor,\n\nHere is the Fountain edit."));
  });

  test("rejects restoring a draft whose lead belongs to another campaign", async () => {
    harness.state.drafts.push(draft({ campaign_id: "other-campaign" }));

    await expect(createManualDraftVersion(ORG, "draft-1", {
      subject: "Revised subject",
      body: "Revised body",
    }, USER, harness.dependencies)).rejects.toThrow("Campaign lead not found");

    expect(harness.state.drafts).toHaveLength(1);
  });

  test("records an approved external send and its suggested follow-up atomically", async () => {
    harness.state.drafts.push(draft({ status: "approved", approval_hash: "approved-content", approved_by: USER, approved_at: NOW }));
    harness.state.leads[0].pipeline_stage = "ready";

    const result = await recordExternalSend(ORG, LEAD, {
      campaign_id: CAMPAIGN,
      approved_draft_id: "draft-1",
      channel: "email",
      sent_at: "2026-08-04T10:00:00.000Z",
      destination: "editor@example.com",
    }, USER, harness.dependencies);

    expect(result.pipeline_stage).toBe("sent");
    expect(result.follow_up_at?.toISOString()).toBe("2026-08-18T10:00:00.000Z");
    expect(harness.state.leads[0]).toMatchObject({ pipeline_stage: "sent", last_contacted_at: NOW });
    expect(harness.state.events.at(-1)).toMatchObject({
      event_type: "external_send_recorded",
      draft_id: "draft-1",
      details: { channel: "email", destination: "editor@example.com" },
    });
  });

  test("always writes a reason-bearing stage override event", async () => {
    const result = await overrideLeadStage(
      ORG, LEAD, CAMPAIGN, "nurture", "Target requested no further pitches", USER, harness.dependencies,
    );

    expect(result.event_type).toBe("stage_overridden");
    expect(harness.state.leads[0].pipeline_stage).toBe("nurture");
    expect(harness.state.events.at(-1)).toMatchObject({
      event_type: "stage_overridden",
      details: { from_stage: "qualified", to_stage: "nurture", reason: "Target requested no further pitches" },
    });
  });

  test("rejects a stage override when the asserted campaign does not own the lead", async () => {
    await expect(overrideLeadStage(
      ORG, LEAD, "campaign-other", "nurture", "Target requested no further pitches", USER, harness.dependencies,
    )).rejects.toThrow("Campaign lead not found");

    expect(harness.state.leads[0].pipeline_stage).toBe("qualified");
    expect(harness.state.events).toHaveLength(0);
  });
});

function event(overrides: Partial<CampaignCommunicatorEvent> = {}): CampaignCommunicatorEvent {
  return {
    id: "event-1",
    org_id: ORG,
    campaign_id: CAMPAIGN,
    lead_id: LEAD,
    draft_id: null,
    event_type: "test",
    actor_user_id: USER,
    occurred_at: NOW,
    details: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function radioRevision(overrides: Partial<CampaignRadioPageRevision> = {}): CampaignRadioPageRevision {
  return {
    id: "page-rev-1",
    org_id: ORG,
    campaign_id: CAMPAIGN,
    page_id: "page-1",
    version: 1,
    review_status: "reviewed",
    content_hash: radioContentHash(),
    content: {
      label_line: "True Nature",
      title: "Fountain Edits",
      release_note: "A concise note.",
      artwork_asset_id: "art-1",
      focus_track_ids: ["track-1"],
      listen_url: "https://example.com/listen",
      download_url: null,
      metadata_url: null,
      contact_name: "Label desk",
      contact_email: "radio@example.com",
      network_statement: "Shared with our independent radio network.",
    },
    source_snapshot: {
      release: { releaseDate: "2026-08-01", catalogNumber: "TN-01", tracks: [{ title: "Fountain", duration: 180, credits: [] }] },
      artwork: { fileLink: "https://example.com/art.jpg" },
    },
    ...overrides,
  };
}

function radioContentHash() {
  const content = {
    artwork_asset_id: "art-1",
    contact_email: "radio@example.com",
    contact_name: "Label desk",
    download_url: null,
    focus_track_ids: ["track-1"],
    label_line: "True Nature",
    listen_url: "https://example.com/listen",
    metadata_url: null,
    network_statement: "Shared with our independent radio network.",
    release_note: "A concise note.",
    title: "Fountain Edits",
  };
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value;
  return createHash("sha256").update(JSON.stringify(sort(content))).digest("hex");
}

function researchProvider(): CampaignCommunicatorProvider {
  return {
    id: "test",
    model: "test-model",
    researchLead: vi.fn(async () => ({ suggestions: [] })),
    generateDraft: vi.fn(async () => ({ subject: "Subject", body: "Body" })),
  };
}
