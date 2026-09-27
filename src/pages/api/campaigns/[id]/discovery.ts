import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { campaignDiscoveryCommandSchema, executeCampaignDiscoveryCommand, loadCampaignDiscoveryWorkspace } from "../../../../server/campaign-discovery";
import { HttpError } from "../../../../server/errors";
import { requireCapability, requireOrgId } from "../../../../server/tenant";

export const prerender = false;

function requireActorId(id: unknown): string {
  if (typeof id !== "string" || !id) throw new HttpError("Authentication required", 401);
  return id;
}

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireOrgId(locals);
    if (!params.id) throw new HttpError("Campaign id is required", 400);
    return json(await loadCampaignDiscoveryWorkspace(orgId, params.id));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    if (!params.id) throw new HttpError("Campaign id is required", 400);
    const command = await parseJson(request, campaignDiscoveryCommandSchema);
    if (command.type === "run") {
      return json(await executeCampaignDiscoveryCommand(orgId, params.id, command, { actorUserId: locals.user?.id ?? null }), 201);
    }
    return json(await executeCampaignDiscoveryCommand(orgId, params.id, command, { actorUserId: requireActorId(locals.user?.id) }), 200);
  } catch (error) {
    return handleApiError(error);
  }
};
