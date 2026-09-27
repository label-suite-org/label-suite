import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { releases, tracks, works } from "../db/schema";
import { db } from "../lib/db";
import { z } from "zod";
import { updateTrack, updateTrackSchema } from "./tracks";
import { NotFoundError } from "./errors";

/** Release context is part of the route, not inferred from an unscoped Track ID. */
export async function listNativeTracks(orgId: string, releaseId: string) {
  const [release] = await db.select({ id: releases.id, title: releases.title }).from(releases)
    .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId))).limit(1);
  if (!release) throw new NotFoundError("Release not found");
  const rows = await db.select({
    ...getTableColumns(tracks), revision: sql<string>`${tracks.updated_at}::text`,
    work: { id: works.id, title: works.title, isrc: works.isrc },
  }).from(tracks).leftJoin(works, and(eq(works.org_id, orgId), eq(works.id, tracks.work_id)))
    .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, releaseId)))
    .orderBy(asc(tracks.position), asc(tracks.id));
  for (const row of rows) {
    if (row.work_id && !row.work) throw new NotFoundError("Linked Work not found in this workspace");
  }
  return { release, tracks: rows.map((row) => ({ record_type: "track" as const, ...row })) };
}

export async function getNativeTrack(orgId: string, releaseId: string | null, trackId: string) {
  if (releaseId === null) {
    const [track] = await db.select({
      ...getTableColumns(tracks), revision: sql<string>`${tracks.updated_at}::text`,
      work: { id: works.id, title: works.title, isrc: works.isrc },
    }).from(tracks).leftJoin(works, and(eq(works.org_id, orgId), eq(works.id, tracks.work_id)))
      .where(and(eq(tracks.org_id, orgId), eq(tracks.id, trackId), isNull(tracks.release_id))).limit(1);
    if (!track) throw new NotFoundError("Track without a Release not found");
    if (track.work_id && !track.work) throw new NotFoundError("Linked Work not found in this workspace");
    return { release: null, track: { record_type: "track" as const, ...track }, previous_track_id: null, next_track_id: null };
  }
  const sequence = await listNativeTracks(orgId, releaseId);
  const index = sequence.tracks.findIndex((track) => track.id === trackId);
  if (index < 0) throw new NotFoundError("Track not found in this Release");
  return {
    release: sequence.release, track: sequence.tracks[index],
    previous_track_id: sequence.tracks[index - 1]?.id ?? null,
    next_track_id: sequence.tracks[index + 1]?.id ?? null,
  };
}

export const nativeTrackUpdateSchema = updateTrackSchema.omit({ id: true, work_id: true })
  .extend({ expected_revision: z.string().trim().min(1) }).strict()
  .refine((input) => Object.keys(input).some((key) => key !== "expected_revision"), "At least one Track field is required");

export async function updateNativeTrack(orgId: string, releaseId: string | null, trackId: string, raw: unknown, actorUserId: string) {
  const { expected_revision, ...input } = nativeTrackUpdateSchema.parse(raw);
  await updateTrack(orgId, { ...input, id: trackId }, { releaseId, expectedRevision: expected_revision, actorUserId });
  return getNativeTrack(orgId, releaseId, trackId);
}
