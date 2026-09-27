import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../../server/api";
import { hasCapability } from "../../../../../../server/native-capabilities";
import { HttpError } from "../../../../../../server/errors";
import { changeNativeResourceContext, nativeResourceKind, nativeResourceLinkSchema } from "../../../../../../server/native-assets";

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
    const id = params.id?.trim();
    const kind = nativeResourceKind.parse(params.kind);
    if (!id) throw new HttpError("Resource is required", 400);
    const input = await parseJson(request, nativeResourceLinkSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await changeNativeResourceContext(actor.workspace.org.id, kind, id, input, actor.userId));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    });
  } catch (error) { return handleApiError(error); }
};
