import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveNativeActor } from "../../../../../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../../../../../lib/db";
import { handleApiError, json, parseJson } from "../../../../../../../server/api";
import { approveDraft } from "../../../../../../../server/campaign-communicator";
import { HttpError } from "../../../../../../../server/errors";
import { hasCapability } from "../../../../../../../server/tenant";

export const prerender = false;

const nativeApprovalSchema = z.object({
  expected_draft_updated_at: z.string().datetime(),
  expected_lead_updated_at: z.string().datetime(),
}).strict();

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const leadId = requiredParam(params.id, "Campaign lead id");
    const draftId = requiredParam(params.draftId, "Outreach draft id");
    const input = await parseJson(request, nativeApprovalSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await approveDraft(actor.workspace.org.id, draftId, actor.userId, undefined, {
      expectedDraftUpdatedAt: input.expected_draft_updated_at,
      expectedLeadUpdatedAt: input.expected_lead_updated_at,
      expectedLeadId: leadId,
    })));
  } catch (error) {
    return handleApiError(error);
  }
};

function requiredParam(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new HttpError(`${label} is required`, 400);
  return normalized;
}
