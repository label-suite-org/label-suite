import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../../../server/errors";

const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
vi.mock("../../../../../lib/native-session", () => sessions);
const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({
  runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()),
}));
const discovery = vi.hoisted(() => ({ load: vi.fn(), execute: vi.fn() }));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../lib/db", () => database);
vi.mock("../../../../../server/campaign-discovery", async () => {
  const { z } = await import("zod");
  return {
    loadCampaignDiscoveryWorkspace: discovery.load,
    executeCampaignDiscoveryCommand: discovery.execute,
    nativeCampaignDiscoveryReviewCommandSchema: z.discriminatedUnion("type", [
      z.object({ type: z.literal("shortlist"), channel_id: z.string().min(1), expected_revision: z.number().int().min(0) }).strict(),
      z.object({ type: z.literal("reject"), channel_id: z.string().min(1), expected_revision: z.number().int().min(0), reason: z.string().min(1) }).strict(),
      z.object({ type: z.literal("promote"), channel_id: z.string().min(1), expected_revision: z.number().int().min(0), evidence_ids: z.array(z.string().min(1)).min(1) }).strict(),
    ]),
  };
});

import { GET, POST } from "./discovery";

const workspace = {
  availability: { available: true, reason: null },
  query_preview: [{ query: "Artist Track premiere", enabled: true, editable: true }],
  estimated_cost_units: 100,
  runs: [{
    id: "run-1", status: "partial", created_at: "2026-09-17T10:00:00.000Z", estimated_cost_units: 100,
    queries: [{ query: "Artist Track premiere", enabled: true, status: "completed", error: null }],
    channels: [{
      provider_channel_id: "channel-1", title: "Selector", url: "https://youtube.test/channel-1",
      evidence: [{ provider_item_id: "video-1", provider: "youtube_data_api_v3", query: "Artist Track premiere", title: "Artist — Track", url: "https://youtube.test/video-1", published_at: "2026-09-16T10:00:00.000Z", retrieved_at: "2026-09-17T10:00:00.000Z" }],
      exact_match_evidence: [], prospective_fit: { qualifies: true, signals: ["matching_content_format"] },
      activity_freshness: { state: "fresh", latest_activity_at: "2026-09-16T10:00:00.000Z", expires_at: "2026-12-16T10:00:00.000Z" },
      relevance: { exactness: 0, editorial_fit: 1, activity: 1, evidence_strength: 1, total: 4 },
      review: { state: "shortlisted", reason: null, actor_user_id: "operator-a", decided_at: "2026-09-17T10:01:00.000Z", revision: 1, history: [], promoted_lead_id: null, promotion_outcome: null, promoted_evidence: [], prior_campaign_decisions: [] },
    }], exact_match_channels: [], prospective_fit_channels: [],
  }],
};

