import { z } from "zod";
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { releases, roles, samply_comment_links, samply_files, tracks, works } from "../db/schema";
import { db } from "../lib/db";
import {
  assertIsrcAvailableForWork,
  generateISRC,
  maybeGenerateISRC,
  normalizeIsrcValue,
} from "../lib/isrc";
import { persistReleaseReadiness, persistTrackReadiness } from "../lib/readiness";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import {
  hasOwn,
  idSchema,
  nullableInteger,
  nullableText,
  optionalBoolean,
} from "./validation";

type DbClient = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export const createTrackSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  release_id: idSchema,
  work_id: nullableText,
  new_work_title: nullableText,
  position: nullableInteger({ min: 1 }),
  version: nullableText,
  isrc: nullableText,
  audio_url: nullableText,
  duration: nullableInteger({ min: 0 }),
  auto_isrc: optionalBoolean,
});

export const updateTrackSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1, "Title is required").optional(),
  position: nullableInteger({ min: 1 }),
  version: nullableText,
  isrc: nullableText,
  audio_url: nullableText,
  duration: nullableInteger({ min: 0 }),
  work_id: nullableText,
});

export const deleteTrackSchema = z.object({
  id: idSchema,
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type DeleteTrackInput = z.infer<typeof deleteTrackSchema>;

export async function listTracksForRelease(orgId: string, releaseId: string) {
  const trackRows = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.release_id, releaseId), eq(tracks.org_id, orgId)))
    .orderBy(asc(tracks.position));

  const workIds = [...new Set(trackRows.map((track) => track.work_id).filter((id): id is string => Boolean(id)))];
  const enteredByWork = new Map<string, { publishing: number; master: number }>();

  if (workIds.length) {
    const roleRows = await db
      .select({
        work_id: roles.work_id,
        ownership_type: roles.ownership_type,
        scope: roles.scope,
        percent_share: roles.percent_share,
      })
      .from(roles)
      .where(and(eq(roles.org_id, orgId), inArray(roles.work_id, workIds)));

    for (const role of roleRows) {
      if (!role.work_id || role.ownership_type === "Credit") continue;
      const current = enteredByWork.get(role.work_id) ?? { publishing: 0, master: 0 };
      const share = Number(role.percent_share ?? 0);
      if (role.scope === "Publishing" || role.scope === "Mechanical") current.publishing += share;
      if (role.scope === "Master") current.master += share;
      enteredByWork.set(role.work_id, current);
    }
  }

  return trackRows.map((track) => ({
    ...track,
    clearance_pub_entered: enteredByWork.get(track.work_id ?? "")?.publishing ?? 0,
    clearance_master_entered: enteredByWork.get(track.work_id ?? "")?.master ?? 0,
  }));
}

export async function listWorkOptions(orgId: string) {
  return db
    .select({ id: works.id, title: works.title, isrc: works.isrc })
    .from(works)
    .where(eq(works.org_id, orgId))
    .orderBy(asc(works.title));
}

