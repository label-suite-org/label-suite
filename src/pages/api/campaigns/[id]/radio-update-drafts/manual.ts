import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { createManualRadioUpdateDraft } from "../../../../../server/campaign-communicator";
import { manualRadioUpdateDraftSchema } from "../../../../../server/campaign-communicator-core";
import { HttpError } from "../../../../../server/errors";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = params.id;
    if (!campaignId) throw new HttpError("Campaign id is required", 400);
    const actorId = locals.user?.id;
    if (typeof actorId !== "string" || !actorId) throw new HttpError("Authentication required", 401);
    const input = await parseJson(request, manualRadioUpdateDraftSchema);
    return json(await createManualRadioUpdateDraft(orgId, campaignId, input, actorId), 201);
  } catch (error) { return handleApiError(error); }
};
