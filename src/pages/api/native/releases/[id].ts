import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { getReleaseDetail, nativeUpdateReleaseSchema, updateReleaseForNative } from "../../../../server/releases";
import { getReleaseTimeline } from "../../../../server/release-timeline";
import { projectNativeReleaseCampaigns, projectNativeReleaseDetail } from "../../../../server/native-releases";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { hasCapability } from "../../../../server/native-capabilities";
import { HttpError } from "../../../../server/errors";
import { getNativeReleaseProviderContext } from "../../../../server/native-release-provider-context";

import { listAuditEvents } from "../../../../server/integrations";
import { listCampaignsForRelease } from "../../../../server/campaigns";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const actor = await resolveNativeActor(request);
  if (!actor) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    const session = token ? await getNativeSession(token) : null;
    return session
      ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
      : json({ error: "Authentication required" }, 401);
  }
  if (actor.workspace.role === "payee") return json({ error: "Release provider context is not permitted for payee access", code: "insufficient_permissions" }, 403);
  const releaseID = params.id?.trim();
  if (!releaseID) return json({ error: "Release is required" }, 400);

  return runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
    const release = await getReleaseDetail(actor.workspace.org.id, releaseID);
    if (!release) return json({ error: "Release not found" }, 404);
    const [timeline, providerContext, linkedCampaigns, activity] = await Promise.all([
      getReleaseTimeline(actor.workspace.org.id, releaseID),
      getNativeReleaseProviderContext(actor.workspace.org.id, releaseID),
      listCampaignsForRelease(actor.workspace.org.id, releaseID),
      listAuditEvents(actor.workspace.org.id, { object_type: "release", object_id: releaseID, limit: 51 }),
    ]);
    const childReleases = timeline.phases.flatMap((phase) => phase.childReleases);
    return json({ ...projectNativeReleaseDetail({ ...release, timeline: { ...timeline, childReleases } }), activity: { items: activity.slice(0, 50).map((event) => ({ id: event.id, event_type: event.event_type, occurred_at: event.created_at?.toISOString() ?? null })), partial: activity.length > 50 }, provider_context: providerContext, campaigns: projectNativeReleaseCampaigns(linkedCampaigns), freshness: { state: "fresh", fetched_at: new Date().toISOString() } });
  });
};


export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      const session = token ? await getNativeSession(token) : null;
      return session
        ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403)
        : json({ error: "Authentication required" }, 401);
    }
    if (!hasCapability(actor.workspace.role, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const releaseID = params.id?.trim();
    if (!releaseID) throw new HttpError("Release is required", 400);
    const input = await parseJson(request, nativeUpdateReleaseSchema);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      await updateReleaseForNative(actor.workspace.org.id, { ...input, id: releaseID }, actor.userId);
      const release = await getReleaseDetail(actor.workspace.org.id, releaseID);
      if (!release) return json({ error: "Release not found after update" }, 404);
      const [timeline, providerContext, linkedCampaigns] = await Promise.all([
        getReleaseTimeline(actor.workspace.org.id, releaseID),
        getNativeReleaseProviderContext(actor.workspace.org.id, releaseID),
      listCampaignsForRelease(actor.workspace.org.id, releaseID),
      ]);
      const childReleases = timeline.phases.flatMap((phase) => phase.childReleases);
      return json({ ...projectNativeReleaseDetail({ ...release, timeline: { ...timeline, childReleases } }), provider_context: providerContext, campaigns: projectNativeReleaseCampaigns(linkedCampaigns), freshness: { state: "fresh", fetched_at: new Date().toISOString() } });
    });
  } catch (error) {
    return handleApiError(error);
  }
};
