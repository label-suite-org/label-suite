import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalToolError } from "./local-tools-api";

const auth = vi.hoisted(() => ({ runAuthenticatedLocalToolRequest: vi.fn() }));
const audit = vi.hoisted(() => ({ recordLocalToolOperation: vi.fn().mockResolvedValue(undefined) }));
const service = vi.hoisted(() => ({
  claimCampaignEnrichmentItem: vi.fn(),
  getCampaignEnrichmentItem: vi.fn(),
  listCampaignEnrichmentQueue: vi.fn(),
  releaseCampaignEnrichmentItem: vi.fn(),
  submitCampaignEnrichmentProposal: vi.fn(),
}));

vi.mock("./local-tool-tokens", async () => ({
  ...await vi.importActual<typeof import("./local-tool-tokens")>("./local-tool-tokens"),
  ...auth,
}));

vi.mock("./local-tool-audit", async () => ({
  ...await vi.importActual<typeof import("./local-tool-audit")>("./local-tool-audit"),
  ...audit,
}));

vi.mock("./campaign-enrichment-local-tools", async () => ({
  ...await vi.importActual<typeof import("./campaign-enrichment-local-tools")>("./campaign-enrichment-local-tools"),
  ...service,
}));

const principal = {
  tokenId: "token-a",
  orgId: "org-a",
  userId: "user-a",
  scopes: ["campaign.enrichment.read"] as const,
};
const revision = "a".repeat(64);
const submission = {
  claim_id: "claim-1",
  expected_lead_revision: revision,
  idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
  proposals: [{
    field: "musical_fit",
    value: "Warm, leftfield club music",
    rationale: "Recent programming includes compatible artists.",
    evidence: [{
      title: "Night Radio archive",
      url: "https://example.com/night-radio/archive",
      retrieved_at: "2026-08-10T11:00:00.000Z",
      citation_text: "Recent programming includes leftfield club music.",
    }],
  }],
  client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
};

