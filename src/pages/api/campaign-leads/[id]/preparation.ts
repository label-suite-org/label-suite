import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  updateLeadPreparation,
  updateLeadPreparationSchema,
} from "../../../../server/campaign-communicator";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const leadId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, updateLeadPreparationSchema);
    return json(await updateLeadPreparation(orgId, leadId, input, actorId));
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
