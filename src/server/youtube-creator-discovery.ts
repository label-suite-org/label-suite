import { z } from "zod";
import { HttpError, NotFoundError } from "./errors";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

export const youtubeCreatorDiscoveryQuerySchema = z.object({
  query: z.string().trim().min(1, "query is required").max(200),
  max_results: z.coerce.number().int().min(1).max(15).default(10),
}).strict();

export type YouTubeCreatorDiscoveryQuery = z.infer<typeof youtubeCreatorDiscoveryQuerySchema>;

type Dependencies = {
  findCampaign: (orgId: string, campaignId: string) => Promise<{ id: string } | null>;
  fetch: typeof globalThis.fetch;
  environment: Record<string, string | undefined>;
  now: () => Date;
};

const youtubeSearchResponseSchema = z.object({
  items: z.array(z.object({
    id: z.object({
      kind: z.literal("youtube#video"),
      videoId: z.string().min(1),
    }),
    snippet: z.object({
      channelId: z.string().min(1),
      channelTitle: z.string(),
      publishedAt: z.string().min(1),
      title: z.string(),
    }),
  })).default([]),
});

export async function searchYouTubeCreatorCandidates(
  orgId: string,
  campaignId: string,
  input: YouTubeCreatorDiscoveryQuery,
  dependencies: Dependencies = defaultDependencies(),
) {
  const campaign = await dependencies.findCampaign(orgId, campaignId);
  if (!campaign) throw new NotFoundError("Campaign not found");

  const apiKey = dependencies.environment.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError("YouTube creator discovery is not configured", 503);
  }

  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("q", input.query);
  url.searchParams.set("maxResults", String(input.max_results));
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await dependencies.fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new HttpError("YouTube creator discovery is temporarily unavailable", 502);
  }

  if (!response.ok) {
    if (await isQuotaError(response)) {
      throw new HttpError("YouTube creator discovery quota is exhausted", 429);
    }
    throw new HttpError("YouTube creator discovery is temporarily unavailable", 502);
  }

  let providerResult: z.infer<typeof youtubeSearchResponseSchema>;
  try {
    providerResult = youtubeSearchResponseSchema.parse(await response.json());
  } catch {
    throw new HttpError("YouTube creator discovery is temporarily unavailable", 502);
  }

  const candidates = new Map<string, {
    channel_id: string;
    channel_title: string;
    channel_url: string;
    evidence: Array<{
      video_id: string;
      title: string;
      url: string;
      published_at: string;
    }>;
  }>();

  for (const item of providerResult.items) {
    let candidate = candidates.get(item.snippet.channelId);
    if (!candidate) {
      candidate = {
        channel_id: item.snippet.channelId,
        channel_title: item.snippet.channelTitle,
        channel_url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
        evidence: [],
      };
      candidates.set(item.snippet.channelId, candidate);
    }
    candidate.evidence.push({
      video_id: item.id.videoId,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      published_at: item.snippet.publishedAt,
    });
  }

  return {
    source: {
      provider: "youtube_data_api_v3" as const,
      query: input.query,
      retrieved_at: dependencies.now().toISOString(),
    },
    candidates: [...candidates.values()],
  };
}

function defaultDependencies(): Dependencies {
  return {
    findCampaign: async (orgId, campaignId) => {
      const { getCampaignDetail } = await import("./campaigns");
      return getCampaignDetail(orgId, campaignId);
    },
    fetch: globalThis.fetch,
    environment: process.env,
    now: () => new Date(),
  };
}

async function isQuotaError(response: Response): Promise<boolean> {
  try {
    const body = await response.json() as {
      error?: { errors?: Array<{ reason?: string }> };
    };
    return body.error?.errors?.some(({ reason }) => (
      reason === "quotaExceeded" || reason === "dailyLimitExceeded"
    )) ?? false;
  } catch {
    return false;
  }
}
