import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { approveDraft } from "../../../../server/campaign-communicator";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

const approveDraftSchema = z.object({}).strict();

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const draftId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    await parseJson(request, approveDraftSchema);
    return json(await approveDraft(orgId, draftId, actorId));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (id) return id;
  throw new HttpError("Outreach draft id is required", 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
