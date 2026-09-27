import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { listReleaseRoster } from "../../../server/releases";
import { listReleaseTimelinePhases } from "../../../server/release-timeline";
import { NATIVE_RELEASE_PIPELINE_LIMIT, projectNativeReleasePipeline } from "../../../server/native-releases";
import { json } from "../../../server/api";

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
