import { z } from "zod";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  budget_line_items,
  calls,
  campaigns,
  catalog_entries,
  documents,
  dsp_pitch_releases,
  dsp_pitches,
  media_assets,
  ops_tasks,
  release_reporting,
  releases,
  royalties_revenue,
  samply_comment_links,
  samply_files,
  samply_players,
  samply_projects,
  side_artists,
  tracks,
  artists,
} from "../db/schema";
import { db } from "../lib/db";
import { persistReleaseReadiness } from "../lib/readiness";
import {
  archiveReleaseCatalogEntry,
  syncReleaseCatalogEntry,
} from "./catalog";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { hasOwn, idSchema, nullableText } from "./validation";

const releaseBaseSchema = {
  title: z.string().trim().min(1, "Title is required"),
  artist_id: nullableText,
  parent_release_id: nullableText,
  release_date: nullableText,
  format: nullableText,
  upc_ean: nullableText,
  cover_art_url: nullableText,
  status: nullableText,
  delivery_status: nullableText,
  exploitation_scope: nullableText,
  notes: nullableText,
};

export const createReleaseSchema = z.object({
  id: idSchema.optional(),
  title: releaseBaseSchema.title,
  artist_id: releaseBaseSchema.artist_id,
  parent_release_id: releaseBaseSchema.parent_release_id,
  release_date: releaseBaseSchema.release_date,
  format: releaseBaseSchema.format,
  upc_ean: releaseBaseSchema.upc_ean,
  cover_art_url: releaseBaseSchema.cover_art_url,
  status: releaseBaseSchema.status,
});

export const updateReleaseSchema = z.object(releaseBaseSchema).partial().extend({ id: idSchema });

/** Native clients submit every editable release field except the canonical ID. */
export const nativeUpdateReleaseSchema = z.object(releaseBaseSchema).partial().extend({
  expected_updated_at: z.string().datetime(),
}).strict();

export const deleteReleaseSchema = z.object({
  id: idSchema,
});

export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;
export type UpdateReleaseInput = z.infer<typeof updateReleaseSchema>;
export type NativeUpdateReleaseInput = z.infer<typeof nativeUpdateReleaseSchema> & { id: string };
export type DeleteReleaseInput = z.infer<typeof deleteReleaseSchema>;

export interface ReleaseRosterRow {
  catalog_number: string | null;
  catalog_number_locked: boolean;
  id: string;
  title: string;
  format: string | null;
  status: string | null;
  delivery_status: string | null;
  release_date: string | null;
  upc_ean: string | null;
  cover_art_url: string | null;
  release_ready: boolean | null;
  release_missing: string | null;
  artist_id: string | null;
  parent_release_id?: string | null;
  artist_name: string | null;
  track_count: number;
  ready_track_count: number;
  audio_ready_count: number;
  isrc_ready_count: number;
  avg_clearance: number;
  pitch_count: number;
  sent_pitch_count: number;
  approved_pitch_count: number;
  budget_item_count: number;
  budget_planned: number;
  budget_committed: number;
  budget_paid: number;
  missing_release_fields: string[];
}

export async function listReleases(orgId: string) {
  return db
    .select({
      id: releases.id,
      title: releases.title,
      format: releases.format,
      status: releases.status,
      release_date: releases.release_date,
      upc_ean: releases.upc_ean,
      cover_art_url: releases.cover_art_url,
      release_ready: releases.release_ready,
      artist_id: releases.artist_id,
      parent_release_id: releases.parent_release_id,
      artist_name: artists.name,
    })
    .from(releases)
    .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(eq(releases.org_id, orgId))
    .orderBy(desc(releases.release_date));
}

