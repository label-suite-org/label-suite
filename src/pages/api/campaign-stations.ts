import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createCampaignStation,
  createCampaignStationSchema,
  deleteCampaignStation,
  deleteCampaignStationSchema,
  updateCampaignStation,
  updateCampaignStationSchema,
} from "../../server/radio-plugging";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCampaignStationSchema);
    return json(await createCampaignStation(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateCampaignStationSchema);
    return json(await updateCampaignStation(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteCampaignStationSchema);
    return json(await deleteCampaignStation(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
