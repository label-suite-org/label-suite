import type { APIRoute } from "astro";
import { resolveNativeWorkspace } from "../../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../../server/api";
import { listNativeLeadActivity } from "../../../../../server/native-lead-workbench";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const workspace = await resolveNativeWorkspace(request);
    if (!workspace) return json({ error: "Authentication required" }, 401);
    const query = new URL(request.url).searchParams;
    const campaignId = query.get("campaignId")?.trim();
    const leadId = params.id?.trim();
    if (!campaignId || !leadId) return json({ error: "Campaign and lead are required" }, 400);
    return json(await listNativeLeadActivity(workspace.org.id, campaignId, leadId, {
      cursor: query.get("cursor"),
      limit: query.get("limit"),
    }));
  } catch (error) {
    return handleApiError(error);
  }
};
