import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../lib/db";
import { handleApiError, json } from "../../../server/api";
import { getNativeSettings } from "../../../server/native-settings";

export const prerender = false;
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request), session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    return await runWithDatabaseContext({ orgId: actor.workspace.org.id, userId: actor.userId }, async () => {
      return json(await getNativeSettings(actor.workspace.org.id, actor.userId, {
        membersOffset: url.searchParams.get("membersOffset") ?? undefined,
        integrationsOffset: url.searchParams.get("integrationsOffset") ?? undefined,
      }));
    }, { isolationLevel: "repeatable read" });
  } catch (error) { return handleApiError(error); }
};
