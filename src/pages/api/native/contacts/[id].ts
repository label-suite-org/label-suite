import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { hasCapability } from "../../../../server/native-capabilities";
import { HttpError } from "../../../../server/errors";
import { getNativeContactDetail, nativeContactUpdateSchema, updateNativeContact } from "../../../../server/native-contacts";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Contact directory is unavailable to payees", 403);
    const id = params.id;
    if (!id) throw new HttpError("Contact ID is required", 400);
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "person" && kind !== "organization") throw new HttpError("Contact identity kind is required", 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await getNativeContactDetail(actor.workspace.org.id, id, kind)));
  } catch (error) { return handleApiError(error); }
};

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "contacts.mutate")) throw new HttpError("Insufficient permissions", 403);
    const id = params.id;
    if (!id) throw new HttpError("Contact ID is required", 400);
    const input = await parseJson(request, nativeContactUpdateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await updateNativeContact(actor.workspace.org.id, id, input, actor.userId)));
  } catch (error) { return handleApiError(error); }
};
