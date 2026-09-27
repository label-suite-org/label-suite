import { bearerToken, getNativeSession } from "../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../server/api";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";
import { createNativeContact, listNativeContacts, nativeContactCreateSchema, parseNativeContactList } from "../../../server/native-contacts";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Contact directory is unavailable to payees", 403);
    const params = new URL(request.url).searchParams;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeContacts(actor.workspace.org.id, parseNativeContactList({ limit: params.get("limit"), cursor: params.get("cursor"), query: params.get("query"), kind: params.get("kind") }))));
  } catch (error) { return handleApiError(error); }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "contacts.mutate")) throw new HttpError("Insufficient permissions", 403);
    const input = await parseJson(request, nativeContactCreateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await createNativeContact(actor.workspace.org.id, input, actor.userId), 201));
  } catch (error) { return handleApiError(error); }
};
