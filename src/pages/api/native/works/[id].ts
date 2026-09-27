import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { getNativeWork } from "../../../../server/native-works";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
    const workId = params.id?.trim();
    if (!workId) throw new HttpError("Work is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await getNativeWork(actor.workspace.org.id, workId)));
  } catch (error) { return handleApiError(error); }
};
