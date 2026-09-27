import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { hasCapability } from "../../../../server/native-capabilities";
import { HttpError } from "../../../../server/errors";
import { getNativeTrack, nativeTrackUpdateSchema, updateNativeTrack } from "../../../../server/native-tracks";

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
    const releaseId = null;
    const trackId = params.trackId?.trim();
    if (!trackId) throw new HttpError("Track is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await getNativeTrack(actor.workspace.org.id, releaseId, trackId)));
  } catch (error) { return handleApiError(error); }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const releaseId = null;
    const trackId = params.trackId?.trim();
    if (!trackId) throw new HttpError("Track is required", 400);
    const input = await parseJson(request, nativeTrackUpdateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await updateNativeTrack(actor.workspace.org.id, releaseId, trackId, input, actor.userId)));
  } catch (error) { return handleApiError(error); }
};
