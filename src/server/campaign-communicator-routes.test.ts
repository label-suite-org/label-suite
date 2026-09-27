import type { APIRoute } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";

const communicator = vi.hoisted(() => ({
  approveDraft: vi.fn(),
  createGeneratedDraft: vi.fn(),
  createRadioUpdateDraft: vi.fn(),
  createManualDraftVersion: vi.fn(),
  createManualRadioUpdateDraft: vi.fn(),
  decideSuggestion: vi.fn(),
  getCommunicatorContext: vi.fn(),
  overrideLeadStage: vi.fn(),
  recordExternalSend: vi.fn(),
  runLeadResearch: vi.fn(),
  saveCommunicatorPrompt: vi.fn(),
  updateLeadPreparation: vi.fn(),
}));

const provider = vi.hoisted(() => ({
  instance: {
    id: "test" as const,
    model: "test-model",
    researchLead: vi.fn(),
    generateDraft: vi.fn(),
  },
  getCampaignCommunicatorProvider: vi.fn(),
}));

const delivery = vi.hoisted(() => ({
  sendEmailThroughCampaignProvider: vi.fn(),
}));

const campaignOutreach = vi.hoisted(() => ({
  updateCampaignLead: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireCapability: (
    locals: { orgId?: string; membershipRole?: string },
    capability: string,
  ) => {
    if (capability !== "operations.mutate") {
      throw new Error(`Unexpected capability: ${capability}`);
    }
    if (locals.membershipRole === "owner" || locals.membershipRole === "operator") {
      if (!locals.orgId) throw new HttpError("Active workspace is required", 401);
      return locals.orgId;
    }
    throw new HttpError("Insufficient permissions", 403);
  },
}));

vi.mock("./campaign-communicator", async () => {
  const { z } = await import("zod");
  return {
    ...communicator,
    updateLeadPreparationSchema: z.object({
      campaign_id: z.string().min(1),
      contact_route: z.string().trim().min(1).max(500).nullable().optional(),
      contact_route_verified: z.boolean().optional(),
      readiness_task_waiver_reason: z.string().trim().min(10).max(1000).nullable().optional(),
    }).strict().refine((value) => (
      value.contact_route !== undefined
      || value.contact_route_verified !== undefined
      || value.readiness_task_waiver_reason !== undefined
    ), { message: "At least one preparation field must be updated" }),
  };
});

vi.mock("./campaign-communicator-provider", () => ({
  getCampaignCommunicatorProvider: provider.getCampaignCommunicatorProvider,
}));

vi.mock("./email", () => delivery);

vi.mock("./campaign-outreach", async () => {
  const core = await import("./campaign-outreach-core");
  return {
    createCampaignLead: vi.fn(),
    createCampaignLeadSchema: core.createCampaignLeadSchema,
    updateCampaignLead: campaignOutreach.updateCampaignLead,
    updateCampaignLeadSchema: core.updateCampaignLeadSchema,
  };
});

type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH", APIRoute>>;

const routeLoaders = {
  prompt: () => import("../pages/api/campaigns/[id]/communicator-prompt"),
  research: () => import("../pages/api/campaign-leads/[id]/enrichment-runs"),
  suggestion: () => import("../pages/api/campaign-enrichment-suggestions/[id]"),
  generateDraft: () => import("../pages/api/campaign-leads/[id]/drafts"),
  radioDraft: () => import("../pages/api/campaigns/[id]/radio-update-drafts"),
  manualDraft: () => import("../pages/api/campaign-outreach-drafts/[id]"),
  manualRadioDraft: () => import("../pages/api/campaigns/[id]/radio-update-drafts/manual"),
  approveDraft: () => import("../pages/api/campaign-outreach-drafts/[id]/approve"),
  recordSent: () => import("../pages/api/campaign-leads/[id]/record-sent"),
  stageOverride: () => import("../pages/api/campaign-leads/[id]/stage-override"),
  preparation: () => import("../pages/api/campaign-leads/[id]/preparation"),
} satisfies Record<string, () => Promise<RouteModule>>;

type MutationCase = {
  label: string;
  load: () => Promise<RouteModule>;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  pathId: string;
  validBody: Record<string, unknown>;
  invalidBody: Record<string, unknown>;
  service: ReturnType<typeof vi.fn>;
};

