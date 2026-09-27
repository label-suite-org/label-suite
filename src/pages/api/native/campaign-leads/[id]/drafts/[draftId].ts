import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveNativeActor } from "../../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../../server/api";
import { createManualDraftVersion } from "../../../../../../server/campaign-communicator";
import { hasCapability } from "../../../../../../server/tenant";
import { HttpError } from "../../../../../../server/errors";

export const prerender = false;

const nativePlainDraftSchema = z.object({
  subject: z.string().trim().max(500).nullable(),
  body: z.string().trim().min(1).max(10_000),
  expected_updated_at: z.string().datetime(),
}).strict();

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const leadId = requiredParam(params.id, "Campaign lead id");
    const draftId = requiredParam(params.draftId, "Outreach draft id");
    const input = await parseJson(request, nativePlainDraftSchema);
    return json(await createManualDraftVersion(
      actor.workspace.org.id,
      draftId,
      input,
      actor.userId,
      undefined,
      { expectedUpdatedAt: input.expected_updated_at, expectedLeadId: leadId, plainOnly: true },
    ), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function requiredParam(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new HttpError(`${label} is required`, 400);
  return normalized;
}
