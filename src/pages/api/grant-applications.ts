import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createGrantApplication,
  createGrantApplicationSchema,
  deleteGrantApplication,
  deleteGrantApplicationSchema,
  updateGrantApplication,
  updateGrantApplicationSchema,
} from "../../server/grants";
import { requireSameOrigin } from "../../server/request-security";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await createGrantApplication(orgId, await parseJson(request, createGrantApplicationSchema)), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await updateGrantApplication(orgId, await parseJson(request, updateGrantApplicationSchema)));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "fundraising.mutate");
    const input = await parseJson(request, deleteGrantApplicationSchema);
    return json(await deleteGrantApplication(orgId, input.id));
  } catch (error) {
    return handleApiError(error);
  }
};
