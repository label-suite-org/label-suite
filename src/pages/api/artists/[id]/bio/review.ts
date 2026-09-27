import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { reviewArtistBio } from "../../../../../server/artists";
import { HttpError } from "../../../../../server/errors";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    if (!params.id) throw new HttpError("Artist id is required", 400);
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    return json(await reviewArtistBio(orgId, params.id, locals.user.id));
  } catch (error) {
    return handleApiError(error);
  }
};