export async function listReleaseRoster(orgId: string): Promise<ReleaseRosterRow[]> {
  const rows = await db.execute<{
    id: string;
    title: string;
    catalog_number: string | null;
    catalog_number_locked: boolean;
    format: string | null;
    status: string | null;
    delivery_status: string | null;
    release_date: string | null;
    upc_ean: string | null;
    cover_art_url: string | null;
    release_ready: boolean | null;
    release_missing: string | null;
    artist_id: string | null;
    parent_release_id: string | null;
    artist_name: string | null;
    track_count: string | number;
    ready_track_count: string | number;
    audio_ready_count: string | number;
    isrc_ready_count: string | number;
    avg_clearance: string | number;
    pitch_count: string | number;
    sent_pitch_count: string | number;
    approved_pitch_count: string | number;
    budget_item_count: string | number;
    budget_planned: string | number;
    budget_committed: string | number;
    budget_paid: string | number;
  }>(sql`
    with track_rollup as (
      select
        release_id,
        count(*)::int as track_count,
        count(*) filter (where track_ready is true)::int as ready_track_count,
        count(*) filter (where audio_url is not null and audio_url <> '')::int as audio_ready_count,
        count(*) filter (where isrc is not null and isrc <> '')::int as isrc_ready_count,
        coalesce(avg(clearance_progress), 0)::numeric as avg_clearance
      from label_suite.tracks
      where org_id = ${orgId}
        and release_id is not null
      group by release_id
    ),
    pitch_rollup as (
      select
        dpr.release_id,
        count(distinct dp.id)::int as pitch_count,
        count(distinct dp.id) filter (where coalesce(dp.status, '') in ('sent', 'responded', 'approved'))::int as sent_pitch_count,
        count(distinct dp.id) filter (where coalesce(dp.status, '') = 'approved')::int as approved_pitch_count
      from label_suite.dsp_pitch_releases dpr
      inner join label_suite.dsp_pitches dp
        on dp.id = dpr.dsp_pitch_id
       and dp.org_id = ${orgId}
      where dpr.org_id = ${orgId}
      group by dpr.release_id
    ),
    budget_rollup as (
      select
        coalesce(bli.release_id, bp.release_id) as release_id,
        count(*)::int as budget_item_count,
        coalesce(sum(coalesce(bli.planned_amount, bli.amount, 0)), 0)::numeric as budget_planned,
        coalesce(sum(coalesce(bli.committed_amount, 0)), 0)::numeric as budget_committed,
        coalesce(sum(coalesce(bli.paid_amount, 0)), 0)::numeric as budget_paid
      from label_suite.budget_line_items bli
      left join label_suite.budget_projects bp
        on bp.id = bli.project_id
       and bp.org_id = ${orgId}
      where bli.org_id = ${orgId}
        and coalesce(bli.release_id, bp.release_id) is not null
      group by coalesce(bli.release_id, bp.release_id)
    )
    select
      r.id,
      r.title,
      ce.catalog_number,
      coalesce(ce.catalog_number_locked, false) as catalog_number_locked,
      r.format,
      r.status,
      r.delivery_status,
      r.release_date,
      r.upc_ean,
      r.cover_art_url,
      r.release_ready,
      r.release_missing,
      r.artist_id,
      r.parent_release_id,
      a.name as artist_name,
      coalesce(tr.track_count, 0)::int as track_count,
      coalesce(tr.ready_track_count, 0)::int as ready_track_count,
      coalesce(tr.audio_ready_count, 0)::int as audio_ready_count,
      coalesce(tr.isrc_ready_count, 0)::int as isrc_ready_count,
      coalesce(tr.avg_clearance, 0)::numeric as avg_clearance,
      coalesce(pr.pitch_count, 0)::int as pitch_count,
      coalesce(pr.sent_pitch_count, 0)::int as sent_pitch_count,
      coalesce(pr.approved_pitch_count, 0)::int as approved_pitch_count,
      coalesce(br.budget_item_count, 0)::int as budget_item_count,
      coalesce(br.budget_planned, 0)::numeric as budget_planned,
      coalesce(br.budget_committed, 0)::numeric as budget_committed,
      coalesce(br.budget_paid, 0)::numeric as budget_paid
    from label_suite.releases r
    left join label_suite.artists a
      on a.id = r.artist_id
     and a.org_id = ${orgId}
    left join label_suite.catalog_entries ce
      on ce.release_id = r.id
     and ce.entry_type = 'release'
     and ce.org_id = ${orgId}
    left join track_rollup tr on tr.release_id = r.id
    left join pitch_rollup pr on pr.release_id = r.id
    left join budget_rollup br on br.release_id = r.id
    where r.org_id = ${orgId}
    order by r.release_date desc nulls last, r.title asc
  `);

  return (rows.rows ?? []).map((row) => ({
    ...row,
    catalog_number: row.catalog_number ?? null,
    catalog_number_locked: Boolean(row.catalog_number_locked),
    track_count: Number(row.track_count ?? 0),
    ready_track_count: Number(row.ready_track_count ?? 0),
    audio_ready_count: Number(row.audio_ready_count ?? 0),
    isrc_ready_count: Number(row.isrc_ready_count ?? 0),
    avg_clearance: Number(row.avg_clearance ?? 0),
    pitch_count: Number(row.pitch_count ?? 0),
    sent_pitch_count: Number(row.sent_pitch_count ?? 0),
    approved_pitch_count: Number(row.approved_pitch_count ?? 0),
    budget_item_count: Number(row.budget_item_count ?? 0),
    budget_planned: Number(row.budget_planned ?? 0),
    budget_committed: Number(row.budget_committed ?? 0),
    budget_paid: Number(row.budget_paid ?? 0),
    missing_release_fields: missingReleaseFields(row),
  }));
}

