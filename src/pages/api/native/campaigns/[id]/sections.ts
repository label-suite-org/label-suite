import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import {
  getNativeCampaignSections,
  mutateNativeCampaignSections,
  nativeCampaignSectionsMutationSchema,
} from "../../../../../server/campaign-sections";
import { hasCapability } from "../../../../../server/native-capabilities";
import { HttpError } from "../../../../../server/errors";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    // Payees are limited to the payee portal; campaign documents and audience data are operations data.
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign id is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () =>
      json(await getNativeCampaignSections(actor.workspace.org.id, campaignId)));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign id is required", 400);
    const input = await parseJson(request, nativeCampaignSectionsMutationSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () =>
      json(await mutateNativeCampaignSections(actor.workspace.org.id, campaignId, input, actor.userId)));
  } catch (error) {
    return handleApiError(error);
  }
};
