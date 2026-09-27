import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { createGeneratedDraft } from "../../../../server/campaign-communicator";
import { generateDraftSchema } from "../../../../server/campaign-communicator-core";
import { getCampaignCommunicatorProvider } from "../../../../server/campaign-communicator-provider";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const leadId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, generateDraftSchema);
    const provider = getCampaignCommunicatorProvider();
    return json(await createGeneratedDraft(orgId, leadId, input, actorId, provider), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (id) return id;
  throw new HttpError("Campaign lead id is required", 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
