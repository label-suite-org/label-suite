import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../../server/api";
import { HttpError } from "../../../../../../server/errors";
import { hasCapability } from "../../../../../../server/native-capabilities";
import { getNativeRadioStation, updateNativeRadioPreparation, nativeRadioPreparationSchema } from "../../../../../../server/native-radio";

import { createNativeRadioDraft, nativeRadioDraftSchema } from "../../../../../../server/campaign-communicator";

export const prerender = false;
export const GET: APIRoute = async ({ request, params }) => {
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
    const stationId = params.stationId?.trim();
    if (!stationId) throw new HttpError("Campaign station is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await getNativeRadioStation(actor.workspace.org.id, campaignId, stationId));
      response.headers.set("Cache-Control", "private, no-store"); return response;
    });
  } catch (error) { return handleApiError(error); }
};
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign is required", 400);
    const stationId = params.stationId?.trim();
    if (!stationId) throw new HttpError("Campaign station is required", 400);
    const input = await parseJson(request, nativeRadioPreparationSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await updateNativeRadioPreparation(actor.workspace.org.id, campaignId, stationId, actor.userId, input));
      response.headers.set("Cache-Control", "private, no-store"); return response;
    });
  } catch (error) { return handleApiError(error); }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const campaignId = params.id?.trim();
    if (!campaignId) throw new HttpError("Campaign is required", 400);
    const stationId = params.stationId?.trim();
    if (!stationId) throw new HttpError("Campaign station is required", 400);
    const input = await parseJson(request, nativeRadioDraftSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await createNativeRadioDraft(actor.workspace.org.id, campaignId, stationId, actor.userId, input), 201);
      response.headers.set("Cache-Control", "private, no-store"); return response;
    });
  } catch (error) { return handleApiError(error); }
};
