import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignEnrichmentProposalSubmission } from "../lib/campaign-enrichment-local-tool-contract";
import { LocalToolError } from "./local-tools-api";

const auth = vi.hoisted(() => ({
  authenticateLocalToolRequest: vi.fn(),
  runAuthenticatedLocalToolRequest: vi.fn(),
}));
const service = vi.hoisted(() => ({ submitCampaignEnrichmentProposal: vi.fn() }));
const audit = vi.hoisted(() => ({ recordLocalToolOperation: vi.fn().mockResolvedValue(undefined) }));

vi.mock("./local-tool-audit", async () => ({
  ...await vi.importActual<typeof import("./local-tool-audit")>("./local-tool-audit"),
  ...audit,
}));

vi.mock("./local-tool-tokens", async () => {
  const actual = await vi.importActual<typeof import("./local-tool-tokens")>("./local-tool-tokens");
  return { ...actual, ...auth };
});

vi.mock("./campaign-enrichment-local-tools", async () => {
  const actual = await vi.importActual<typeof import("./campaign-enrichment-local-tools")>(
    "./campaign-enrichment-local-tools",
  );
  return { ...actual, ...service };
});

const principal = {
  tokenId: "token-a",
  orgId: "org-a",
  userId: "user-a",
  scopes: ["campaign.enrichment.propose"] as const,
};
const submission: CampaignEnrichmentProposalSubmission = {
  claim_id: "claim-1",
  expected_lead_revision: "a".repeat(64),
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
const safeResult = {
  created: true,
  run_id: "run-1",
  campaign_id: "campaign-1",
  lead_id: "lead-1",
  suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" as const }],
};

function request(body: unknown = submission) {
  return new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("campaign enrichment local-tool proposal route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.authenticateLocalToolRequest.mockResolvedValue(principal);
    auth.runAuthenticatedLocalToolRequest.mockImplementation(
      async (_request, _scope, operation) => operation(principal),
    );
    service.submitCampaignEnrichmentProposal.mockResolvedValue(safeResult);
  });

  it("authenticates the exact propose scope and returns 201 with an allowlisted result", async () => {
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request(), params: { id: "lead-1" } } as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(auth.runAuthenticatedLocalToolRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "campaign.enrichment.propose",
      expect.any(Function),
      undefined,
      expect.objectContaining({ tool: "submit_enrichment_proposal" }),
    );
    expect(auth.authenticateLocalToolRequest).not.toHaveBeenCalled();
    expect(service.submitCampaignEnrichmentProposal).toHaveBeenCalledWith(principal, "lead-1", submission);
    expect(body.data).toEqual({
      run_id: "run-1",
      suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
    });
    expect(JSON.stringify(body)).not.toContain("token-a");
    expect(JSON.stringify(body)).not.toContain("user-a");
    expect(JSON.stringify(body)).not.toContain("org-a");
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String),
      tokenId: "token-a",
      orgId: "org-a",
      userId: "user-a",
      tool: "submit_enrichment_proposal",
      operation: "proposal_submit",
      leadId: "lead-1",
      resultCategory: "submitted",
      proposalCount: 1,
    }));
  });

  it("returns 200 and the same safe data for an idempotent replay", async () => {
    service.submitCampaignEnrichmentProposal.mockResolvedValueOnce({ ...safeResult, created: false });
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request(), params: { id: "lead-1" } } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run_id: "run-1",
        suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
      },
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      resultCategory: "replayed",
      proposalCount: 1,
    }));
  });

  it("authenticates before parsing malformed JSON or accessing the proposal service", async () => {
    auth.runAuthenticatedLocalToolRequest.mockRejectedValueOnce(new LocalToolError("scope_forbidden"));
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request("{"), params: { id: "lead-1" } } as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "scope_forbidden", message: "Required scope is not granted", retryable: false },
    });
    expect(service.submitCampaignEnrichmentProposal).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication_failed", 401, "Authentication failed"],
    ["scope_forbidden", 403, "Required scope is not granted"],
    ["stale_revision", 409, "Resource changed; refresh and try again"],
    ["claim_conflict", 409, "Resource is already claimed"],
    ["idempotency_conflict", 409, "Idempotency key conflicts with a previous request"],
  ] as const)("maps %s to a fixed safe error", async (code, status, message) => {
    if (code === "authentication_failed" || code === "scope_forbidden") {
      auth.runAuthenticatedLocalToolRequest.mockRejectedValueOnce(new LocalToolError(code));
    } else if (code === "claim_conflict") {
      service.submitCampaignEnrichmentProposal.mockRejectedValueOnce(new LocalToolError("claim_conflict"));
    } else {
      service.submitCampaignEnrichmentProposal.mockRejectedValueOnce(new LocalToolError(code));
    }
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request(), params: { id: "lead-1" } } as never);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, message, retryable: expect.any(Boolean) },
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["uppercase revision", { ...submission, expected_lead_revision: "A".repeat(64) }],
    ["unsafe evidence", {
      ...submission,
      proposals: [{
        ...submission.proposals[0],
        evidence: [{ ...submission.proposals[0].evidence[0], url: "http://example.com" }],
      }],
    }],
    ["canonically duplicate evidence", {
      ...submission,
      proposals: [{
        ...submission.proposals[0],
        evidence: [submission.proposals[0].evidence[0], {
          ...submission.proposals[0].evidence[0],
          title: " night   RADIO archive ",
          url: "https://EXAMPLE.com:443/night-radio/archive",
          retrieved_at: "2026-08-10T13:00:00.000+02:00",
          citation_text: " recent programming includes  leftfield club music. ",
        }],
      }],
    }],
  ])("returns a fixed validation error for %s before service access", async (_label, body) => {
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request(body), params: { id: "lead-1" } } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", message: "Invalid request", retryable: false },
    });
    expect(service.submitCampaignEnrichmentProposal).not.toHaveBeenCalled();
  });

  it("rejects an undeclared oversized stream before proposal validation or service access", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1_024));
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    });
    const streamed = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: streamed, params: { id: "lead-1" } } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    expect(service.submitCampaignEnrichmentProposal).not.toHaveBeenCalled();
  });

  it("audits stale rejection with no proposal text", async () => {
    service.submitCampaignEnrichmentProposal.mockRejectedValueOnce(new LocalToolError("stale_revision"));
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/proposals");

    const response = await POST!({ request: request(), params: { id: "lead-1" } } as never);

    expect(response.status).toBe(409);
    const serialized = JSON.stringify(audit.recordLocalToolOperation.mock.calls);
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      resultCategory: "stale_revision",
      proposalCount: 1,
    }));
    expect(serialized).not.toMatch(/Warm, leftfield|Recent programming|citation_text|Night Radio/i);
  });
});
