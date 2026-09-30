import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { getNativeRoyaltyPage } from "../../../server/native-royalties";
import { hasCapability } from "../../../server/native-capabilities";

export const prerender = false;
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => json({
      ...await getNativeRoyaltyPage(actor.workspace.org.id, { release_id: url.searchParams.get("release") ?? undefined, section: url.searchParams.get("section") ?? undefined, offset: url.searchParams.get("offset") ?? undefined }),
      can_review_payouts: hasCapability(actor.workspace.role, "royalties.mutate"),
    }), { isolationLevel: "repeatable read" });
  } catch (error) { return handleApiError(error); }
};