export async function createTrack(orgId: string, input: CreateTrackInput) {
  return db.transaction(async (tx) => {
    await assertReleaseInOrg(tx, orgId, input.release_id);
    const work = await resolveWork(
      tx,
      orgId,
      input.title,
      input.work_id ?? null,
      input.new_work_title ?? null,
      input.isrc == null ? input.auto_isrc ?? true : false,
    );

    let trackIsrc = normalizeIsrcValue(work.isrc);
    const requestedIsrc = normalizeIsrcValue(input.isrc);
    if (requestedIsrc) {
      const workIsrc = normalizeIsrcValue(work.isrc);
      if (workIsrc && workIsrc !== requestedIsrc) {
        throw new ConflictError("The supplied ISRC conflicts with the linked work ISRC");
      }
      trackIsrc = await assertIsrcAvailableForWork(tx, orgId, requestedIsrc, work.id);
      if (workIsrc !== trackIsrc) {
        await tx
          .update(works)
          .set({ isrc: trackIsrc, updated_at: new Date() })
          .where(and(eq(works.id, work.id), eq(works.org_id, orgId)));
      }
    } else if (work.isrc && work.isrc !== trackIsrc) {
      await tx
        .update(works)
        .set({ isrc: trackIsrc, updated_at: new Date() })
        .where(and(eq(works.id, work.id), eq(works.org_id, orgId)));
    }
    let audioUrl = input.audio_url ?? null;
    let duration = input.duration ?? null;

    if (work.id && (!audioUrl || duration == null)) {
      const workRow = (
        await tx
          .select({ audio_url: works.audio_url, duration: works.duration })
          .from(works)
          .where(and(eq(works.id, work.id), eq(works.org_id, orgId)))
      )[0];

      if (!audioUrl && workRow?.audio_url) audioUrl = workRow.audio_url;
      if (duration == null && workRow?.duration != null) duration = workRow.duration;
    }

    const id = crypto.randomUUID();
    await tx.insert(tracks).values({
      id,
      org_id: orgId,
      title: input.title,
      release_id: input.release_id,
      work_id: work.id,
      position: input.position ?? null,
      version: input.version ?? "Main",
      isrc: trackIsrc,
      audio_url: audioUrl,
      duration,
    });

    await persistTrackReadiness(id, tx, orgId);
    await persistReleaseReadiness(input.release_id, tx, orgId);

    return { id, work_id: work.id, work_isrc: work.isrc, ok: true };
  });
}

export async function updateTrack(orgId: string, input: UpdateTrackInput, native?: {
  releaseId: string | null; expectedRevision: string; actorUserId: string;
}) {
  return db.transaction(async (tx) => {
    const existing = (
      await tx.select({ ...getTableColumns(tracks), revision: sql<string>`${tracks.updated_at}::text` }).from(tracks).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId))).for("update")
    )[0];

    if (!existing) {
      throw new NotFoundError("Track not found");
    }

    if (native && existing.release_id !== native.releaseId) throw new NotFoundError("Track not found in this Release");
    if (native && existing.revision !== native.expectedRevision) throw new ConflictError("Track changed elsewhere. Refresh before saving.");
    const updates: Record<string, unknown> = {};
    if (hasOwn(input, "title")) updates.title = input.title;
    if (hasOwn(input, "position")) updates.position = input.position;
    if (hasOwn(input, "version")) updates.version = input.version;
    if (hasOwn(input, "audio_url")) updates.audio_url = input.audio_url;
    if (hasOwn(input, "duration")) updates.duration = input.duration;

    const workId = hasOwn(input, "work_id") ? input.work_id : existing.work_id;
    const hasRequestedIsrc = hasOwn(input, "isrc");
    const requestedIsrc = hasRequestedIsrc ? normalizeIsrcValue(input.isrc) : null;

    if (hasOwn(input, "work_id")) {
      updates.work_id = input.work_id;
    }

    if (workId) {
      const workRows = await tx
        .select({ id: works.id, isrc: works.isrc })
        .from(works)
        .where(and(eq(works.id, workId), eq(works.org_id, orgId)));

      if (!workRows.length) {
        throw new NotFoundError("Work not found");
      }

      const workIsrc = normalizeIsrcValue(workRows[0].isrc);
      if (requestedIsrc && workIsrc && requestedIsrc !== workIsrc) {
        throw new ConflictError("The supplied ISRC conflicts with the linked work ISRC");
      }

      if (native && hasRequestedIsrc && requestedIsrc !== workIsrc) {
        throw new ConflictError("Edit the linked Work to change its ISRC. Track edits cannot change Work identifiers.");
      }
      const nextIsrc = workIsrc ?? requestedIsrc ?? normalizeIsrcValue(existing.isrc);
      if (nextIsrc) {
        const safeIsrc = await assertIsrcAvailableForWork(tx, orgId, nextIsrc, workRows[0].id, input.id);
        updates.isrc = safeIsrc;
        if (!native && workIsrc !== safeIsrc) {
          await tx
            .update(works)
            .set({ isrc: safeIsrc, updated_at: new Date() })
            .where(and(eq(works.id, workRows[0].id), eq(works.org_id, orgId)));
        }
      } else if (hasRequestedIsrc) {
        updates.isrc = null;
      }
    } else if (hasOwn(input, "work_id") || hasRequestedIsrc) {
      if (requestedIsrc) {
        throw new ConflictError("Link a work before assigning an ISRC");
      }
      updates.isrc = null;
    }

    if (Object.keys(updates).length) await tx.update(tracks).set(updates).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId)));
    await persistTrackReadiness(input.id, tx, orgId);

    const updated = (
      await tx.select({ release_id: tracks.release_id }).from(tracks).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId)))
    )[0];

    if (updated?.release_id) {
      await persistReleaseReadiness(updated.release_id, tx, orgId);
    }

    const [saved] = await tx.update(tracks).set({
      updated_at: sql`greatest(clock_timestamp(), ${existing.revision}::timestamp + interval '1 microsecond')`,
    }).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId))).returning();
    if (native) await recordAuditEvent(orgId, {
      actor_user_id: native.actorUserId, event_type: "track.updated", object_type: "track", object_id: input.id,
      before: trackAudit(existing), after: trackAudit(saved),
    }, tx);
    return { ok: true };
  });
}

