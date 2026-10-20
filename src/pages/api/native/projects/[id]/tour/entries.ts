import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../../../../lib/native-workspace";
import { bearerToken, getNativeSession } from "../../../../../../lib/native-session";
import { runWithDatabaseContext } from "../../../../../../lib/db";
import { json, parseJson, handleApiError } from "../../../../../../server/api";
import { hasCapability } from "../../../../../../server/native-capabilities";
import { saveTourDailyEntry, tourDailyMutation } from "../../../../../../server/tour-daily-flow";
export const prerender = false;
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request), session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "budgets.mutate")) return json({ error: "Budget editing permission required" }, 403);
    if (!params.id) return json({ error: "Tour required" }, 400);
    const input = await parseJson(request, tourDailyMutation);
    const result = await runWithDatabaseContext({ orgId: actor.workspace.org.id, userId: actor.userId }, () => saveTourDailyEntry(actor.workspace.org.id, params.id!, actor.userId, input));
    return json(result);
  } catch (error) { return handleApiError(error); }
};
