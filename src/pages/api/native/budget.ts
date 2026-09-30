import type { APIRoute } from "astro";
import { z } from "zod";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getNativeBudget } from "../../../server/native-budget";
import { nativeUpdateBudgetLineSchema, nativeCreateVarianceRequestSchema, nativeDecideVarianceSchema, updateBudgetLineForNative, createVarianceRequestForNative, decideVarianceRequestForNative } from "../../../server/budget-mutations";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";

export const prerender = false;
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_line"), input: nativeUpdateBudgetLineSchema }).strict(),
  z.object({ action: z.literal("propose_variance"), input: nativeCreateVarianceRequestSchema }).strict(),
  z.object({ action: z.literal("decide_variance"), input: nativeDecideVarianceSchema }).strict(),
]);
async function actorFor(request: Request) {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = bearerToken(request);
    const session = token ? await getNativeSession(token) : null;
    throw new HttpError(session ? "Workspace access removed" : "Authentication required", session ? 403 : 401, session ? "workspace_access_removed" : "authentication_required");
  }
  if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
  return actor;
}
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await actorFor(request);
    const snapshot = await getNativeBudget(actor.workspace.org.id, actor.userId, {
      line_id: url.searchParams.get("line") ?? undefined,
      variance_id: url.searchParams.get("variance") ?? undefined,
      release_id: url.searchParams.get("release") ?? undefined,
      project_id: url.searchParams.get("project") ?? undefined,
      project_offset: url.searchParams.get("project_offset") ?? undefined,
      line_offset: url.searchParams.get("line_offset") ?? undefined,
    });
    return privateResponse(json({ ...snapshot, authority: { can_edit: hasCapability(actor.workspace.role, "budgets.mutate"), can_decide: hasCapability(actor.workspace.role, "variance.decide") } }));
  } catch (error) { return privateResponse(handleApiError(error)); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request);
    const body = await parseJson(request, mutation);
    if (!hasCapability(actor.workspace.role, body.action === "decide_variance" ? "variance.decide" : "budgets.mutate")) throw new HttpError("Insufficient permissions", 403);
    const result = await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, () => {
      switch (body.action) {
        case "update_line": return updateBudgetLineForNative(actor.workspace.org.id, body.input, actor.userId);
        case "propose_variance": return createVarianceRequestForNative(actor.workspace.org.id, body.input, actor.userId);
        case "decide_variance": return decideVarianceRequestForNative(actor.workspace.org.id, body.input, actor.userId);
      }
    });
    return privateResponse(json(result));
  } catch (error) { return privateResponse(handleApiError(error)); }
};
