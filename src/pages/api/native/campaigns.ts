import { runWithDatabaseContext } from "../../../lib/db";
import { createCampaign } from "../../../server/campaigns";
import { nativeCampaignCreateSchema } from "../../../server/native-campaign-plan";
import { hasCapability } from "../../../server/tenant";
import { HttpError } from "../../../server/errors";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import type { APIRoute } from "astro";
import { resolveNativeActor, resolveNativeWorkspace } from "../../../lib/native-workspace";
import { listNativeCampaignSummaries } from "../../../server/native-campaigns";
import { handleApiError, parseJson, json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const workspace = await resolveNativeWorkspace(request);
  if (!workspace) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (workspace.role === "payee") return json({ error: "Insufficient permissions", code: "insufficient_permissions" }, 403);
  const params = new URL(request.url).searchParams;
  return json(await listNativeCampaignSummaries(workspace.org.id, {
    archived: params.get("archived") === "true",
    cursor: params.get("cursor"),
    limit: params.get("limit"),
  }));
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request); const session = token ? await getNativeSession(token) : null;
      throw session ? new HttpError("Workspace access removed", 403, "workspace_access_removed") : new HttpError("Authentication required", 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const input = await parseJson(request, nativeCampaignCreateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await createCampaign(actor.workspace.org.id, input, actor.userId), 201));
  } catch (error) { return handleApiError(error); }
};