describe("executeCampaignEnrichmentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.runAuthenticatedLocalToolRequest.mockImplementation(
      async (_request, _scope, operation) => operation(principal),
    );
    service.listCampaignEnrichmentQueue.mockResolvedValue({ items: [], next_cursor: null });
    service.getCampaignEnrichmentItem.mockResolvedValue({
      item_id: "lead-1",
      campaign_id: "campaign-1",
      lead_id: "lead-1",
    });
    service.claimCampaignEnrichmentItem.mockResolvedValue({
      id: "claim-1",
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      claimed_at: new Date("2026-08-10T12:00:00.000Z"),
      renewed_at: null,
      expires_at: new Date("2026-08-10T12:20:00.000Z"),
      result_category: "claimed",
    });
    service.releaseCampaignEnrichmentItem.mockResolvedValue({
      released: true,
      result_category: "release_noop",
    });
    service.submitCampaignEnrichmentProposal.mockResolvedValue({
      created: true,
      run_id: "run-1",
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
    });
  });

  it("executes a queue read through the authenticated, audited domain interface", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/queue?limit=20");

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "list_queue",
      searchParams: new URL(request.url).searchParams,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [], next_cursor: null },
    });
    expect(auth.runAuthenticatedLocalToolRequest).toHaveBeenCalledWith(
      request,
      "campaign.enrichment.read",
      expect.any(Function),
      undefined,
      expect.objectContaining({ tool: "list_enrichment_queue" }),
    );
    expect(service.listCampaignEnrichmentQueue).toHaveBeenCalledWith(principal, {
      state: "all",
      limit: 20,
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: "token-a",
      orgId: "org-a",
      userId: "user-a",
      tool: "list_enrichment_queue",
      operation: "queue_list",
      resultCategory: "listed",
      proposalCount: 0,
    }));
  });

  it("gets one tenant-scoped item and audits its resolved campaign and lead", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1");

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "get_item",
      itemId: "lead-1",
    });

    expect(response.status).toBe(200);
    expect(service.getCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1");
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "get_enrichment_item",
      operation: "item_get",
      campaignId: "campaign-1",
      leadId: "lead-1",
      resultCategory: "found",
    }));
  });

  it("claims an item from a bounded body and returns only the safe lease", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_lead_revision: revision, lease_minutes: 20 }),
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "claim_item",
      itemId: "lead-1",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "claim-1",
        lead_id: "lead-1",
        claimed_at: "2026-08-10T12:00:00.000Z",
        renewed_at: null,
        expires_at: "2026-08-10T12:20:00.000Z",
      },
    });
    expect(service.claimCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1", {
      expected_lead_revision: revision,
      lease_minutes: 20,
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "claim_enrichment_item",
      operation: "claim",
      campaignId: "campaign-1",
      leadId: "lead-1",
      resultCategory: "claimed",
    }));
  });

  it("releases a claim idempotently through the claim-scoped operation", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim/claim-1", {
      method: "DELETE",
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "release_item",
      itemId: "lead-1",
      claimId: "claim-1",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { released: true } });
    expect(service.releaseCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1", "claim-1");
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "release_enrichment_item",
      operation: "release",
      leadId: "lead-1",
      resultCategory: "release_noop",
    }));
  });

  it("submits cited proposals while returning and auditing only allowlisted data", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "submit_proposal",
      itemId: "lead-1",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run_id: "run-1",
        suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
      },
    });
    expect(service.submitCampaignEnrichmentProposal).toHaveBeenCalledWith(principal, "lead-1", submission);
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "submit_enrichment_proposal",
      operation: "proposal_submit",
      campaignId: "campaign-1",
      leadId: "lead-1",
      resultCategory: "submitted",
      proposalCount: 1,
    }));
    expect(JSON.stringify(audit.recordLocalToolOperation.mock.calls)).not.toMatch(
      /Warm, leftfield|Recent programming|citation_text|Night Radio/i,
    );
  });

  it("keeps a successful operation response when the audit recorder fails", async () => {
    audit.recordLocalToolOperation.mockRejectedValueOnce(new Error("audit unavailable"));
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/queue");

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "list_queue",
      searchParams: new URL(request.url).searchParams,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { items: [] } });
  });

  it("returns authentication errors before parsing an operation payload", async () => {
    auth.runAuthenticatedLocalToolRequest.mockRejectedValueOnce(new LocalToolError("scope_forbidden"));
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "claim_item",
      itemId: "lead-1",
    });

    expect(response.status).toBe(403);
    expect(service.claimCampaignEnrichmentItem).not.toHaveBeenCalled();
    expect(audit.recordLocalToolOperation).not.toHaveBeenCalled();
  });

  it("audits validation failures against the requested operation", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "claim_item",
      itemId: "lead-1",
    });

    expect(response.status).toBe(400);
    expect(service.claimCampaignEnrichmentItem).not.toHaveBeenCalled();
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: "claim",
      leadId: "lead-1",
      resultCategory: "invalid_request",
    }));
  });

  it("keeps cross-tenant not-found failures inside the fixed domain envelope", async () => {
    service.getCampaignEnrichmentItem.mockRejectedValueOnce(new LocalToolError("not_found"));
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/other-org-lead");

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "get_item",
      itemId: "other-org-lead",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Resource not found", retryable: false },
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: "item_get",
      leadId: "other-org-lead",
      resultCategory: "not_found",
    }));
  });

  it("rejects canonical-record decisions at the proposal-only interface", async () => {
    const { executeCampaignEnrichmentTool } = await import("./campaign-enrichment-tool-execution");
    const request = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...submission, accepted: true }),
    });

    const response = await executeCampaignEnrichmentTool(request, {
      kind: "submit_proposal",
      itemId: "lead-1",
    });

    expect(response.status).toBe(400);
    expect(service.submitCampaignEnrichmentProposal).not.toHaveBeenCalled();
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: "proposal_submit",
      leadId: "lead-1",
      resultCategory: "invalid_request",
      proposalCount: 0,
    }));
  });
});