const mutationCases: MutationCase[] = [
  {
    label: "communicator prompt",
    load: routeLoaders.prompt,
    method: "PUT",
    path: "/api/campaigns/campaign-path/communicator-prompt",
    pathId: "campaign-path",
    validBody: { prompt: "Keep it specific and human." },
    invalidBody: { prompt: "" },
    service: communicator.saveCommunicatorPrompt,
  },
  {
    label: "research run",
    load: routeLoaders.research,
    method: "POST",
    path: "/api/campaign-leads/lead-path/enrichment-runs",
    pathId: "lead-path",
    validBody: {},
    invalidBody: { provider: "caller-provider" },
    service: communicator.runLeadResearch,
  },
  {
    label: "suggestion decision",
    load: routeLoaders.suggestion,
    method: "PATCH",
    path: "/api/campaign-enrichment-suggestions/suggestion-path",
    pathId: "suggestion-path",
    validBody: { decision: "accepted", expected_lead_updated_at: "2026-08-05T08:00:00.000Z" },
    invalidBody: { decision: "maybe", expected_lead_updated_at: "2026-08-05T08:00:00.000Z" },
    service: communicator.decideSuggestion,
  },
  {
    label: "generated draft",
    load: routeLoaders.generateDraft,
    method: "POST",
    path: "/api/campaign-leads/lead-path/drafts",
    pathId: "lead-path",
    validBody: { campaign_id: "campaign-related", instruction: "Mention the exact edit." },
    invalidBody: { instruction: "Missing relationship identity" },
    service: communicator.createGeneratedDraft,
  },
  {
    label: "manual draft version",
    load: routeLoaders.manualDraft,
    method: "PATCH",
    path: "/api/campaign-outreach-drafts/draft-path",
    pathId: "draft-path",
    validBody: {
      subject: "A precise subject",
      body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A reviewed, manually edited body." }] }] },
    },
    invalidBody: { subject: "Empty body" },
    service: communicator.createManualDraftVersion,
  },
  {
    label: "draft approval",
    load: routeLoaders.approveDraft,
    method: "POST",
    path: "/api/campaign-outreach-drafts/draft-path/approve",
    pathId: "draft-path",
    validBody: {},
    invalidBody: { approved_by: "caller-actor" },
    service: communicator.approveDraft,
  },
  {
    label: "external send record",
    load: routeLoaders.recordSent,
    method: "POST",
    path: "/api/campaign-leads/lead-path/record-sent",
    pathId: "lead-path",
    validBody: {
      campaign_id: "campaign-related",
      approved_draft_id: "approved-draft",
      channel: "email",
      sent_at: "2026-08-05T08:00:00.000Z",
      destination: "editor@example.com",
    },
    invalidBody: {
      campaign_id: "campaign-related",
      approved_draft_id: "approved-draft",
      channel: "email",
      sent_at: "not-a-date",
    },
    service: communicator.recordExternalSend,
  },
  {
    label: "stage override",
    load: routeLoaders.stageOverride,
    method: "POST",
    path: "/api/campaign-leads/lead-path/stage-override",
    pathId: "lead-path",
    validBody: {
      campaign_id: "campaign-related",
      pipeline_stage: "qualified",
      reason: "Manual correction after source review",
    },
    invalidBody: {
      campaign_id: "campaign-related",
      pipeline_stage: "qualified",
      reason: "short",
    },
    service: communicator.overrideLeadStage,
  },
  {
    label: "lead preparation",
    load: routeLoaders.preparation,
    method: "PATCH",
    path: "/api/campaign-leads/lead-path/preparation",
    pathId: "lead-path",
    validBody: {
      campaign_id: "campaign-related",
      contact_route: "editor@example.com",
      contact_route_verified: false,
      readiness_task_waiver_reason: "No task is required for this direct route",
    },
    invalidBody: { campaign_id: "campaign-related" },
    service: communicator.updateLeadPreparation,
  },
];

