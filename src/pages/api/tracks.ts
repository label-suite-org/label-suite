import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { triggerCatalogSweep } from "../../server/catalog-maintenance";
import { requireCapability } from "../../server/tenant";
import {
  createTrack,
  createTrackSchema,
  deleteTrack,
  deleteTrackSchema,
  updateTrack,
  updateTrackSchema,
} from "../../server/tracks";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createTrackSchema);
    const result = await createTrack(orgId, input);
    await triggerCatalogSweep(orgId, "track create");
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateTrackSchema);
    const result = await updateTrack(orgId, input);
    await triggerCatalogSweep(orgId, "track update");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteTrackSchema);
    const result = await deleteTrack(orgId, input);
    await triggerCatalogSweep(orgId, "track delete");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};