function missingReleaseFields(row: {
  artist_id: string | null;
  format: string | null;
  release_date: string | null;
  upc_ean: string | null;
  cover_art_url: string | null;
  track_count: string | number;
  ready_track_count: string | number;
  pitch_count: string | number;
}): string[] {
  const missing: string[] = [];
  const trackCount = Number(row.track_count ?? 0);
  const readyTrackCount = Number(row.ready_track_count ?? 0);
  if (!row.artist_id) missing.push("artist");
  if (!row.format) missing.push("format");
  if (!row.release_date) missing.push("date");
  if (!row.upc_ean) missing.push("UPC/EAN");
  if (!row.cover_art_url) missing.push("cover");
  if (!trackCount) missing.push("tracks");
  if (trackCount > 0 && readyTrackCount < trackCount) missing.push("track readiness");
  if (!Number(row.pitch_count ?? 0)) missing.push("DSP pitch");
  return missing;
}

export async function listReleaseOptions(orgId: string) {
  return db
    .select({ id: releases.id, title: releases.title })
    .from(releases)
    .where(eq(releases.org_id, orgId))
    .orderBy(asc(releases.title));
}

export async function getReleaseDetail(orgId: string, id: string) {
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      catalog_number: catalog_entries.catalog_number,
      catalog_number_locked: catalog_entries.catalog_number_locked,
      format: releases.format,
      release_date: releases.release_date,
      upc_ean: releases.upc_ean,
      cover_art_url: releases.cover_art_url,
      updated_at: releases.updated_at,
      release_ready: releases.release_ready,
      release_missing: releases.release_missing,
      status: releases.status,
      artist_id: releases.artist_id,
      parent_release_id: releases.parent_release_id,
      artist_name: artists.name,
    })
    .from(releases)
    .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(catalog_entries, and(
      eq(catalog_entries.release_id, releases.id),
      eq(catalog_entries.org_id, orgId),
      eq(catalog_entries.entry_type, "release"),
    ))
    .where(and(eq(releases.id, id), eq(releases.org_id, orgId)));

  return rows[0] ?? null;
}

export async function createRelease(orgId: string, input: CreateReleaseInput) {
  return db.transaction(async (tx) => {
    const id = input.id ?? crypto.randomUUID();
    const format = input.format ?? "single";
    if (input.artist_id) {
      await assertArtistInOrg(tx, orgId, input.artist_id);
    }
    if (input.parent_release_id) {
      assertSingleCanHaveParent(format);
      await assertParentReleaseInOrg(tx, orgId, input.parent_release_id, id);
    }

    await tx.insert(releases).values({
      id,
      org_id: orgId,
      title: input.title,
      artist_id: input.artist_id ?? null,
      parent_release_id: input.parent_release_id ?? null,
      release_date: input.release_date ?? null,
      format,
      upc_ean: input.upc_ean ?? null,
      cover_art_url: input.cover_art_url ?? null,
      status: input.status ?? "draft",
    }).onConflictDoNothing({ target: releases.id });

    await syncReleaseCatalogEntry(tx, orgId, id, { allowMissing: true });
    await persistReleaseReadiness(id, tx, orgId);

    return { id, ok: true };
  });
}

export async function updateRelease(orgId: string, input: UpdateReleaseInput) {
  return updateReleaseInternal(orgId, input);
}

/** Native writes are revision-aware and actor-attributed while sharing web validation. */
export async function updateReleaseForNative(orgId: string, input: NativeUpdateReleaseInput, actorUserId: string) {
  return updateReleaseInternal(orgId, input, { expectedUpdatedAt: input.expected_updated_at, actorUserId });
}

