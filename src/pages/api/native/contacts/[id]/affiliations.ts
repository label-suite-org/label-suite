import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { hasCapability } from "../../../../../server/native-capabilities";
import { HttpError } from "../../../../../server/errors";
import { createContactOrganization } from "../../../../../server/contacts";
import { listNativeAffiliations, mutateNativeAffiliation, nativeAffiliationCreateSchema, nativeAffiliationUpdateSchema, nativeAffiliationDeleteSchema } from "../../../../../server/native-contact-affiliations";

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
    if (!id) throw new HttpError("Person ID is required", 400);
    const query = new URL(request.url).searchParams;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await listNativeAffiliations(actor.workspace.org.id, id, { id: query.get("id"), cursor: query.get("cursor") })));
  } catch (error) { return handleApiError(error); }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "contacts.mutate")) throw new HttpError("Insufficient permissions", 403);
    const id = params.id;
    if (!id) throw new HttpError("Person ID is required", 400);
    const input = await parseJson(request, nativeAffiliationCreateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await createContactOrganization(actor.workspace.org.id, { ...input, contact_id: id }, actor.userId), 201));
  } catch (error) { return handleApiError(error); }
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "contacts.mutate")) throw new HttpError("Insufficient permissions", 403);
    const id = params.id;
    if (!id) throw new HttpError("Person ID is required", 400);
    const input = await parseJson(request, nativeAffiliationUpdateSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await mutateNativeAffiliation(actor.workspace.org.id, id, input, actor.userId, false)));
  } catch (error) { return handleApiError(error); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "contacts.mutate")) throw new HttpError("Insufficient permissions", 403);
    const id = params.id;
    if (!id) throw new HttpError("Person ID is required", 400);
    const input = await parseJson(request, nativeAffiliationDeleteSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json(await mutateNativeAffiliation(actor.workspace.org.id, id, input, actor.userId, true)));
  } catch (error) { return handleApiError(error); }
};
