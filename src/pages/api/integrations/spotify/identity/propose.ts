import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { proposeSpotifyIdentity, spotifyIdentityInputSchema } from "../../../../../server/spotify-identity";
import { requireSameOrigin } from "../../../../../server/request-security";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await proposeSpotifyIdentity(orgId, await parseJson(request, spotifyIdentityInputSchema)));
  } catch (error) {
    return handleApiError(error);
  }
};
