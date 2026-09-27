import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { requireCapability } from "../../../../server/tenant";
import { z } from "zod";
import {
  getCampaignContentContext,
  reviewCampaignTemplateForCampaign,
  reviewCampaignTemplatePayloadSchema,
  previewCampaignContentPayloadSchema,
  previewCampaignTemplateContent,
  saveCampaignContentPayloadSchema,
  saveCampaignContentTemplate,
} from "../../../../server/campaign-content";

const campaignContentPostPayloadSchema = reviewCampaignTemplatePayloadSchema.extend({
  action: z.literal("preview").or(z.literal("review")).optional(),
});

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);
    return json(await getCampaignContentContext(orgId, campaignId));
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);

    const payload = await parseJson(request, saveCampaignContentPayloadSchema);
    const operatorId = typeof locals.user?.id === "string" ? locals.user.id : null;
    return json(await saveCampaignContentTemplate(orgId, campaignId, payload, operatorId));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);

    const payload = await parseJson(request, campaignContentPostPayloadSchema);
    const operatorId = typeof locals.user?.id === "string" ? locals.user.id : null;
    if (payload.action === "review") {
      return json(await reviewCampaignTemplateForCampaign(orgId, campaignId, payload, operatorId));
    }
    return json(await previewCampaignTemplateContent(orgId, campaignId, {
      ...payload,
      operator_id: operatorId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
};
