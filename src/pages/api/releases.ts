import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { triggerCatalogSweep } from "../../server/catalog-maintenance";
import { requireCapability } from "../../server/tenant";
import {
  createRelease,
  createReleaseSchema,
  deleteRelease,
  deleteReleaseSchema,
  updateRelease,
  updateReleaseSchema,
} from "../../server/releases";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createReleaseSchema);
    const result = await createRelease(orgId, input);
    await triggerCatalogSweep(orgId, "release create");
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateReleaseSchema);
    const result = await updateRelease(orgId, input);
    await triggerCatalogSweep(orgId, "release update");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteReleaseSchema);
    const result = await deleteRelease(orgId, input);
    await triggerCatalogSweep(orgId, "release delete");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};
