import { bearerToken, getNativeSession } from "../../../lib/native-session";
import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../lib/db";
import { listNativeCampaignSummaries } from "../../../server/native-campaigns";
import { json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = bearerToken(request);
    const session = token ? await getNativeSession(token) : null;
    return session
      ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
      : json({ error: "Authentication required" }, 401);
  }
  if (actor.workspace.role === "payee") return json({ error: "Insufficient permissions", code: "insufficient_permissions" }, 403);
  const params = new URL(request.url).searchParams;
  return runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeCampaignSummaries(actor.workspace.org.id, {
    archived: params.get("archived") === "true",
    cursor: params.get("cursor"),
    limit: params.get("limit"),
  })));
};
