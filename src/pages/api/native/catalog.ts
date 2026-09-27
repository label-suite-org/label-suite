import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { listNativeCatalogEntries } from "../../../server/catalog";
import { projectNativeCatalog } from "../../../server/native-catalog";
import { handleApiError, json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") return json({ error: "Catalog requires operator-workspace access", code: "insufficient_permissions" }, 403);
    const params = new URL(request.url).searchParams;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const page = await listNativeCatalogEntries(actor.workspace.org.id, { query: params.get("query"), cursor: params.get("cursor"), limit: params.get("limit") });
      return json({ items: projectNativeCatalog(page.rows), total: page.total, has_more: page.has_more, next_cursor: page.next_cursor, query: page.query, refreshed_at: new Date().toISOString() });
    });
  } catch (error) {
    return handleApiError(error);
  }
};
