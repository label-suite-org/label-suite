import { bearerToken, getNativeSession } from "../../../lib/native-session";
import type { APIRoute } from "astro";
import { resolveNativeWorkspace } from "../../../lib/native-workspace";
import { listNativeCampaignSummaries } from "../../../server/native-campaigns";
import { json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const workspace = await resolveNativeWorkspace(request);
  if (!workspace) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (workspace.role === "payee") return json({ error: "Insufficient permissions", code: "insufficient_permissions" }, 403);
  const params = new URL(request.url).searchParams;
  return json(await listNativeCampaignSummaries(workspace.org.id, {
    archived: params.get("archived") === "true",
    cursor: params.get("cursor"),
    limit: params.get("limit"),
  }));
};
