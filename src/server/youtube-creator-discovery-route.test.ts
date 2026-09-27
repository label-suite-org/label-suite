import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "./errors";

const discovery = vi.hoisted(() => ({
  searchYouTubeCreatorCandidates: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireCapability: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole !== "owner" && locals.membershipRole !== "operator") {
      throw new HttpError("Insufficient permissions", 403);
    }
    return locals.orgId ?? "org-1";
  },
}));

vi.mock("./youtube-creator-discovery", () => ({
  ...discovery,
  youtubeCreatorDiscoveryQuerySchema: z.object({
    query: z.string().trim().min(1, "query is required").max(200),
    max_results: z.coerce.number().int().min(1).max(15).default(10),
  }).strict(),
}));

describe("YouTube creator discovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discovery.searchYouTubeCreatorCandidates.mockResolvedValue({
      source: {
        provider: "youtube_data_api_v3",
        query: "Fountain Edits",
        retrieved_at: "2026-08-15T12:00:00.000Z",
      },
      candidates: [],
    });
  });

  it("runs a bounded campaign search for an authenticated operator", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/creator-discovery/youtube");
    const request = new Request(
      "https://labels.example/api/campaigns/campaign-1/creator-discovery/youtube?query=Fountain%20Edits&max_results=15",
    );

    const response = await GET({
      request,
      url: new URL(request.url),
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(200);
    expect(discovery.searchYouTubeCreatorCandidates).toHaveBeenCalledWith(
      "org-1",
      "campaign-1",
      { query: "Fountain Edits", max_results: 15 },
    );
    expect(await response.json()).toEqual({
      source: {
        provider: "youtube_data_api_v3",
        query: "Fountain Edits",
        retrieved_at: "2026-08-15T12:00:00.000Z",
      },
      candidates: [],
    });
  });

  it("denies read-only members before starting discovery", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/creator-discovery/youtube");
    const request = new Request(
      "https://labels.example/api/campaigns/campaign-1/creator-discovery/youtube?query=Fountain%20Edits",
    );

    const response = await GET({
      request,
      url: new URL(request.url),
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(response.status).toBe(403);
    expect(discovery.searchYouTubeCreatorCandidates).not.toHaveBeenCalled();
  });

  it("rejects an unbounded result request before starting discovery", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/creator-discovery/youtube");
    const request = new Request(
      "https://labels.example/api/campaigns/campaign-1/creator-discovery/youtube?query=Fountain%20Edits&max_results=50",
    );

    const response = await GET({
      request,
      url: new URL(request.url),
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(400);
    expect(discovery.searchYouTubeCreatorCandidates).not.toHaveBeenCalled();
  });
});
