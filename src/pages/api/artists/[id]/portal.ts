import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { getArtistPortalManagement, manageArtistPortal, readPortalJson } from "../../../../server/artist-portal";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;
export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await manageArtistPortal(orgId, params.id!, await readPortalJson(request)));
  } catch (error) { return handleApiError(error); }
};

export const GET: APIRoute = async ({ locals, params }) => {
  try { return json(await getArtistPortalManagement(requireCapability(locals, "operations.mutate"), params.id!)); }
  catch (error) { return handleApiError(error); }
};
