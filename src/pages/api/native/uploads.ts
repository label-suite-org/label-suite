import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../server/api";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";
import { prepareResourceUpload, resourceUploadSchema } from "../../../server/native-resource-uploads";

export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    const input = await parseJson(request, resourceUploadSchema);
    if (!hasCapability(actor.workspace.role, input.context.kind === "grant_application" ? "grant_documents.mutate" : "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(await prepareResourceUpload(actor.workspace.org.id, actor.userId, input), 201);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    });
  } catch (error) { return handleApiError(error); }
};
