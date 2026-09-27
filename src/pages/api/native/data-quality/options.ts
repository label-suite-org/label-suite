import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../server/api";
import { nativeDataQualityOptions } from "../../../../server/native-data-quality";

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
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await nativeDataQualityOptions(actor.workspace.org.id, actor.userId, { kind: query.get("kind"), q: query.get("q"), cursor: query.get("cursor") })));
  } catch (error) { return handleApiError(error); }
};
