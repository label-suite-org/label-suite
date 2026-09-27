import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json } from "../../../../server/api";
import { hasCapability } from "../../../../server/native-capabilities";
import { HttpError } from "../../../../server/errors";
import { completeResourceUpload, getResourceUpload } from "../../../../server/native-resource-uploads";
import { boundedMultipartRequest, MAX_UPLOAD_BYTES } from "../../../../server/upload-security";

export const prerender = false;
const handle: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate") && !hasCapability(actor.workspace.role, "grant_documents.mutate")) throw new HttpError("Insufficient permissions", 403);
    const id = params.id?.trim();
    if (!id) throw new HttpError("Upload is required", 400);
    const bytes = request.method === "PUT" ? new Uint8Array(await (await boundedMultipartRequest(request, MAX_UPLOAD_BYTES)).arrayBuffer()) : undefined;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const result = bytes === undefined ? await getResourceUpload(actor.workspace.org.id, actor.userId, id)
        : await completeResourceUpload(actor.workspace.org.id, actor.userId, id, bytes);
      const response = json(result);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    });
  } catch (error) { return handleApiError(error); }
};
export const GET: APIRoute = handle;
export const PUT: APIRoute = handle;
