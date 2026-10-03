import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../../lib/db";
import { handleApiError, json } from "../../../../server/api";
import { hasCapability } from "../../../../server/tenant";
import { getNativeLeadWorkbench } from "../../../../server/native-lead-workbench";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") return json({ error: "Insufficient permissions", code: "insufficient_permissions" }, 403);
    const leadId = params.id?.trim();
    const query = new URL(request.url).searchParams;
    const campaignId = query.get("campaignId")?.trim();
    if (!leadId || !campaignId) return json({ error: "Campaign and lead are required" }, 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const projection = await getNativeLeadWorkbench(actor.workspace.org.id, campaignId, leadId, {
        activityCursor: query.get("activityCursor"),
        activityLimit: query.get("activityLimit"),
      });
      return json({ ...projection, can_mutate: hasCapability(actor.workspace.role, "operations.mutate") });
    });
  } catch (error) {
    return handleApiError(error);
  }
};
