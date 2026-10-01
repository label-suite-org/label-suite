import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json } from "../../../server/api";
import { projectNativeSearch } from "../../../server/native-search";
import { searchRecords } from "../../../server/record-search";

export const prerender = false;

/** Read-only canonical search; actor resolution fixes both tenant and membership. */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (actor.workspace.role === "payee") return json({ error: "Search requires operator-workspace access", code: "insufficient_permissions" }, 403);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const records = await searchRecords(actor.workspace.org.id, url.searchParams.get("q"));
      return json(projectNativeSearch(records));
    });
  } catch (error) {
    return handleApiError(error);
  }
};
