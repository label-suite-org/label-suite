import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createCampaignDogfoodEntry,
  createCampaignDogfoodEntrySchema,
  updateCampaignDogfoodEntry,
  updateCampaignDogfoodEntrySchema,
} from "../../server/campaign-outreach";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCampaignDogfoodEntrySchema);
    return json(await createCampaignDogfoodEntry(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateCampaignDogfoodEntrySchema);
    return json(await updateCampaignDogfoodEntry(orgId, input));
  } catch (error) {
    return handleApiError(error);
  }
};
