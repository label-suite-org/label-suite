import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { confirmSpotifyIdentity, confirmSpotifyIdentitySchema } from "../../../../../server/spotify-identity";
import { requireSameOrigin } from "../../../../../server/request-security";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    return json({ link: await confirmSpotifyIdentity(orgId, await parseJson(request, confirmSpotifyIdentitySchema), locals.user?.id ?? null) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
};
