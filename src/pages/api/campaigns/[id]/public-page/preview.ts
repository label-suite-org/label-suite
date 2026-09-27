import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { getCampaignPublicPageRevisionPreview } from "../../../../../server/campaign-public-page";
import { HttpError } from "../../../../../server/errors";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, url }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id);
    const revisionId = url.searchParams.get("revision_id");
    if (!revisionId?.trim()) throw new HttpError("Revision id is required", 400);
    return json(await getCampaignPublicPageRevisionPreview(orgId, campaignId, revisionId));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (!id) throw new HttpError("Campaign id is required", 400);
  return id;
}
