import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { resolveNativeActor, assertNativeCampaignReadAccess } from "../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { hasCapability } from "../../../../../server/tenant";
import { getNativeCampaignPlan, nativeCampaignPlanSchema, updateNativeCampaignPlan } from "../../../../../server/native-campaign-plan";
export const prerender = false;
async function actorFor(request: Request) {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = bearerToken(request); const session = token ? await getNativeSession(token) : null;
    throw session ? new HttpError("Workspace access removed", 403, "workspace_access_removed") : new HttpError("Authentication required", 401);
  }
  assertNativeCampaignReadAccess(actor); return actor;
}
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await actorFor(request);
    if (!params.id) throw new HttpError("Campaign is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await getNativeCampaignPlan(actor.workspace.org.id, params.id!)));
  } catch (error) { return handleApiError(error); }
};
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await actorFor(request);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    if (!params.id) throw new HttpError("Campaign is required", 400);
    const input = await parseJson(request, nativeCampaignPlanSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await updateNativeCampaignPlan(actor.workspace.org.id, params.id!, input, actor.userId)));
  } catch (error) { return handleApiError(error); }
};
