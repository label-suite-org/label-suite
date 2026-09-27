import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import {
  executeCampaignDiscoveryCommand,
  loadCampaignDiscoveryWorkspace,
  nativeCampaignDiscoveryReviewCommandSchema,
} from "../../../../../server/campaign-discovery";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { hasCapability } from "../../../../../server/native-capabilities";
import { projectNativeCampaignDiscoveryWorkspace } from "../../../../../server/native-campaign-discovery";

export const prerender = false;

function campaignId(value: string | undefined): string {
  const id = value?.trim();
  if (!id) throw new HttpError("Campaign id is required", 400);
  return id;
}

function nativeReadOptions(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "5");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new HttpError("limit must be an integer between 1 and 10", 400);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  return { cursor, runLimit: limit, candidateLimit: 25, evidenceLimit: 10 };
}

function canReadDiscovery(role: string): boolean {
  return role !== "payee";
}

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!canReadDiscovery(actor.workspace.role)) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const id = campaignId(params.id);
    const options = nativeReadOptions(request);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => (
      json(projectNativeCampaignDiscoveryWorkspace(await loadCampaignDiscoveryWorkspace(actor.workspace.org.id, id, {}, options)))
    ));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const id = campaignId(params.id);
    const options = nativeReadOptions(request);
    const command = await parseJson(request, nativeCampaignDiscoveryReviewCommandSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => (
      json(projectNativeCampaignDiscoveryWorkspace(await executeCampaignDiscoveryCommand(
        actor.workspace.org.id,
        id,
        command,
        { actorUserId: actor.userId },
        options,
      )))
    ));
  } catch (error) {
    return handleApiError(error);
  }
};
