import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { and, asc, eq } from "drizzle-orm";
import { artists, releases, project_events } from "../../../db/schema";
import { db, runWithDatabaseContext } from "../../../lib/db";
import { json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { listFanDrops, saveFanDrop, publishFanDrop, fanAudience } from "../../../server/fan-drops";
import { canonicalAppOrigin } from "../../../server/request-security";
import { publicDropPath } from "../../../server/fan-drops";
import { writeAuditLog } from "../../../server/audit";
import { fanEmailEnabled, fanId } from "../../../server/fan-drops-core";
import { readFanJson, handleFanError } from "../../../server/fan-request";
import { listFanMessages, saveFanMessage, previewFanMessage, scheduleFanMessage, cancelFanMessage, reconcileFanMessage } from "../../../server/fan-messages";
import { listFans, fanHistory, tagFan } from "../../../server/fan-feedback";
import { z } from "zod";
export const prerender = false;
async function actorFor(request: Request) {
  const actor = await resolveNativeActor(request);
  if (!actor) throw new HttpError("Workspace access unavailable", 403, "workspace_access_removed");
  if (!["owner", "operator"].includes(actor.workspace.role)) throw new HttpError("Operator access required", 403);
  return actor;
}
export const GET: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request);
    return json(await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const params = new URL(request.url).searchParams;
      if (params.get("history")) return fanHistory(actor.workspace.org.id, params.get("history")!);
      if (params.get("fans")) return { fans: await listFans(actor.workspace.org.id, params.get("fans")!) };
      if (params.get("artist_id")) {
        const audience = await fanAudience(actor.workspace.org.id, { artist_id: params.get("artist_id"), ...(params.get("drop_id") ? { drop_id: params.get("drop_id") } : {}), ...(params.get("city") ? { city: params.get("city") } : {}), ...(params.get("tag") ? { tag: params.get("tag") } : {}) });
        return { audience: audience.slice(0, 100), count: audience.length, truncated: audience.length > 100, limit_exceeded: audience.length > 10000 };
      }
      const orgId = actor.workspace.org.id;
      const scope = params.get("scope_artist") ? fanId.parse(params.get("scope_artist")) : undefined;
      return { artists: await db.select({ id: artists.id, name: artists.name, image_url: artists.image_url }).from(artists).where(and(eq(artists.org_id, orgId), scope ? eq(artists.id, scope) : undefined)).orderBy(asc(artists.name)).limit(500),
        releases: await db.select({ id: releases.id, artist_id: releases.artist_id, title: releases.title, cover_art_url: releases.cover_art_url }).from(releases).where(and(eq(releases.org_id, orgId), scope ? eq(releases.artist_id, scope) : undefined)).orderBy(asc(releases.title)).limit(500),
        shows: await db.select({ id: project_events.id, artist_id: project_events.artist_id, title: project_events.title, start_date: project_events.start_date, city: project_events.city }).from(project_events).where(and(eq(project_events.org_id, orgId), scope ? eq(project_events.artist_id, scope) : undefined)).orderBy(asc(project_events.start_date)).limit(500),
        public_base_url: canonicalAppOrigin(),
        drops: (await listFanDrops(orgId, scope)).map(drop => ({ ...drop, public_url: new URL(publicDropPath(orgId, drop.slug), canonicalAppOrigin()).toString() })), messages: await listFanMessages(orgId, scope), email_enabled: fanEmailEnabled(), broadcast_enabled: process.env.FAN_BROADCAST_ENABLED === "true" && process.env.FAN_BREVO_ORG_ID === actor.workspace.org.id };
    }));
  } catch (error) { return nativeError(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    const actor = await actorFor(request);
    const input = z.object({ action: z.enum(["save", "publish", "message_save", "message_preview", "message_schedule", "message_cancel", "message_reconcile", "tag"]), input: z.unknown() }).strict().parse(await readFanJson(request));
    if (["publish", "message_schedule", "message_cancel"].includes(input.action) && actor.workspace.role !== "owner") throw new HttpError("Owner access required for publication or delivery", 403);
    const actions = { save: saveFanDrop, publish: publishFanDrop, message_save: saveFanMessage, message_preview: previewFanMessage, message_schedule: scheduleFanMessage, message_cancel: cancelFanMessage, message_reconcile: reconcileFanMessage, tag: tagFan };
    return json(await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async (): Promise<unknown> => {
      const result = await actions[input.action](actor.workspace.org.id, input.input);
      if (input.action !== "message_preview" && "id" in result) await writeAuditLog({ orgId: actor.workspace.org.id, actorUserId: actor.userId, action: `fans.${input.action}`, entityType: "fan_management", entityId: result.id });
      return result;
    }));
  } catch (error) { return nativeError(error); }
};

async function nativeError(error: unknown) {
  const response = handleFanError(error);
  const body = await response.json() as { error: string; code?: string; request_id?: string };
  return json({ error: { message: body.error, code: body.code }, request_id: body.request_id }, response.status);
}
