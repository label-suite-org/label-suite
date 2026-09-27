import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { triggerCatalogSweep } from "../../server/catalog-maintenance";
import { requireCapability } from "../../server/tenant";
import {
  createRole,
  createRoleSchema,
  deleteRole,
  deleteRoleSchema,
  updateRole,
  updateRoleSchema,
} from "../../server/roles";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createRoleSchema);
    const result = await createRole(orgId, input);
    await triggerCatalogSweep(orgId, "role create");
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateRoleSchema);
    const result = await updateRole(orgId, input);
    await triggerCatalogSweep(orgId, "role update");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteRoleSchema);
    const result = await deleteRole(orgId, input);
    await triggerCatalogSweep(orgId, "role delete");
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};
