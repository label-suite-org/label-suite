import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { nativeTaskCreateOptions, nativeTaskCreateSchema } from "../../../server/native-tasks";
import { createOpsTask } from "../../../server/ops-tasks";
import { hasCapability } from "../../../server/tenant";

export const prerender = false;

async function actorFor(request: Request) {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = bearerToken(request);
    const session = token ? await getNativeSession(token) : null;
    throw session ? new HttpError("Workspace access removed", 403, "workspace_access_removed") : new HttpError("Authentication required", 401);
  }
  if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
  return actor;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await nativeTaskCreateOptions(actor.workspace.org.id)));
  } catch (error) { return handleApiError(error); }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request);
    const input = await parseJson(request, nativeTaskCreateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await createOpsTask(actor.workspace.org.id, input, actor.userId), 201));
  } catch (error) { return handleApiError(error); }
};
