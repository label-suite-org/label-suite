import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { json, handleApiError } from "../../../../../server/api";
import { listNativeCampaignLeads, type NativeLeadQueue } from "../../../../../server/native-campaigns";

export const prerender = false;

const queues = new Set<NativeLeadQueue>(["now", "follow_up", "waiting", "completed"]);

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
    const campaignId = params.id?.trim();
    if (!campaignId) return json({ error: "Campaign is required" }, 400);
    const query = new URL(request.url).searchParams;
    const queue = (query.get("queue") ?? "now") as NativeLeadQueue;
    if (!queues.has(queue)) return json({ error: "Unknown queue" }, 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeCampaignLeads(actor.workspace.org.id, campaignId, {
      queue,
      channel: query.get("channel"),
      stage: query.get("stage"),
      cursor: query.get("cursor"),
      limit: query.get("limit"),
    })));
  } catch (error) {
    return handleApiError(error);
  }
};
