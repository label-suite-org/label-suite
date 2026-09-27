import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { listNativeTracks } from "../../../../../server/native-tracks";

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
    const releaseId = params.id?.trim();
    if (!releaseId) throw new HttpError("Release is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeTracks(actor.workspace.org.id, releaseId)));
  } catch (error) { return handleApiError(error); }
};
