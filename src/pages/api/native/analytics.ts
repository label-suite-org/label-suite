import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { getNativeAnalytics, nativeAnalyticsScopeSchema } from "../../../server/native-analytics";

export const prerender = false;
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
    const scope = nativeAnalyticsScopeSchema.parse({ artist_id: url.searchParams.get("artist") ?? undefined, release_id: url.searchParams.get("release") ?? undefined });
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await getNativeAnalytics(actor.workspace.org.id, scope));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }, { isolationLevel: "repeatable read" });
  } catch (error) { return handleApiError(error); }
};
