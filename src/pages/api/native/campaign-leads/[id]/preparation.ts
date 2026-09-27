import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { updateLeadPreparation, updateLeadPreparationSchema } from "../../../../../server/campaign-communicator";
import { hasCapability } from "../../../../../server/tenant";
import { HttpError } from "../../../../../server/errors";

export const prerender = false;

const nativePreparationSchema = z.intersection(updateLeadPreparationSchema, z.object({
  expected_updated_at: z.string().datetime(),
}));

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const leadId = params.id?.trim();
    if (!leadId) throw new HttpError("Campaign lead id is required", 400);
    const input = await parseJson(request, nativePreparationSchema);
    return json(await updateLeadPreparation(actor.workspace.org.id, leadId, input, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
};
