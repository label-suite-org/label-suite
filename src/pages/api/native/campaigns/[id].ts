import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { assertNativeCampaignReadAccess, resolveNativeActor } from "../../../../lib/native-workspace";
import { getNativeCampaignDetail } from "../../../../server/native-campaigns";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    assertNativeCampaignReadAccess(actor);
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => (
      json(await getNativeCampaignDetail(actor.workspace.org.id, campaignId))
    ));
  } catch (error) {
    return handleApiError(error);
  }
};
