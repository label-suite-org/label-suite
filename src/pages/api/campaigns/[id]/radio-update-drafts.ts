import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { createRadioUpdateDraft } from "../../../../server/campaign-communicator";
import { radioUpdateDraftSchema } from "../../../../server/campaign-communicator-core";
import { getCampaignCommunicatorProvider } from "../../../../server/campaign-communicator-provider";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, radioUpdateDraftSchema);
    const provider = getCampaignCommunicatorProvider();
    return json(await createRadioUpdateDraft(orgId, campaignId, input, actorId, provider), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (!id) throw new HttpError("Campaign id is required", 400);
  return id;
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