export async function deleteTrack(orgId: string, input: DeleteTrackInput) {
  return db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(tracks).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId)))
    )[0];

    if (!existing) {
      throw new NotFoundError("Track not found");
    }

    await tx.delete(samply_comment_links).where(and(
      eq(samply_comment_links.track_id, input.id),
      eq(samply_comment_links.org_id, orgId),
    ));
    await tx.delete(samply_files).where(and(
      eq(samply_files.track_id, input.id),
      eq(samply_files.org_id, orgId),
    ));
    await tx.delete(tracks).where(and(eq(tracks.id, input.id), eq(tracks.org_id, orgId)));

    if (existing.release_id) {
      await persistReleaseReadiness(existing.release_id, tx, orgId);
    }

    return { ok: true };
  });
}

async function resolveWork(
  client: DbClient,
  orgId: string,
  trackTitle: string,
  workId: string | null,
  newWorkTitle: string | null,
  autoIsrc: boolean,
): Promise<{ id: string; isrc: string | null }> {
  if (workId) {
    const rows = await client
      .select({ id: works.id, isrc: works.isrc })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Work not found");
    }

    return { id: rows[0].id, isrc: rows[0].isrc ?? null };
  }

  if (newWorkTitle) {
    const id = crypto.randomUUID();
    const isrc = autoIsrc ? await maybeGenerateISRC(orgId, undefined, client) : null;
    await client.insert(works).values({ id, org_id: orgId, title: newWorkTitle, isrc });
    return { id, isrc };
  }

  const normalized = trackTitle.trim();
  const existing = await client
    .select({ id: works.id, isrc: works.isrc })
    .from(works)
    .where(and(eq(works.title, normalized), eq(works.org_id, orgId)));

  if (existing.length) {
    return {
      id: existing[0].id,
      isrc: existing[0].isrc ?? (autoIsrc ? await generateAndSetWorkIsrc(client, orgId, existing[0].id) : null),
    };
  }

  const id = crypto.randomUUID();
  const isrc = autoIsrc ? await maybeGenerateISRC(orgId, undefined, client) : null;
  await client.insert(works).values({ id, org_id: orgId, title: normalized, isrc });
  return { id, isrc };
}

async function generateAndSetWorkIsrc(
  client: DbClient,
  orgId: string,
  workId: string,
): Promise<string> {
  const isrc = await generateISRC(orgId, undefined, client);
  await client.update(works).set({ isrc }).where(and(eq(works.id, workId), eq(works.org_id, orgId)));
  return isrc;
}

async function assertReleaseInOrg(
  client: DbClient,
  orgId: string,
  releaseId: string,
): Promise<void> {
  const rows = await client
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId)));

  if (!rows.length) {
    throw new NotFoundError("Release not found");
  }
}

function trackAudit(row: typeof tracks.$inferSelect) {
  return { id: row.id, release_id: row.release_id, work_id: row.work_id, title: row.title,
    position: row.position, version: row.version, isrc: row.isrc, duration: row.duration,
    audio_url: row.audio_url, updated_at: row.updated_at?.toISOString() ?? null };
}
