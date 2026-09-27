import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { listWorkspaceMembers } from "../../../../server/member-invitations";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { canonicalTask, executeNativeTaskAction, nativeTaskActionSchema } from "../../../../server/native-tasks";
import { hasCapability } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const taskId = params.id?.trim();
    if (!taskId) throw new HttpError("Task is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const detail = await canonicalTask(actor.workspace.org.id, taskId);
      const members = await listWorkspaceMembers(actor.workspace.org.id);
      return json({ ...detail, assignee_options: members.map(({ userId, name }) => ({ id: userId, name })) });
    });
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
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
    const taskId = params.id?.trim();
    if (!taskId) throw new HttpError("Task is required", 400);
    const input = await parseJson(request, nativeTaskActionSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await executeNativeTaskAction(actor.workspace.org.id, taskId, input, actor.userId)));
  } catch (error) {
    return handleApiError(error);
  }
};
