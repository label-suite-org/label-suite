import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignEnrichmentItem, CampaignEnrichmentQueueItem } from "../lib/campaign-enrichment-local-tool-contract";
import { LocalToolError } from "./local-tools-api";

const auth = vi.hoisted(() => ({
  authenticateLocalToolRequest: vi.fn(),
  runAuthenticatedLocalToolRequest: vi.fn(),
}));
const service = vi.hoisted(() => ({
  listCampaignEnrichmentQueue: vi.fn(),
  getCampaignEnrichmentItem: vi.fn(),
  claimCampaignEnrichmentItem: vi.fn(),
  releaseCampaignEnrichmentItem: vi.fn(),
}));
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
  scopes: ["campaign.enrichment.read", "campaign.enrichment.claim"] as const,
};
const revision = "a".repeat(64);
const queueItem: CampaignEnrichmentQueueItem = {
  item_id: "lead-1",
  campaign_id: "fountain",
  campaign_name: "Fountain Edits",
  lead_id: "lead-1",
  target_name: "Night Shift",
  target_url: "https://example.com/night-shift",
  discovery_source: "Friend recommendation",
  recommending_person: "A friend",
  introduction_available: true,
  relationship_warmth: 3,
  musical_fit: "Leftfield electronic music",
  exact_edit: "Fountain Edit",
  editorial_fit: 3,
  useful_reach: 2,
  direct_free_access: 2,
  missing_enrichment_fields: ["pitch_angle", "programming_focus"],
  lead_revision: revision,
  pipeline_stage: "qualified",
  claim: { status: "unclaimed", expires_at: null },
};
const item: CampaignEnrichmentItem = {
  ...queueItem,
  campaign: {
    goal: "Find trusted specialist radio support.",
    artist_name: "Nature Boy",
    release_title: "Fountain Edits",
    track_titles: ["Fountain"],
  },
  lead: {
    target_type: "radio_show",
    contact_route: "music@example.com",
    contact_route_verified_at: null,
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
  },
  canonical_lead: {
    id: "lead-1",
    campaign_id: "fountain",
    exact_edit_track_id: "track-1",
    target_name: "Night Shift",
    target_type: "radio_show",
    target_url: "https://example.com/night-shift",
    contact_route: "music@example.com",
    contact_route_verified_at: null,
    discovery_source: "Friend recommendation",
    recommending_person: "A friend",
    introduction_available: true,
    musical_fit: "Leftfield electronic music",
    relationship_warmth: 3,
    editorial_fit: 3,
    useful_reach: 2,
    direct_free_access: 2,
    pipeline_stage: "qualified",
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
    updated_at: "2026-08-10T12:00:00.000Z",
  },
  prompt: { id: "prompt-1", version: 1, text: "Research only." },
  accepted_research: [],
  pending_suggestions: [],
};
const claim = {
  id: "claim-1",
  org_id: "org-a",
  campaign_id: "fountain",
  lead_id: "lead-1",
  token_id: "token-a",
  user_id: "user-a",
  claimed_at: new Date("2026-08-10T12:00:00.000Z"),
  renewed_at: null,
  expires_at: new Date("2026-08-10T12:20:00.000Z"),
  created_at: new Date("2026-08-10T12:00:00.000Z"),
  updated_at: new Date("2026-08-10T12:00:00.000Z"),
};

function request(path: string, init?: RequestInit) {
  return new Request(`https://labels.example${path}`, init);
}

