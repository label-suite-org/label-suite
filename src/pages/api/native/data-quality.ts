import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json } from "../../../server/api";
import { listNativeDataQuality } from "../../../server/native-data-quality";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    const query = new URL(request.url).searchParams;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeDataQuality(actor.workspace.org.id, actor.userId, { q: query.get("q"), cursor: query.get("cursor"), status: query.get("status"), priority: query.get("priority"), source: query.get("source"), object_type: query.get("object_type") })));
  } catch (error) { return handleApiError(error); }
};