function request(method: string, body?: unknown) {
  return new Request("https://suite.test/api/native/campaigns/campaign-a/discovery?workspaceId=org-a", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("native campaign discovery review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.bearerToken.mockReturnValue(null);
    sessions.getNativeSession.mockResolvedValue(null);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    discovery.load.mockResolvedValue(workspace);
    discovery.execute.mockResolvedValue(workspace);
  });

  it("distinguishes a revoked workspace from an invalid session", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    sessions.bearerToken.mockReturnValue("fixture-token");
    sessions.getNativeSession.mockResolvedValue({ userId: "user-a" });
    for (const handler of [GET, POST]) {
      const response = await handler({ params: { id: "campaign-a" }, request: request("GET") } as never);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    }
    expect(discovery.load).not.toHaveBeenCalled();
    expect(discovery.execute).not.toHaveBeenCalled();
  });

  it("lets a member inspect identity, provenance, and non-canonical shortlist state", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "member-a", workspace: { org: { id: "org-a" }, role: "member" } });
    const response = await GET({ params: { id: "campaign-a" }, request: request("GET") } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "member-a", orgId: "org-a" }, expect.any(Function));
    expect(discovery.load).toHaveBeenCalledWith("org-a", "campaign-a", {}, { cursor: undefined, runLimit: 5, candidateLimit: 25, evidenceLimit: 10 });
    expect(body.runs[0].candidates[0]).toMatchObject({
      identity: { provider: "youtube", channel_id: "channel-1", title: "Selector" },
      evidence: [{ provenance: { provider: "youtube_data_api_v3", query: "Artist Track premiere", retrieved_at: "2026-09-17T10:00:00.000Z" } }],
      proposal_status: "shortlisted",
      canonical_promotion: { status: "not_accepted", lead_id: null },
    });
  });

  it("passes an opaque stable cursor through to canonical discovery", async () => {
    const cursor = Buffer.from(JSON.stringify({ created_at: "2026-09-17T10:00:00.000Z", id: "run-1" })).toString("base64url");
    const response = await GET({ params: { id: "campaign-a" }, request: new Request(`https://suite.test/api/native/campaigns/campaign-a/discovery?workspaceId=org-a&cursor=${cursor}`) } as never);
    expect(response.status).toBe(200);
    expect(discovery.load).toHaveBeenCalledWith("org-a", "campaign-a", {}, { cursor, runLimit: 5, candidateLimit: 25, evidenceLimit: 10 });
  });

  it("marks a promoted candidate as accepted only with its canonical lead identity", async () => {
    discovery.load.mockResolvedValue({
      ...workspace,
      runs: workspace.runs.map((run) => ({ ...run, channels: run.channels.map((candidate) => ({
        ...candidate,
        review: { ...candidate.review, state: "promoted", promoted_lead_id: "lead-1", promotion_outcome: "existing" },
      })) })),
    });
    const response = await GET({ params: { id: "campaign-a" }, request: request("GET") } as never);
    await expect(response.json()).resolves.toMatchObject({
      runs: [{ candidates: [{ proposal_status: "promoted", canonical_promotion: { status: "accepted", lead_id: "lead-1", outcome: "existing" } }] }],
    });
  });

  it("records canonical-authority unavailability as an error instead of synthesizing a review", async () => {
    discovery.load.mockRejectedValueOnce(new HttpError("Canonical discovery authority unavailable", 503));
    const response = await GET({ params: { id: "campaign-a" }, request: request("GET") } as never);
    expect(response.status).toBe(503);
  });

  it("denies payee discovery reads before the canonical workspace is loaded", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "payee-a", workspace: { org: { id: "org-a" }, role: "payee" } });
    const response = await GET({ params: { id: "campaign-a" }, request: request("GET") } as never);
    expect(response.status).toBe(403);
    expect(discovery.load).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range native read limit before the canonical workspace is loaded", async () => {
    const response = await GET({ params: { id: "campaign-a" }, request: new Request("https://suite.test/api/native/campaigns/campaign-a/discovery?workspaceId=org-a&limit=11") } as never);
    expect(response.status).toBe(400);
    expect(discovery.load).not.toHaveBeenCalled();
  });

  it.each(["member", "payee"])("denies %s mutation before canonical authority", async (role) => {
    native.resolveNativeActor.mockResolvedValue({ userId: `${role}-a`, workspace: { org: { id: "org-a" }, role } });
    const response = await POST({ params: { id: "campaign-a" }, request: request("POST", { type: "shortlist", channel_id: "channel-1", expected_revision: 1 }) } as never);
    expect(response.status).toBe(403);
    expect(discovery.execute).not.toHaveBeenCalled();
  });

  it("uses authenticated operator context and existing authority for explicit promotion", async () => {
    const command = { type: "promote", channel_id: "channel-1", expected_revision: 1, evidence_ids: ["video-1"] };
    const response = await POST({ params: { id: "campaign-a" }, request: request("POST", command) } as never);
    expect(response.status).toBe(200);
    expect(discovery.execute).toHaveBeenCalledWith("org-a", "campaign-a", command, { actorUserId: "user-a" }, { cursor: undefined, runLimit: 5, candidateLimit: 25, evidenceLimit: 10 });
  });

  it("returns the same bounded page contract after a native review mutation", async () => {
    const cursor = Buffer.from(JSON.stringify({ created_at: "2026-09-17T10:00:00.000Z", id: "run-1" })).toString("base64url");
    const command = { type: "shortlist", channel_id: "channel-1", expected_revision: 1 };
    const response = await POST({ params: { id: "campaign-a" }, request: new Request(`https://suite.test/api/native/campaigns/campaign-a/discovery?workspaceId=org-a&limit=2&cursor=${cursor}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }) } as never);
    expect(response.status).toBe(200);
    expect(discovery.execute).toHaveBeenCalledWith("org-a", "campaign-a", command, { actorUserId: "user-a" }, { cursor, runLimit: 2, candidateLimit: 25, evidenceLimit: 10 });
  });

  it("does not expose a provider run command in the native action adapter", async () => {
    const response = await POST({ params: { id: "campaign-a" }, request: request("POST", { type: "run", queries: [{ query: "do not call provider", enabled: true }] }) } as never);
    expect(response.status).toBe(400);
    expect(discovery.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new HttpError("Campaign not found", 404), 404],
    [new HttpError("Discovery candidate changed; reload before reviewing", 409), 409],
    [new HttpError("Duplicate canonical lead", 409), 409],
  ])("preserves canonical tenant and conflict guards (%i)", async (error, status) => {
    discovery.execute.mockRejectedValueOnce(error);
    const response = await POST({ params: { id: "campaign-a" }, request: request("POST", { type: "shortlist", channel_id: "channel-1", expected_revision: 1 }) } as never);
    expect(response.status).toBe(status);
  });
});
