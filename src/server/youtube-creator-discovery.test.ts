import { describe, expect, it, vi } from "vitest";
import { searchYouTubeCreatorCandidates } from "./youtube-creator-discovery";

describe("YouTube creator discovery", () => {
  it("groups matching evidence videos by their publishing channel", async () => {
    const findCampaign = vi.fn().mockResolvedValue({ id: "campaign-1" });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [
        {
          id: { kind: "youtube#video", videoId: "video-1" },
          snippet: {
            channelId: "channel-1",
            channelTitle: "Channel One",
            publishedAt: "2026-07-01T10:00:00Z",
            title: "Fountain Edits premiere",
          },
        },
        {
          id: { kind: "youtube#video", videoId: "video-2" },
          snippet: {
            channelId: "channel-1",
            channelTitle: "Channel One",
            publishedAt: "2026-07-02T10:00:00Z",
            title: "Fountain Edits review",
          },
        },
        {
          id: { kind: "youtube#video", videoId: "video-3" },
          snippet: {
            channelId: "channel-2",
            channelTitle: "Channel Two",
            publishedAt: "2026-07-03T10:00:00Z",
            title: "Independent music picks",
          },
        },
      ],
    }), { status: 200 }));

    const result = await searchYouTubeCreatorCandidates(
      "org-1",
      "campaign-1",
      { query: "Fountain Edits", max_results: 3 },
      {
        findCampaign,
        fetch,
        environment: { YOUTUBE_API_KEY: "server-secret" },
        now: () => new Date("2026-08-15T12:00:00Z"),
      },
    );

    expect(result).toEqual({
      source: {
        provider: "youtube_data_api_v3",
        query: "Fountain Edits",
        retrieved_at: "2026-08-15T12:00:00.000Z",
      },
      candidates: [
        {
          channel_id: "channel-1",
          channel_title: "Channel One",
          channel_url: "https://www.youtube.com/channel/channel-1",
          evidence: [
            {
              video_id: "video-1",
              title: "Fountain Edits premiere",
              url: "https://www.youtube.com/watch?v=video-1",
              published_at: "2026-07-01T10:00:00Z",
            },
            {
              video_id: "video-2",
              title: "Fountain Edits review",
              url: "https://www.youtube.com/watch?v=video-2",
              published_at: "2026-07-02T10:00:00Z",
            },
          ],
        },
        {
          channel_id: "channel-2",
          channel_title: "Channel Two",
          channel_url: "https://www.youtube.com/channel/channel-2",
          evidence: [
            {
              video_id: "video-3",
              title: "Independent music picks",
              url: "https://www.youtube.com/watch?v=video-3",
              published_at: "2026-07-03T10:00:00Z",
            },
          ],
        },
      ],
    });

    expect(findCampaign).toHaveBeenCalledWith("org-1", "campaign-1");
    const requestUrl = new URL(fetch.mock.calls[0][0] as string);
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
    expect(requestUrl.searchParams.get("type")).toBe("video");
    expect(requestUrl.searchParams.get("q")).toBe("Fountain Edits");
    expect(requestUrl.searchParams.get("maxResults")).toBe("3");
    expect(requestUrl.searchParams.get("key")).toBe("server-secret");
  });

  it("rejects an out-of-tenant campaign before calling YouTube", async () => {
    const fetch = vi.fn();

    await expect(searchYouTubeCreatorCandidates(
      "org-1",
      "campaign-from-another-org",
      { query: "Fountain Edits", max_results: 10 },
      {
        findCampaign: vi.fn().mockResolvedValue(null),
        fetch,
        environment: { YOUTUBE_API_KEY: "server-secret" },
        now: () => new Date(),
      },
    )).rejects.toMatchObject({ status: 404, message: "Campaign not found" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports missing server configuration without exposing a credential value", async () => {
    await expect(searchYouTubeCreatorCandidates(
      "org-1",
      "campaign-1",
      { query: "Fountain Edits", max_results: 10 },
      {
        findCampaign: vi.fn().mockResolvedValue({ id: "campaign-1" }),
        fetch: vi.fn(),
        environment: {},
        now: () => new Date(),
      },
    )).rejects.toMatchObject({
      status: 503,
      message: "YouTube creator discovery is not configured",
    });
  });

  it("maps provider quota exhaustion to a safe retry response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Request for server-secret has exceeded quota",
        errors: [{ reason: "quotaExceeded" }],
      },
    }), { status: 403 }));

    await expect(searchYouTubeCreatorCandidates(
      "org-1",
      "campaign-1",
      { query: "Fountain Edits", max_results: 10 },
      {
        findCampaign: vi.fn().mockResolvedValue({ id: "campaign-1" }),
        fetch,
        environment: { YOUTUBE_API_KEY: "server-secret" },
        now: () => new Date(),
      },
    )).rejects.toMatchObject({
      status: 429,
      message: "YouTube creator discovery quota is exhausted",
    });
  });

  it("maps malformed provider responses to a safe upstream error", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ unexpected: "provider-shape" }],
    }), { status: 200 }));

    await expect(searchYouTubeCreatorCandidates(
      "org-1",
      "campaign-1",
      { query: "Fountain Edits", max_results: 10 },
      {
        findCampaign: vi.fn().mockResolvedValue({ id: "campaign-1" }),
        fetch,
        environment: { YOUTUBE_API_KEY: "server-secret" },
        now: () => new Date(),
      },
    )).rejects.toMatchObject({
      status: 502,
      message: "YouTube creator discovery is temporarily unavailable",
    });
  });
});
