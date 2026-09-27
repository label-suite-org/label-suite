import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { publishCampaignPublicPageRevision, publishCampaignPublicPageRevisionSchema, unpublishCampaignPublicPage } from "../../../../../server/campaign-public-page";
import { HttpError } from "../../../../../server/errors";
import { requireCapability, requireOwnerRole } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    // Keep the route in the mutation inventory while applying the stricter owner gate.
    requireCapability(locals, "operations.mutate");
    const orgId = requireOwnerRole(locals);
    const campaignId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, publishCampaignPublicPageRevisionSchema);
    if (input.confirmation === "unpublish") return json(await unpublishCampaignPublicPage(orgId, campaignId, actorId));
    return json(await publishCampaignPublicPageRevision(orgId, campaignId, input.revision_id, actorId));
  } catch (error) { return handleApiError(error); }
};

function requirePathId(id: string | undefined) { if (!id) throw new HttpError("Campaign id is required", 400); return id; }
function requireActorId(id: unknown) { if (typeof id !== "string" || !id) throw new HttpError("Authentication required", 401); return id; }