function request(path: string, method: string, body: unknown) {
  return new Request(`https://labels.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callMutation(
  route: MutationCase,
  body: unknown = route.validBody,
  locals: Record<string, unknown> = {
    orgId: "org-tenant",
    membershipRole: "operator",
    user: { id: "actor-session" },
  },
) {
  const module = await route.load();
  const handler = module[route.method];
  expect(handler, `${route.label} must export ${route.method}`).toBeTypeOf("function");
  const routeRequest = request(route.path, route.method, body);
  return handler!({
    request: routeRequest,
    url: new URL(routeRequest.url),
    params: { id: route.pathId },
    locals,
  } as never);
}

describe("campaign communicator routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.getCampaignCommunicatorProvider.mockReturnValue(provider.instance);
    for (const route of mutationCases) route.service.mockResolvedValue({ ok: true });
    communicator.getCommunicatorContext.mockResolvedValue({ prompt: null, leads: {} });
    campaignOutreach.updateCampaignLead.mockResolvedValue({ id: "lead-1" });
  });

  it.each(mutationCases)("denies unauthenticated and read-only access to $label", async (route) => {
    const unauthenticated = await callMutation(route, route.validBody, {});
    const readOnly = await callMutation(route, route.validBody, {
      orgId: "org-tenant",
      membershipRole: "member",
      user: { id: "member-session" },
    });

    expect(unauthenticated.status).toBe(403);
    expect(readOnly.status).toBe(403);
    expect(route.service).not.toHaveBeenCalled();
  });

  it.each(mutationCases)("rejects malformed input for $label", async (route) => {
    const response = await callMutation(route, route.invalidBody);

    expect(response.status).toBe(400);
    expect(route.service).not.toHaveBeenCalled();
  });

  it.each(mutationCases)("uses the path as canonical identity for $label", async (route) => {
    const response = await callMutation(route, { ...route.validBody, id: "body-spoof" });

    expect(response.status).toBe(400);
    expect(route.service).not.toHaveBeenCalled();
  });

  it("loads tenant-scoped communicator context for an operator", async () => {
    const { GET } = await routeLoaders.prompt();
    const response = await GET!({
      params: { id: "campaign-path" },
      locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);

    expect(response.status).toBe(200);
    expect(communicator.getCommunicatorContext).toHaveBeenCalledWith("org-tenant", "campaign-path");
  });

  it("passes only tenant, path campaign, prompt, and session actor when saving a prompt", async () => {
    const response = await callMutation(mutationCases[0]);

    expect(response.status).toBe(200);
    expect(communicator.saveCommunicatorPrompt).toHaveBeenCalledWith(
      "org-tenant",
      "campaign-path",
      "Keep it specific and human.",
      "actor-session",
    );
  });

  it("uses the configured server provider for research without accepting provider input", async () => {
    const response = await callMutation(mutationCases[1]);

    expect(response.status).toBe(201);
    expect(communicator.runLeadResearch).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      "actor-session",
      provider.instance,
    );
  });

  it("passes the path suggestion and session actor to the decision service", async () => {
    const response = await callMutation(mutationCases[2]);

    expect(response.status).toBe(200);
    expect(communicator.decideSuggestion).toHaveBeenCalledWith(
      "org-tenant",
      "suggestion-path",
      mutationCases[2].validBody,
      "actor-session",
    );
  });

  it("uses the configured server provider and path lead for draft generation", async () => {
    const response = await callMutation(mutationCases[3]);

    expect(response.status).toBe(201);
    expect(communicator.createGeneratedDraft).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      mutationCases[3].validBody,
      "actor-session",
      provider.instance,
    );
  });

  it("uses the campaign path and strict reviewed-page input for radio drafts", async () => {
    communicator.createRadioUpdateDraft.mockResolvedValue({ id: "radio-draft" });
    const { POST } = await routeLoaders.radioDraft();
    const response = await POST!({
      request: request("/api/campaigns/campaign-path/radio-update-drafts", "POST", { page_revision_id: "revision-1", instruction: "Keep it short" }),
      params: { id: "campaign-path" },
      locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);
    expect(response.status).toBe(201);
    expect(communicator.createRadioUpdateDraft).toHaveBeenCalledWith(
      "org-tenant", "campaign-path", { page_revision_id: "revision-1", instruction: "Keep it short" }, "actor-session", provider.instance,
    );
  });

  it("rejects radio draft body campaign spoofing and read-only actors", async () => {
    const { POST } = await routeLoaders.radioDraft();
    const spoofed = await POST!({
      request: request("/api/campaigns/campaign-path/radio-update-drafts", "POST", { campaign_id: "other", page_revision_id: "revision-1" }),
      params: { id: "campaign-path" }, locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);
    const readOnly = await POST!({
      request: request("/api/campaigns/campaign-path/radio-update-drafts", "POST", { page_revision_id: "revision-1" }),
      params: { id: "campaign-path" }, locals: { orgId: "org-tenant", membershipRole: "member", user: { id: "actor-session" } },
    } as never);
    expect(spoofed.status).toBe(400);
    expect(readOnly.status).toBe(403);
    expect(communicator.createRadioUpdateDraft).not.toHaveBeenCalled();
  });

  it("creates a manual version from the path draft and session actor", async () => {
    const response = await callMutation(mutationCases[4]);

    expect(response.status).toBe(201);
    expect(communicator.createManualDraftVersion).toHaveBeenCalledWith(
      "org-tenant",
      "draft-path",
      mutationCases[4].validBody,
      "actor-session",
    );
  });

  it("rejects malformed manual rich documents at the focused route with 400", async () => {
    const { PATCH } = await routeLoaders.manualDraft();
    const response = await PATCH!({
      request: request("/api/campaign-outreach-drafts/draft-path", "PATCH", {
        subject: "Malformed",
        body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
      }),
      params: { id: "draft-path" },
      locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);

    expect(response.status).toBe(400);
    expect(communicator.createManualDraftVersion).not.toHaveBeenCalled();
  });

  it("rejects over-limit manual rich documents at the radio route with 400", async () => {
    const { POST } = await routeLoaders.manualRadioDraft();
    const response = await POST!({
      request: request("/api/campaigns/campaign-path/radio-update-drafts/manual", "POST", {
        page_revision_id: "revision-1",
        subject: "Over limit",
        body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(10_001) }] }] },
      }),
      params: { id: "campaign-path" },
      locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);

    expect(response.status).toBe(400);
    expect(communicator.createManualRadioUpdateDraft).not.toHaveBeenCalled();
  });

  it("approves the path draft as the session actor", async () => {
    const response = await callMutation(mutationCases[5]);

    expect(response.status).toBe(200);
    expect(communicator.approveDraft).toHaveBeenCalledWith("org-tenant", "draft-path", "actor-session");
  });

  it("records an external send without invoking any delivery transport", async () => {
    const response = await callMutation(mutationCases[6]);

    expect(response.status).toBe(200);
    expect(communicator.recordExternalSend).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      mutationCases[6].validBody,
      "actor-session",
    );
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
  });

  it("uses the dedicated route for a reason-bearing stage override", async () => {
    const response = await callMutation(mutationCases[7]);

    expect(response.status).toBe(200);
    expect(communicator.overrideLeadStage).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      "campaign-related",
      "qualified",
      "Manual correction after source review",
      "actor-session",
    );
  });

  it("passes the asserted campaign to the stage-override service", async () => {
    communicator.overrideLeadStage.mockRejectedValueOnce(new HttpError("Campaign lead not found", 404));

    const response = await callMutation(mutationCases[7], {
      ...mutationCases[7].validBody,
      campaign_id: "campaign-does-not-own-lead",
    });

    expect(response.status).toBe(404);
    expect(communicator.overrideLeadStage).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      "campaign-does-not-own-lead",
      "qualified",
      "Manual correction after source review",
      "actor-session",
    );
  });

  it.each([
    { campaign_id: "campaign-related", pipeline_stage: "qualified" },
    { campaign_id: "campaign-related", pipeline_stage: "qualified", reason: "short" },
  ])("rejects a missing or short stage-override reason", async (body) => {
    const response = await callMutation(mutationCases[7], body);

    expect(response.status).toBe(400);
    expect(communicator.overrideLeadStage).not.toHaveBeenCalled();
  });

  it("updates only preparation fields for the path lead as the session actor", async () => {
    const response = await callMutation(mutationCases[8]);

    expect(response.status).toBe(200);
    expect(communicator.updateLeadPreparation).toHaveBeenCalledWith(
      "org-tenant",
      "lead-path",
      mutationCases[8].validBody,
      "actor-session",
    );
  });

  it.each([
    ["research", mutationCases[1]],
    ["draft generation", mutationCases[3]],
  ] as const)("sanitizes %s provider configuration errors", async (_label, route) => {
    provider.getCampaignCommunicatorProvider.mockImplementationOnce(() => {
      throw new Error("provider secret sk-live-do-not-return");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await callMutation(route);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("sk-live-do-not-return");
    expect(route.service).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("keeps the general lead PATCH unable to change pipeline stage", async () => {
    const { PATCH } = await import("../pages/api/campaign-leads");
    const leadRequest = request("/api/campaign-leads", "PATCH", {
      id: "lead-1",
      campaign_id: "campaign-1",
      notes: "Keep this valid update",
      pipeline_stage: "sent",
    });

    const response = await PATCH({
      request: leadRequest,
      locals: { orgId: "org-tenant", membershipRole: "operator", user: { id: "actor-session" } },
    } as never);

    expect(response.status).toBe(200);
    expect(campaignOutreach.updateCampaignLead).toHaveBeenCalledWith("org-tenant", {
      id: "lead-1",
      campaign_id: "campaign-1",
      notes: "Keep this valid update",
    });
  });
});