async function updateReleaseInternal(
  orgId: string,
  input: UpdateReleaseInput | NativeUpdateReleaseInput,
  native?: { expectedUpdatedAt: string; actorUserId: string },
) {
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(releases)
      .where(and(eq(releases.id, input.id), eq(releases.org_id, orgId))))[0];
    if (!current) throw new NotFoundError("Release not found");
    if (native) {
      const expected = new Date(native.expectedUpdatedAt);
      if (!current.updated_at || current.updated_at.getTime() !== expected.getTime()) {
        throw new ConflictError("Release changed while updating; refresh and retry");
      }
    }

    const updates: Partial<typeof releases.$inferInsert> = {
      updated_at: native && current.updated_at
        ? new Date(Math.max(Date.now(), current.updated_at.getTime() + 1))
        : new Date(),
    };
    if (hasOwn(input, "title")) updates.title = input.title as string;
    if (hasOwn(input, "artist_id")) updates.artist_id = input.artist_id as string | null;
    if (hasOwn(input, "parent_release_id")) updates.parent_release_id = input.parent_release_id as string | null;
    if (hasOwn(input, "release_date")) updates.release_date = input.release_date as string | null;
    if (hasOwn(input, "format")) updates.format = input.format as string | null;
    if (hasOwn(input, "upc_ean")) updates.upc_ean = input.upc_ean as string | null;
    if (hasOwn(input, "cover_art_url")) updates.cover_art_url = input.cover_art_url as string | null;
    if (hasOwn(input, "status")) updates.status = input.status as string | null;
    if (hasOwn(input, "delivery_status")) updates.delivery_status = input.delivery_status as string | null;
    if (hasOwn(input, "exploitation_scope")) updates.exploitation_scope = input.exploitation_scope as string | null;
    if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;
    if (updates.artist_id) await assertArtistInOrg(tx, orgId, updates.artist_id);
    const effectiveFormat = hasOwn(input, "format") ? input.format as string | null | undefined : current.format;
    const effectiveParentId = hasOwn(input, "parent_release_id") ? input.parent_release_id as string | null | undefined : current.parent_release_id;
    if (effectiveParentId) {
      if (!isSingleFormat(effectiveFormat)) {
        if (hasOwn(input, "parent_release_id")) assertSingleCanHaveParent(effectiveFormat);
        updates.parent_release_id = null;
      } else await assertParentReleaseInOrg(tx, orgId, effectiveParentId, input.id);
    }

    const conditions = [eq(releases.id, input.id), eq(releases.org_id, orgId)];
    if (native && current.updated_at) conditions.push(sql`date_trunc('milliseconds', ${releases.updated_at}) = ${current.updated_at.toISOString()}::timestamp`);
    const updated = await tx.update(releases).set(updates).where(and(...conditions)).returning();
    const row = updated[0];
    if (!row) {
      if (native) throw new ConflictError("Release changed while updating; refresh and retry");
      throw new NotFoundError("Release not found");
    }

    await persistReleaseReadiness(input.id, tx, orgId);
    await syncReleaseCatalogEntry(tx, orgId, input.id, { allowMissing: true });
    if (native) await recordAuditEvent(orgId, {
      actor_user_id: native.actorUserId, event_type: "release.updated", object_type: "release", object_id: row.id,
      before: releaseAuditData(current), after: releaseAuditData(row),
    }, tx);
    return native ? row : { ok: true };
  });
}

