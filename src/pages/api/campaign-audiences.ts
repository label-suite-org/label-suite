import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  createCampaignAudience,
  createCampaignAudienceSchema,
  listCampaignAudienceContactOptions,
  listCampaignAudienceStationOptions,
  listCampaignAudiences,
} from "../../server/campaign-audiences";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const [audiences, contactOptions, stationOptions] = await Promise.all([
      listCampaignAudiences(orgId),
      listCampaignAudienceContactOptions(orgId),
      listCampaignAudienceStationOptions(orgId),
    ]);

    return json({
      audiences,
      contact_options: contactOptions,
      station_options: stationOptions,
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createCampaignAudienceSchema);
    return json(await createCampaignAudience(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};
