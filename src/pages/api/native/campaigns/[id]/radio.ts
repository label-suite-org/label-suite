import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { listNativeRadioStations } from "../../../../../server/native-radio";

export const prerender = false;
export const GET: APIRoute = async ({ request, params, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await listNativeRadioStations(actor.workspace.org.id, campaignId, url.searchParams.get("cursor"), url.searchParams.get("q")));
      response.headers.set("Cache-Control", "private, no-store"); return response;
    });
  } catch (error) { return handleApiError(error); }
};
