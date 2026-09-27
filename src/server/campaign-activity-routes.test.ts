import type { APIRoute } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";

const activityService = vi.hoisted(() => ({
  getCampaignActivitySnapshot: vi.fn(),
  decideCampaignActivityProposal: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireOrgId: (locals: { orgId?: string }) => {
    if (typeof locals.orgId === "string" && locals.orgId) return locals.orgId;
    throw new HttpError("Active workspace is required", 401);
  },
  requireCapability: (locals: { orgId?: string; membershipRole?: string }, capability: string) => {
    if (capability !== "operations.mutate") throw new Error(`Unexpected capability: ${capability}`);
    if (locals.membershipRole !== "owner" && locals.membershipRole !== "operator") {
      throw new HttpError("Insufficient permissions", 403);
    }
    if (typeof locals.orgId !== "string" || !locals.orgId) {
      throw new HttpError("Active workspace is required", 401);
    }
    return locals.orgId;
  },
}));

vi.mock("./campaign-activity", async () => {
  const core = await import("./campaign-activity-core");
  return {
    ...activityService,
    campaignActivityDecisionSchema: core.campaignActivityDecisionSchema,
  };
});

type RouteModule = Partial<Record<"GET" | "PATCH", APIRoute>>;

function request(body?: unknown) {
  return new Request("https://suite.test/api/campaigns/campaign-path/activity", {
    method: body === undefined ? "GET" : "PATCH",
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

function locals(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org-1",
    membershipRole: "operator",
    user: { id: "user-1" },
    ...overrides,
  };
}

async function loadRoute(): Promise<RouteModule> {
  return import("../pages/api/campaigns/[id]/activity");
}

describe("campaign activity routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityService.getCampaignActivitySnapshot.mockResolvedValue({ items: [], proposals: [], sourceStates: [] });
    activityService.decideCampaignActivityProposal.mockResolvedValue({ items: [], proposals: [], sourceStates: [] });
  });

  it("loads a tenant-scoped activity snapshot from the path campaign", async () => {
    const { GET } = await loadRoute();

    const response = await GET!({
      request: request(),
      locals: locals(),
      params: { id: "campaign-path" },
    } as never);

    expect(response.status).toBe(200);
    expect(activityService.getCampaignActivitySnapshot).toHaveBeenCalledWith("org-1", "campaign-path");
  });

  it("requires an active workspace and campaign path for GET", async () => {
    const { GET } = await loadRoute();

    const unauthenticated = await GET!({ request: request(), locals: {}, params: { id: "campaign-path" } } as never);
    const missingPath = await GET!({ request: request(), locals: locals(), params: {} } as never);

    expect(unauthenticated.status).toBe(401);
    expect(missingPath.status).toBe(400);
    expect(activityService.getCampaignActivitySnapshot).not.toHaveBeenCalled();
  });

  it("requires operations.mutate and actor identity for proposal decisions", async () => {
    const { PATCH } = await loadRoute();
    const body = { proposal_key: "proposal-1", decision: "resolved", reason: null };

    const readOnly = await PATCH!({
      request: request(body), locals: locals({ membershipRole: "member" }), params: { id: "campaign-path" },
    } as never);
    const missingActor = await PATCH!({
      request: request(body), locals: locals({ user: undefined }), params: { id: "campaign-path" },
    } as never);

    expect(readOnly.status).toBe(403);
    expect(missingActor.status).toBe(401);
    expect(activityService.decideCampaignActivityProposal).not.toHaveBeenCalled();
  });

  it("strictly validates decisions and keeps campaign identity in the path", async () => {
    const { PATCH } = await loadRoute();

    const unknownField = await PATCH!({
      request: request({ proposal_key: "proposal-1", decision: "resolved", reason: null, campaign_id: "body-spoof" }),
      locals: locals(), params: { id: "campaign-path" },
    } as never);
    const invalidDecision = await PATCH!({
      request: request({ proposal_key: "proposal-1", decision: "accepted", reason: null }),
      locals: locals(), params: { id: "campaign-path" },
    } as never);

    expect(unknownField.status).toBe(400);
    expect(invalidDecision.status).toBe(400);
    expect(activityService.decideCampaignActivityProposal).not.toHaveBeenCalled();
  });

  it("passes only the path campaign, strict input, and session actor to the decision service", async () => {
    const { PATCH } = await loadRoute();
    const input = { proposal_key: "proposal-1", decision: "dismissed", reason: "Not relevant" };

    const response = await PATCH!({
      request: request(input), locals: locals(), params: { id: "campaign-path" },
    } as never);

    expect(response.status).toBe(200);
    expect(activityService.decideCampaignActivityProposal).toHaveBeenCalledWith(
      "org-1", "campaign-path", input, "user-1",
    );
  });

  it("passes service errors through the API error handler", async () => {
    activityService.getCampaignActivitySnapshot.mockRejectedValueOnce(new HttpError("Campaign not found", 404));
    const { GET } = await loadRoute();

    const response = await GET!({ request: request(), locals: locals(), params: { id: "campaign-path" } } as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Campaign not found" });
  });

});
