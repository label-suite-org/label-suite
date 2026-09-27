import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createGrant,
  createGrantSchema,
  deleteGrant,
  deleteGrantSchema,
  updateGrant,
  updateGrantSchema,
} from "../../server/grants";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await createGrant(orgId, await parseJson(request, createGrantSchema)), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await updateGrant(orgId, await parseJson(request, updateGrantSchema)));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "fundraising.mutate");
    const input = await parseJson(request, deleteGrantSchema);
    return json(await deleteGrant(orgId, input.id));
  } catch (error) {
    return handleApiError(error);
  }
};
