import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { proposeSpotifyIdentity, spotifyIdentityProposalSchema } from "../../../../../server/spotify-identity";
import { requireSameOrigin } from "../../../../../server/request-security";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await proposeSpotifyIdentity(orgId, await parseJson(request, spotifyIdentityProposalSchema)));
  } catch (error) {
    return handleApiError(error);
  }
};
