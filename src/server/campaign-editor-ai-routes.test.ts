import type { APIRoute } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashCampaignEditorDocument } from "./campaign-editor-ai-core";
import { HttpError } from "./errors";

const service = vi.hoisted(() => ({
  createCampaignEditorAiRun: vi.fn(),
  decideCampaignEditorAiRun: vi.fn(),
  getCampaignEditorAiRunDependencies: vi.fn(),
}));
const provider = vi.hoisted(() => ({ getCampaignEditorAiProvider: vi.fn() }));

vi.mock("./tenant", () => ({
  requireCapability(locals: { orgId?: string; membershipRole?: string }, capability: string) {
    if (capability !== "operations.mutate") throw new Error(`Unexpected capability ${capability}`);
    if (locals.membershipRole !== "operator") throw new HttpError("Insufficient permissions", 403);
    if (!locals.orgId) throw new HttpError("Active workspace is required", 401);
    return locals.orgId;
  },
}));
vi.mock("./campaign-editor-ai", async () => {
  const actual = await vi.importActual<typeof import("./campaign-editor-ai")>("./campaign-editor-ai");
  return { ...actual, ...service };
});
vi.mock("./openrouter-campaign-editor-ai", () => provider);

const currentDocument = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Current" }] }] };
const createBody = {
  surface: "campaign_goal",
  operation: "improve",
  scope: "document",
  selection: null,
  current_document: currentDocument,
  input_document_hash: hashCampaignEditorDocument(currentDocument, "campaign_goal"),
  instruction: null,
  lead_id: null,
  draft_id: null,
  page_revision_id: null,
};

function request(path: string, body: unknown) {
  return new Request(`https://labels.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function callCreate(body: unknown = createBody, locals: Record<string, unknown> = { orgId: "org-a", membershipRole: "operator", user: { id: "user-a" } }) {
  const { POST } = await import("../pages/api/campaigns/[id]/editor-ai-runs");
  const routeRequest = request("/api/campaigns/campaign-a/editor-ai-runs", body);
  return POST!({ request: routeRequest, params: { id: "campaign-a" }, locals } as never);
}

async function callDecision(body: unknown, locals: Record<string, unknown> = { orgId: "org-a", membershipRole: "operator", user: { id: "user-a" } }) {
  const { POST } = await import("../pages/api/campaign-editor-ai-runs/[id]");
  const routeRequest = request("/api/campaign-editor-ai-runs/run-a", body);
  return POST!({ request: routeRequest, params: { id: "run-a" }, locals } as never);
}

describe("campaign editor AI run routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getCampaignEditorAiRunDependencies.mockReturnValue({ store: {}, now: () => new Date(), randomUUID: () => "run-a" });
    provider.getCampaignEditorAiProvider.mockReturnValue({ id: "test", model: "test-model", transform: vi.fn() });
    service.createCampaignEditorAiRun.mockResolvedValue({ run_id: "run-a", status: "ready" });
    service.decideCampaignEditorAiRun.mockResolvedValue({ run_id: "run-a", status: "accepted" });
  });

  it("creates a tenant-scoped proposal through the server provider with the path campaign and actor", async () => {
    const response = await callCreate();
    expect(response.status).toBe(201);
    expect(service.createCampaignEditorAiRun).toHaveBeenCalledWith("org-a", "campaign-a", "user-a", createBody, expect.objectContaining({ id: "test" }), expect.any(Object));
  });

  it("requires operations.mutate and rejects client identity spoofing before the service", async () => {
    const denied = await callCreate(createBody, { orgId: "org-a", membershipRole: "member", user: { id: "user-a" } });
    const spoofed = await callCreate({ ...createBody, campaign_id: "other" });
    expect(denied.status).toBe(403);
    expect(spoofed.status).toBe(400);
    expect(service.createCampaignEditorAiRun).not.toHaveBeenCalled();
  });

  it("records decisions only through the AI-run service and translates stale conflicts to 409", async () => {
    service.decideCampaignEditorAiRun.mockRejectedValueOnce(new HttpError("Proposal is stale", 409));
    const response = await callDecision({ decision: "accepted", current_document_hash: "a".repeat(64) });
    expect(response.status).toBe(409);
    expect(service.decideCampaignEditorAiRun).toHaveBeenCalledWith("org-a", "run-a", "user-a", { decision: "accepted", current_document_hash: "a".repeat(64) }, expect.any(Object));
  });

  it("keeps provider configuration failures safe", async () => {
    provider.getCampaignEditorAiProvider.mockImplementationOnce(() => { throw new Error("secret-key-must-not-leak"); });
    service.createCampaignEditorAiRun.mockRejectedValueOnce(Object.assign(new Error("safe disabled failure"), { category: "disabled" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await callCreate();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-key-must-not-leak");
    expect(service.createCampaignEditorAiRun).toHaveBeenCalledWith("org-a", "campaign-a", "user-a", createBody, expect.objectContaining({ id: "disabled" }), expect.any(Object));
    log.mockRestore();
  });
});

void (undefined as unknown as APIRoute);
