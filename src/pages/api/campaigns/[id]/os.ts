import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  createCampaignDeliverable,
  createCampaignDeliverableSchema,
  createCampaignEngagement,
  createCampaignEngagementSchema,
  createCampaignPost,
  createCampaignPostSchema,
  finalizeCampaignReport,
  finalizeCampaignReportSchema,
  getCampaignOsWorkspace,
  setCampaignTerritories,
  setCampaignTerritoriesSchema,
  updateCampaignEngagement,
  updateCampaignEngagementSchema,
  updateCampaignDeliverable,
  updateCampaignDeliverableSchema,
} from "../../../../server/campaign-os";
import { requireCapability, requireOrgId } from "../../../../server/tenant";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_engagement"), input: createCampaignEngagementSchema }),
  z.object({ action: z.literal("update_engagement"), input: updateCampaignEngagementSchema }),
  z.object({ action: z.literal("create_deliverable"), input: createCampaignDeliverableSchema }),
  z.object({ action: z.literal("update_deliverable"), input: updateCampaignDeliverableSchema }),
  z.object({ action: z.literal("create_post"), input: createCampaignPostSchema }),
  z.object({ action: z.literal("set_territories"), input: setCampaignTerritoriesSchema }),
  z.object({ action: z.literal("finalize_report"), input: finalizeCampaignReportSchema }),
]);

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireOrgId(locals);
    if (!params.id) return json({ error: "campaign id required" }, 400);
    return json(await getCampaignOsWorkspace(orgId, params.id));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) return json({ error: "campaign id required" }, 400);
    const command = await parseJson(request, commandSchema);
    if ((command.action === "create_engagement" || command.action === "update_engagement") && command.input.budget_line_id !== undefined) requireCapability(locals, "budgets.mutate");
    if (command.action === "create_engagement") return json(await createCampaignEngagement(orgId, campaignId, command.input), 201);
    if (command.action === "update_engagement") return json(await updateCampaignEngagement(orgId, campaignId, command.input));
    if (command.action === "create_deliverable") return json(await createCampaignDeliverable(orgId, campaignId, command.input), 201);
    if (command.action === "update_deliverable") return json(await updateCampaignDeliverable(orgId, campaignId, command.input));
    if (command.action === "create_post") return json(await createCampaignPost(orgId, campaignId, command.input), 201);
    if (command.action === "set_territories") return json(await setCampaignTerritories(orgId, campaignId, command.input));
    const actorId = typeof locals.user?.id === "string" ? locals.user.id : null;
    if (!actorId) return json({ error: "Authentication required" }, 401);
    return json(await finalizeCampaignReport(orgId, campaignId, command.input.report, actorId));
  } catch (error) {
    return handleApiError(error);
  }
};
