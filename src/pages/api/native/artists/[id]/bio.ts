import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { getNativeArtistBio, nativeArtistBioReviewSchema, reviewNativeArtistBio } from "../../../../../server/native-artist-bio";
import { hasCapability } from "../../../../../server/native-capabilities";

export const prerender = false;
const handle = (review: boolean): APIRoute => async ({ request, params }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request);
      const session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee" || (review && !hasCapability(actor.workspace.role, "operations.mutate"))) {
      throw new HttpError("Insufficient permissions", 403);
    }
    const id = params.id?.trim();
    if (!id) throw new HttpError("Artist is required", 400);
    const input = review ? await parseJson(request, nativeArtistBioReviewSchema) : null;
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const response = json(review ? await reviewNativeArtistBio(actor.workspace.org.id, id, actor.userId, input)
        : await getNativeArtistBio(actor.workspace.org.id, id));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    });
  } catch (error) { return handleApiError(error); }
};
export const GET = handle(false);
export const POST = handle(true);
