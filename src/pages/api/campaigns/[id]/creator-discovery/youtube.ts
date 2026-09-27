import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { requireCapability } from "../../../../../server/tenant";
import {
  searchYouTubeCreatorCandidates,
  youtubeCreatorDiscoveryQuerySchema,
} from "../../../../../server/youtube-creator-discovery";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, url }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) throw new HttpError("Campaign id is required", 400);

    const input = youtubeCreatorDiscoveryQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    return json(await searchYouTubeCreatorCandidates(orgId, campaignId, input));
  } catch (error) {
    return handleApiError(error);
  }
};
