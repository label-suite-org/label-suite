import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createRoyalty,
  createRoyaltySchema,
  deleteRoyalty,
  deleteRoyaltySchema,
  updateRoyalty,
  updateRoyaltySchema,
} from "../../server/royalties";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, createRoyaltySchema);
    return json(await createRoyalty(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, updateRoyaltySchema);
    return json(await updateRoyalty(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, deleteRoyaltySchema);
    return json(await deleteRoyalty(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
