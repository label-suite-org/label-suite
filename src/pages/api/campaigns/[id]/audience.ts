import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  attachCampaignAudienceSchema,
  attachCampaignAudience,
  detachCampaignAudience,
  getCampaignAudienceForCampaign,
} from "../../../../server/campaign-audiences";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);
    return json(await getCampaignAudienceForCampaign(orgId, campaignId));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);
    const input = await parseJson(request, attachCampaignAudienceSchema);
    return json(await attachCampaignAudience(orgId, campaignId, input));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);
    return json(await detachCampaignAudience(orgId, campaignId));
  } catch (error) {
    return handleApiError(error);
  }
};