function releaseAuditData(row: typeof releases.$inferSelect): Record<string, unknown> {
  return {
    id: row.id, org_id: row.org_id, title: row.title, artist_id: row.artist_id,
    parent_release_id: row.parent_release_id, release_date: row.release_date, format: row.format,
    upc_ean: row.upc_ean, cover_art_url: row.cover_art_url, status: row.status,
    delivery_status: row.delivery_status, exploitation_scope: row.exploitation_scope, notes: row.notes,
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}

export async function deleteRelease(orgId: string, input: DeleteReleaseInput) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.id, input.id), eq(releases.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Release not found");
    }

    const releaseTrackRows = await tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.release_id, input.id), eq(tracks.org_id, orgId)));

    const releaseTrackIds = releaseTrackRows.map((row) => row.id);
    const releaseProjectRows = await tx
      .select({ id: samply_projects.id })
      .from(samply_projects)
      .where(and(eq(samply_projects.release_id, input.id), eq(samply_projects.org_id, orgId)));

    const releaseProjectIds = releaseProjectRows.map((row) => row.id);

    const replacementPitchLinks = await tx
      .select({
        pitch_id: dsp_pitches.id,
        release_id: dsp_pitch_releases.release_id,
      })
      .from(dsp_pitches)
      .innerJoin(dsp_pitch_releases, and(
        eq(dsp_pitch_releases.dsp_pitch_id, dsp_pitches.id),
        eq(dsp_pitch_releases.org_id, orgId),
        ne(dsp_pitch_releases.release_id, input.id),
      ))
      .where(and(eq(dsp_pitches.release_id, input.id), eq(dsp_pitches.org_id, orgId)));

    for (const link of replacementPitchLinks) {
      await tx
        .update(dsp_pitches)
        .set({ release_id: link.release_id })
        .where(and(eq(dsp_pitches.id, link.pitch_id), eq(dsp_pitches.org_id, orgId)));
    }

    await tx.delete(samply_comment_links).where(and(
      eq(samply_comment_links.release_id, input.id),
      eq(samply_comment_links.org_id, orgId),
    ));

    if (releaseTrackIds.length) {
      await tx.delete(samply_comment_links).where(and(
        eq(samply_comment_links.org_id, orgId),
        inArray(samply_comment_links.track_id, releaseTrackIds),
      ));
      await tx.delete(samply_files).where(and(
        eq(samply_files.org_id, orgId),
        inArray(samply_files.track_id, releaseTrackIds),
      ));
    }

    if (releaseProjectIds.length) {
      await tx.delete(samply_players).where(and(
        eq(samply_players.org_id, orgId),
        inArray(samply_players.samply_project_id, releaseProjectIds),
      ));
      await tx.delete(samply_files).where(and(
        eq(samply_files.org_id, orgId),
        inArray(samply_files.samply_project_id, releaseProjectIds),
      ));
      await tx.delete(samply_projects).where(and(
        eq(samply_projects.org_id, orgId),
        inArray(samply_projects.id, releaseProjectIds),
      ));
    }

    await archiveReleaseCatalogEntry(tx, orgId, input.id);

    await tx.delete(tracks).where(and(eq(tracks.release_id, input.id), eq(tracks.org_id, orgId)));
    await tx.delete(budget_line_items).where(and(eq(budget_line_items.release_id, input.id), eq(budget_line_items.org_id, orgId)));
    await tx.delete(dsp_pitch_releases).where(and(eq(dsp_pitch_releases.release_id, input.id), eq(dsp_pitch_releases.org_id, orgId)));
    await tx.delete(dsp_pitches).where(and(eq(dsp_pitches.release_id, input.id), eq(dsp_pitches.org_id, orgId)));
    await tx.delete(side_artists).where(and(eq(side_artists.release_id, input.id), eq(side_artists.org_id, orgId)));
    await tx.delete(release_reporting).where(and(eq(release_reporting.release_id, input.id), eq(release_reporting.org_id, orgId)));

    await tx.update(calls).set({ release_id: null }).where(and(eq(calls.release_id, input.id), eq(calls.org_id, orgId)));
    await tx.update(documents).set({ release_id: null }).where(and(eq(documents.release_id, input.id), eq(documents.org_id, orgId)));
    await tx.update(media_assets).set({ linked_release_id: null }).where(and(eq(media_assets.linked_release_id, input.id), eq(media_assets.org_id, orgId)));
    await tx.update(campaigns).set({ linked_release_id: null, updated_at: new Date(), revision: sql`${campaigns.revision} + 1` }).where(and(eq(campaigns.linked_release_id, input.id), eq(campaigns.org_id, orgId)));
    await tx.update(royalties_revenue).set({ release_id: null }).where(and(eq(royalties_revenue.release_id, input.id), eq(royalties_revenue.org_id, orgId)));
    await tx.update(ops_tasks).set({ linked_release_id: null }).where(and(eq(ops_tasks.linked_release_id, input.id), eq(ops_tasks.org_id, orgId)));

    await tx.delete(releases).where(and(eq(releases.id, input.id), eq(releases.org_id, orgId)));

    return { ok: true };
  });
}

async function assertArtistInOrg(
  client: Pick<typeof db, "select">,
  orgId: string,
  artistId: string,
): Promise<void> {
  const rows = await client
    .select({ id: artists.id })
    .from(artists)
    .where(and(eq(artists.id, artistId), eq(artists.org_id, orgId)));

  if (!rows.length) {
    throw new NotFoundError("Artist not found");
  }
}

async function assertParentReleaseInOrg(
  client: Pick<typeof db, "select">,
  orgId: string,
  parentReleaseId: string,
  releaseId: string,
): Promise<void> {
  if (parentReleaseId === releaseId) throw new NotFoundError("A release cannot be its own parent");
  const rows = await client.select({ id: releases.id, format: releases.format }).from(releases).where(and(eq(releases.id, parentReleaseId), eq(releases.org_id, orgId)));
  if (!rows.length) throw new NotFoundError("Parent release not found");
  if (!isParentFormat(rows[0].format)) throw new HttpError("Parent release must be an EP or album");
}

function isSingleFormat(format: string | null | undefined): boolean {
  return format?.toLowerCase() === "single";
}

function isParentFormat(format: string | null | undefined): boolean {
  return format != null && ["ep", "album"].includes(format.toLowerCase());
}

function assertSingleCanHaveParent(format: string | null | undefined): void {
  if (!isSingleFormat(format)) throw new HttpError("Only singles can have a parent release");
}
