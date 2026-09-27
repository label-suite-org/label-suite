import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { listNativeWorks } from "../../../server/native-works";

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
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
    const query = new URL(request.url).searchParams;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeWorks(actor.workspace.org.id, { q: query.get("q"), cursor: query.get("cursor"), missing_isrc: query.get("missing_isrc") })));
  } catch (error) { return handleApiError(error); }
};
