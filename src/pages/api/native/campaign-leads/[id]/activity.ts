import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { handleApiError, json } from "../../../../../server/api";
import { listNativeLeadActivity } from "../../../../../server/native-lead-workbench";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (actor.workspace.role === "payee") return json({ error: "Insufficient permissions", code: "insufficient_permissions" }, 403);
    const query = new URL(request.url).searchParams;
    const campaignId = query.get("campaignId")?.trim();
    const leadId = params.id?.trim();
    if (!campaignId || !leadId) return json({ error: "Campaign and lead are required" }, 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeLeadActivity(actor.workspace.org.id, campaignId, leadId, {
      cursor: query.get("cursor"),
      limit: query.get("limit"),
    })));
  } catch (error) {
    return handleApiError(error);
  }
};
