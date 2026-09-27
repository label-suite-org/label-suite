import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createCampaignLead,
  createCampaignLeadSchema,
  updateCampaignLead,
  updateCampaignLeadSchema,
} from "../../server/campaign-outreach";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCampaignLeadSchema);
    return json(await createCampaignLead(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateCampaignLeadSchema);
    return json(await updateCampaignLead(orgId, input));
  } catch (error) {
    return handleApiError(error);
  }
};
