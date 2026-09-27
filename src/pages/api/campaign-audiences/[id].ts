import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { previewCampaignAudience } from "../../../server/campaign-audiences";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const audienceId = params.id;
    if (!audienceId) return json({ error: "audience id required" }, 400);
    return json(await previewCampaignAudience(orgId, audienceId));
  } catch (error) {
    return handleApiError(error);
  }
};
