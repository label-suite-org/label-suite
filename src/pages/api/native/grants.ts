import type { APIRoute } from "astro";
import { z } from "zod";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getNativeGrants, getNativeGrantChoices } from "../../../server/native-grants-query";
import { createNativeGrantApplication, updateNativeGrantApplication, mutateNativeGrantAttachments, nativeCreateGrantApplicationSchema, nativeUpdateGrantApplicationSchema, nativeGrantAttachmentsSchema, nativeGrantCatalogSchema, mutateNativeGrantCatalog } from "../../../server/native-grants";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";

export const prerender = false;
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_application"), input: nativeCreateGrantApplicationSchema }).strict(),
  z.object({ action: z.literal("update_application"), input: nativeUpdateGrantApplicationSchema }).strict(),
  z.object({ action: z.literal("update_catalog"), input: nativeGrantCatalogSchema }).strict(),
  z.object({ action: z.literal("update_attachments"), input: nativeGrantAttachmentsSchema }).strict(),
]);
async function actorFor(request: Request) {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = bearerToken(request), session = token ? await getNativeSession(token) : null;
    throw new HttpError(session ? "Workspace access removed" : "Authentication required", session ? 403 : 401, session ? "workspace_access_removed" : "authentication_required");
  }
  if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
  return actor;
}
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await actorFor(request);
    if (url.searchParams.has("choice_kind")) return privateResponse(json(await getNativeGrantChoices(actor.workspace.org.id, actor.userId, {
      kind: url.searchParams.get("choice_kind"), q: url.searchParams.get("q") ?? undefined, cursor: url.searchParams.get("cursor") ?? undefined, project_id: url.searchParams.get("project_id") ?? undefined,
    })));
    const snapshot = await getNativeGrants(actor.workspace.org.id, actor.userId, { grant_id: url.searchParams.get("grant") ?? undefined, application_id: url.searchParams.get("application") ?? undefined, offset: url.searchParams.get("offset") ?? undefined, worklist_offset: url.searchParams.get("worklist_offset") ?? undefined });
    return privateResponse(json({ ...snapshot, authority: { can_edit: hasCapability(actor.workspace.role, "fundraising.mutate"), can_attach: hasCapability(actor.workspace.role, "grant_documents.mutate") } }));
  } catch (error) { return privateResponse(handleApiError(error)); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request), body = await parseJson(request, mutation);
    const capability = body.action === "update_attachments" && body.input.action !== "replace_requirements" ? "grant_documents.mutate" : "fundraising.mutate";
    if (!hasCapability(actor.workspace.role, capability)) throw new HttpError("Insufficient permissions", 403);
    const result = body.action === "create_application"
      ? await createNativeGrantApplication(actor.workspace.org.id, actor.userId, body.input)
      : body.action === "update_application"
        ? await updateNativeGrantApplication(actor.workspace.org.id, actor.userId, body.input)
        : body.action === "update_catalog" ? await mutateNativeGrantCatalog(actor.workspace.org.id, actor.userId, body.input)
        : await mutateNativeGrantAttachments(actor.workspace.org.id, actor.userId, body.input);
    return privateResponse(json(result, body.action === "create_application" ? 201 : 200));
  } catch (error) { return privateResponse(handleApiError(error)); }
};