function claimRequest(body: unknown = { expected_lead_revision: revision, lease_minutes: 20 }) {
  return request("/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("campaign enrichment local-tool read and claim routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.authenticateLocalToolRequest.mockResolvedValue(principal);
    auth.runAuthenticatedLocalToolRequest.mockImplementation(
      async (_request, _scope, operation) => operation(principal),
    );
    service.listCampaignEnrichmentQueue.mockResolvedValue({ items: [queueItem] });
    service.getCampaignEnrichmentItem.mockResolvedValue(item);
    service.claimCampaignEnrichmentItem.mockResolvedValue({ ...claim, result_category: "claimed" });
    service.releaseCampaignEnrichmentItem.mockResolvedValue({ released: true, result_category: "released" });
  });

  it("authenticates the exact read or claim scope before each service access", async () => {
    const queueRoute = await import("../pages/api/local-tools/v1/campaign-enrichment/queue");
    const itemRoute = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]");
    const claimRoute = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim");
    const releaseRoute = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim/[claimId]");
    const queueRequest = request("/api/local-tools/v1/campaign-enrichment/queue?campaign_id=fountain&limit=20");
    const itemRequest = request("/api/local-tools/v1/campaign-enrichment/items/lead-1");
    const post = claimRequest();
    const deletion = request("/api/local-tools/v1/campaign-enrichment/items/lead-1/claim/claim-1", { method: "DELETE" });

    const responses = await Promise.all([
      queueRoute.GET!({ request: queueRequest, url: new URL(queueRequest.url) } as never),
      itemRoute.GET!({ request: itemRequest, params: { id: "lead-1" } } as never),
      claimRoute.POST!({ request: post, params: { id: "lead-1" } } as never),
      releaseRoute.DELETE!({ request: deletion, params: { id: "lead-1", claimId: "claim-1" } } as never),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(auth.runAuthenticatedLocalToolRequest.mock.calls.map((call) => call[1]))
      .toEqual(["campaign.enrichment.read", "campaign.enrichment.read", "campaign.enrichment.claim", "campaign.enrichment.claim"]);
    expect(auth.authenticateLocalToolRequest).not.toHaveBeenCalled();
    expect(service.listCampaignEnrichmentQueue).toHaveBeenCalledWith(principal, {
      campaign_id: "fountain",
      state: "all",
      limit: 20,
    });
    expect(service.getCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1");
    expect(service.claimCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1", {
      expected_lead_revision: revision,
      lease_minutes: 20,
    });
    expect(service.releaseCampaignEnrichmentItem).toHaveBeenCalledWith(principal, "lead-1", "claim-1");
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "claim_enrichment_item",
      operation: "claim",
      resultCategory: "claimed",
      campaignId: "fountain",
      leadId: "lead-1",
    }));
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tool: "release_enrichment_item",
      operation: "release",
      resultCategory: "released",
      leadId: "lead-1",
    }));
  });

  it("returns missing-scope errors before parsing queue bounds or accessing data", async () => {
    auth.runAuthenticatedLocalToolRequest.mockRejectedValueOnce(new LocalToolError("scope_forbidden"));
    const { GET } = await import("../pages/api/local-tools/v1/campaign-enrichment/queue");
    const invalid = request("/api/local-tools/v1/campaign-enrichment/queue?limit=51");

    const response = await GET!({ request: invalid, url: new URL(invalid.url) } as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "scope_forbidden", message: "Required scope is not granted", retryable: false },
    });
    expect(service.listCampaignEnrichmentQueue).not.toHaveBeenCalled();
  });

  it("rejects queue bounds after authentication and before service access", async () => {
    const { GET } = await import("../pages/api/local-tools/v1/campaign-enrichment/queue");
    const invalid = request("/api/local-tools/v1/campaign-enrichment/queue?limit=51");

    const response = await GET!({ request: invalid, url: new URL(invalid.url) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    expect(service.listCampaignEnrichmentQueue).not.toHaveBeenCalled();
  });

  it("returns a fixed not-found envelope for a cross-tenant item ID", async () => {
    service.getCampaignEnrichmentItem.mockRejectedValueOnce(new LocalToolError("not_found"));
    const { GET } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]");
    const crossTenant = request("/api/local-tools/v1/campaign-enrichment/items/other-org-lead");

    const response = await GET!({ request: crossTenant, params: { id: "other-org-lead" } } as never);

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("other-org");
  });

  it("returns an allowlisted claim without claimant or token identity", async () => {
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim");

    const response = await POST!({ request: claimRequest(), params: { id: "lead-1" } } as never);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: "claim-1",
      lead_id: "lead-1",
      claimed_at: "2026-08-10T12:00:00.000Z",
      renewed_at: null,
      expires_at: "2026-08-10T12:20:00.000Z",
    });
    expect(serialized).not.toContain("token-a");
    expect(serialized).not.toContain("user-a");
    expect(serialized).not.toContain("org-a");
  });

  it("returns a safe conflict payload without a different claimant identity", async () => {
    service.claimCampaignEnrichmentItem.mockRejectedValueOnce(Object.assign(
      new LocalToolError("claim_conflict", { expires_at: "2026-08-10T12:20:00.000Z" }),
      { token_id: "token-foreign", claimant_email: "other-org-contact@example.com" },
    ));
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim");

    const response = await POST!({ request: claimRequest(), params: { id: "lead-1" } } as never);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: "claim_conflict",
      message: "Resource is already claimed",
      retryable: true,
      details: { expires_at: "2026-08-10T12:20:00.000Z" },
    });
    expect(serialized).not.toContain("token-foreign");
    expect(serialized).not.toContain("other-org-contact@example.com");
  });

  it("maps malformed claim JSON to invalid request without service access", async () => {
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim");
    const malformed = request("/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await POST!({ request: malformed, params: { id: "lead-1" } } as never);

    expect(response.status).toBe(400);
    expect(service.claimCampaignEnrichmentItem).not.toHaveBeenCalled();
  });

  it("rejects oversized declared and deeply streamed claim bodies with fixed safe errors", async () => {
    const { POST } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim");
    const declared = request("/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(512 * 1_024 + 1) },
      body: "{}",
    });
    const deepText = `${"[".repeat(5_000)}${JSON.stringify({ bearer: "lsmcp_secret", email: "private@example.com" })}${"]".repeat(5_000)}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(deepText));
        controller.close();
      },
    });
    const deep = new Request("https://labels.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const responses = await Promise.all([
      POST!({ request: declared, params: { id: "lead-1" } } as never),
      POST!({ request: deep, params: { id: "lead-1" } } as never),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    const serialized = JSON.stringify(await Promise.all(responses.map((response) => response.json())));
    expect(serialized).not.toMatch(/lsmcp_secret|private@example|stack/i);
    expect(service.claimCampaignEnrichmentItem).not.toHaveBeenCalled();
  });

  it("treats an expired or missing release as an idempotent success", async () => {
    const { DELETE } = await import("../pages/api/local-tools/v1/campaign-enrichment/items/[id]/claim/[claimId]");
    const deletion = request("/api/local-tools/v1/campaign-enrichment/items/lead-1/claim/expired-claim", { method: "DELETE" });

    const response = await DELETE!({
      request: deletion,
      params: { id: "lead-1", claimId: "expired-claim" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { released: true } });
  });
});
