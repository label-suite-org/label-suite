import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createCampaign,
  createCampaignSchema,
  deleteCampaign,
  deleteCampaignSchema,
  updateCampaign,
  updateCampaignSchema,
} from "../../server/campaigns";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCampaignSchema);
    return json(await createCampaign(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateCampaignSchema);
    return json(await updateCampaign(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteCampaignSchema);
    return json(await deleteCampaign(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
