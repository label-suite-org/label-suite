import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../../server/api";
import { hasCapability } from "../../../../../../server/native-capabilities";
import { HttpError } from "../../../../../../server/errors";
import { updateNativeWorkRole, nativeRoleUpdateSchema } from "../../../../../../server/native-works";

export const prerender = false;
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
    const workId = params.id?.trim();
    if (!workId) throw new HttpError("Work is required", 400);
    const roleId = params.roleId?.trim();
    if (!roleId) throw new HttpError("Role is required", 400);
    const input = await parseJson(request, nativeRoleUpdateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await updateNativeWorkRole(actor.workspace.org.id, workId, roleId, input, actor.userId)));
  } catch (error) { return handleApiError(error); }
};
