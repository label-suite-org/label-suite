import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { getNativeDataQuality, actOnNativeDataQuality, nativeDataQualityActionSchema } from "../../../../server/native-data-quality";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await getNativeDataQuality(actor.workspace.org.id, actor.userId, params.id ?? "", new URL(request.url).searchParams.get("connection_id"))));
  } catch (error) { return handleApiError(error); }
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    const input = await parseJson(request, nativeDataQualityActionSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await actOnNativeDataQuality(actor.workspace.org.id, actor.userId, params.id ?? "", input)));
  } catch (error) { return handleApiError(error); }
};
