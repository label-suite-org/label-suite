import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { createReleaseForNative, listReleaseRoster, nativeCreateReleaseSchema } from "../../../server/releases";
import { listReleaseTimelinePhases } from "../../../server/release-timeline";
import { NATIVE_RELEASE_PIPELINE_LIMIT, projectNativeReleasePipeline } from "../../../server/native-releases";
import { handleApiError, json, parseJson } from "../../../server/api";
import { hasCapability } from "../../../server/native-capabilities";
import { HttpError } from "../../../server/errors";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const actor = await resolveNativeActor(request);
  if (!actor) return json({ error: "Authentication required" }, 401);
  return runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
    const rows = await listReleaseRoster(actor.workspace.org.id);
    const boundedRows = rows.slice(0, NATIVE_RELEASE_PIPELINE_LIMIT);
    const phases = await listReleaseTimelinePhases(actor.workspace.org.id, boundedRows);
    return json({ items: projectNativeReleasePipeline(boundedRows, phases), total: rows.length, has_more: rows.length > boundedRows.length, refreshed_at: new Date().toISOString() });
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const input = await parseJson(request, nativeCreateReleaseSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const result = await createReleaseForNative(actor.workspace.org.id, input, actor.userId);
      return json(result, result.repeated ? 200 : 201);
    });
  } catch (error) {
    return handleApiError(error);
  }
};
