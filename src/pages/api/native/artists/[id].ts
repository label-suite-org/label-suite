import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import {
  getArtistDetail,
  nativeUpdateArtistSchema,
  updateArtistForNative,
} from "../../../../server/artists";
import { projectNativeArtistDetail } from "../../../../server/native-artists";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { hasCapability } from "../../../../server/native-capabilities";
import { HttpError } from "../../../../server/errors";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const actor = await resolveNativeActor(request);
  if (!actor) return json({ error: "Authentication required" }, 401);
  const artistID = params.id?.trim();
  if (!artistID) return json({ error: "Artist is required" }, 400);

  return runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
    const detail = projectNativeArtistDetail(await getArtistDetail(actor.workspace.org.id, artistID));
    return detail ? json(detail) : json({ error: "Artist not found" }, 404);
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const artistID = params.id?.trim();
    if (!artistID) throw new HttpError("Artist is required", 400);
    const input = await parseJson(request, nativeUpdateArtistSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      await updateArtistForNative(actor.workspace.org.id, { ...input, id: artistID }, actor.userId);
      const detail = projectNativeArtistDetail(await getArtistDetail(actor.workspace.org.id, artistID));
      return detail ? json(detail) : json({ error: "Artist not found after update" }, 404);
    });
  } catch (error) {
    return handleApiError(error);
  }
};
