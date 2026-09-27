import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createArtist,
  createArtistSchema,
  deleteArtist,
  deleteArtistSchema,
  updateArtist,
  updateArtistSchema,
} from "../../server/artists";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createArtistSchema);
    return json(await createArtist(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateArtistSchema);
    return json(await updateArtist(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteArtistSchema);
    return json(await deleteArtist(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
