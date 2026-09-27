import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createCatalogEntry,
  createCatalogEntrySchema,
  deleteCatalogEntry,
  deleteCatalogEntrySchema,
  listCatalogEntries,
  listCatalogReleaseOptions,
  updateCatalogEntry,
  updateCatalogEntrySchema,
} from "../../server/catalog";
import { requireCapability, requireOrgId } from "../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const [entries, releaseOptions] = await Promise.all([
      listCatalogEntries(orgId),
      listCatalogReleaseOptions(orgId),
    ]);
    return json({ entries, releaseOptions });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCatalogEntrySchema);
    return json(await createCatalogEntry(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateCatalogEntrySchema);
    return json(await updateCatalogEntry(orgId, input));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteCatalogEntrySchema);
    return json(await deleteCatalogEntry(orgId, input));
  } catch (error) {
    return handleApiError(error);
  }
};
