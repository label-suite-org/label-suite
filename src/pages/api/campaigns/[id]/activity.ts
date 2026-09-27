import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  decideCampaignActivityProposal,
  getCampaignActivitySnapshot,
} from "../../../../server/campaign-activity";
import { campaignActivityDecisionSchema } from "../../../../server/campaign-activity-core";
import { HttpError } from "../../../../server/errors";
import { requireCapability, requireOrgId } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireOrgId(locals);
    return json(await getCampaignActivitySnapshot(orgId, requirePathId(params.id)));
  } catch (error) {
    return handleApiError(error);
  }
};

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, campaignActivityDecisionSchema);
    return json(await decideCampaignActivityProposal(orgId, campaignId, input, actorId));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (id) return id;
  throw new HttpError("Campaign id is required", 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
