import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { getCampaignPublicPageEditor, saveCampaignPublicPageDraft, saveCampaignPublicPageDraftSchema } from "../../../../server/campaign-public-page";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await getCampaignPublicPageEditor(orgId, requirePathId(params.id)));
  } catch (error) { return handleApiError(error); }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, saveCampaignPublicPageDraftSchema);
    return json(await saveCampaignPublicPageDraft(orgId, requirePathId(params.id), input, actorId), 201);
  } catch (error) { return handleApiError(error); }
};

function requirePathId(id: string | undefined) { if (!id) throw new HttpError("Campaign id is required", 400); return id; }
function requireActorId(id: unknown) { if (typeof id !== "string" || !id) throw new HttpError("Authentication required", 401); return id; }
