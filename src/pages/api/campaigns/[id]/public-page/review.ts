import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { reviewCampaignPublicPageRevision, reviewCampaignPublicPageRevisionSchema } from "../../../../../server/campaign-public-page";
import { HttpError } from "../../../../../server/errors";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id);
    const reviewerId = requireActorId(locals.user?.id);
    const input = await parseJson(request, reviewCampaignPublicPageRevisionSchema);
    return json(await reviewCampaignPublicPageRevision(orgId, campaignId, input.revision_id, reviewerId));
  } catch (error) { return handleApiError(error); }
};

function requirePathId(id: string | undefined) { if (!id) throw new HttpError("Campaign id is required", 400); return id; }
function requireActorId(id: unknown) { if (typeof id !== "string" || !id) throw new HttpError("Authentication required", 401); return id; }
