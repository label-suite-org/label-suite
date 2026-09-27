import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createMediaAsset,
  createMediaAssetSchema,
  deleteMediaAsset,
  deleteMediaAssetSchema,
  updateMediaAsset,
  updateMediaAssetSchema,
} from "../../server/media-assets";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createMediaAssetSchema);
    return json(await createMediaAsset(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateMediaAssetSchema);
    return json(await updateMediaAsset(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteMediaAssetSchema);
    return json(await deleteMediaAsset(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
