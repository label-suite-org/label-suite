import type { APIRoute } from "astro";
import { handleApiError, json } from "../../server/api";
import { openArtistAgreement, readArtistPortal, readPortalJson, submitArtistDetails, withArtistPortal } from "../../server/artist-portal";
import { requireSameOrigin } from "../../server/request-security";

export const prerender = false;
export const GET: APIRoute = async ({ request, url }) => {
  try { return json(await withArtistPortal(request, async (portal) => url.searchParams.has("document")
    ? openArtistAgreement(portal, url.searchParams.get("document")!) : readArtistPortal(portal))); }
  catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    requireSameOrigin(request);
    return json(await withArtistPortal(request, async (portal) => submitArtistDetails(portal, await readPortalJson(request))), 201);
  } catch (error) { return handleApiError(error); }
};
