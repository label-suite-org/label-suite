import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { createArtistForNative, getArtistDetail, nativeCreateArtistSchema } from "../../../server/artists";
import { projectNativeArtistDetail } from "../../../server/native-artists";
import { handleApiError, json, parseJson } from "../../../server/api";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const input = await parseJson(request, nativeCreateArtistSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const row = await createArtistForNative(actor.workspace.org.id, input, actor.userId);
      const detail = projectNativeArtistDetail(await getArtistDetail(actor.workspace.org.id, row.id));
      return detail ? json(detail, 201) : json({ error: "Artist not found after create" }, 500);
    });
  } catch (error) {
    return handleApiError(error);
  }
};
