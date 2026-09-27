import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";

const discovery = vi.hoisted(() => ({
  load: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireOrgId: (locals: { orgId?: string }) => locals.orgId ?? (() => { throw new HttpError("Active workspace is required", 401); })(),
  requireCapability: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole !== "owner" && locals.membershipRole !== "operator") throw new HttpError("Insufficient permissions", 403);
    return locals.orgId ?? "org-1";
  },
}));

vi.mock("./campaign-discovery", async () => {
  const { z } = await import("zod");
  return {
    loadCampaignDiscoveryWorkspace: discovery.load,
    executeCampaignDiscoveryCommand: discovery.execute,
    campaignDiscoveryCommandSchema: z.union([
      z.object({ type: z.literal("run"), queries: z.array(z.object({ query: z.string().min(1), enabled: z.boolean() })).min(1).max(6) }),
      z.object({ type: z.literal("shortlist"), channel_id: z.string(), expected_revision: z.number() }),
      z.object({ type: z.literal("reject"), channel_id: z.string(), expected_revision: z.number(), reason: z.string() }),
      z.object({ type: z.literal("reconsider"), channel_id: z.string(), expected_revision: z.number() }),
      z.object({ type: z.literal("promote"), channel_id: z.string(), expected_revision: z.number(), evidence_ids: z.array(z.string()).min(1) }),
    ]),
  };
});

describe("campaign discovery route", () => {
  beforeEach(() => { vi.clearAllMocks(); discovery.load.mockResolvedValue({ runs: [] }); discovery.execute.mockResolvedValue({ id: "run-1" }); });

  it("lets a read-only member revisit the workspace", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/discovery");
    const response = await GET({ params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);
    expect(response.status).toBe(200);
    expect(discovery.load).toHaveBeenCalledWith("org-1", "campaign-1");
  });

  it("denies a read-only member before executing a run", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/discovery");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/discovery", { method: "POST", body: JSON.stringify({ type: "run", queries: [{ query: "Fountain edit", enabled: true }] }) });
    const response = await POST({ request, params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);
    expect(response.status).toBe(403);
    expect(discovery.execute).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor for a review decision", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/discovery");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/discovery", { method: "POST", body: JSON.stringify({ type: "reject", channel_id: "channel-1", expected_revision: 0, reason: "wrong_music" }) });
    const response = await POST({ request, params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(200);
    expect(discovery.execute).toHaveBeenCalledWith("org-1", "campaign-1", { type: "reject", channel_id: "channel-1", expected_revision: 0, reason: "wrong_music" }, { actorUserId: "operator-1" });
  });

  it("passes selected evidence for an operator promotion", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/discovery");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/discovery", { method: "POST", body: JSON.stringify({ type: "promote", channel_id: "channel-1", expected_revision: 1, evidence_ids: ["video-1"] }) });
    const response = await POST({ request, params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(200);
    expect(discovery.execute).toHaveBeenCalledWith("org-1", "campaign-1", { type: "promote", channel_id: "channel-1", expected_revision: 1, evidence_ids: ["video-1"] }, { actorUserId: "operator-1" });
  });
});
