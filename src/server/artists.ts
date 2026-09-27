import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { artists, campaigns, contacts, documents, media_assets, ops_tasks, releases, roles, works } from "../db/schema";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { hasOwn, idSchema, nullableInteger, nullableText } from "./validation";
import {
  deriveCampaignDocument,
  type CampaignDocument,
} from "../lib/campaign-rich-text";
import { normalizeReviewedRichText } from "../lib/reviewed-rich-text";

const AIRTABLE_ARTISTS_BASE_ID = process.env.AIRTABLE_BASE_ID ?? "appoKM3ylTDhR60LY";

const artistBioDocumentSchema = z.unknown().transform((value, context): CampaignDocument => {
  try {
    return deriveCampaignDocument(value, 20_000).document;
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid artist biography document",
    });
    return z.NEVER;
  }
}).optional();

const artistRelationshipSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value === "string") return value.trim();
    return value;
  },
  z.enum(["roster", "collaborator"]).nullable().optional(),
);

const nullableArtistContactIdSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    return value;
  },
  z.string().min(1).nullable().optional(),
);

export const artistRelationshipValues = ["roster", "collaborator"] as const;
export type ArtistRelationship = (typeof artistRelationshipValues)[number];

function normalizeArtistRelationship(value: string | null | undefined): ArtistRelationship | null {
  return value === "roster" || value === "collaborator" ? value : null;
}

const artistBaseSchema = {
  name: z.string().trim().min(1, "Name is required"),
  image_url: nullableText,
  bio: nullableText,
  bio_document: artistBioDocumentSchema,
  spotify_id: nullableText,
  spotify_followers: nullableInteger({ min: 0 }),
  spotify_popularity: nullableInteger({ min: 0, max: 100 }),
  pro: nullableText,
  ipi: nullableText,
  instagram: nullableText,
  tiktok: nullableText,
  relationship: artistRelationshipSchema,
  contact_id: nullableArtistContactIdSchema,
};

export const createArtistSchema = z.object({
  id: idSchema.optional(),
  ...artistBaseSchema,
});

/** Native clients never choose canonical record IDs. */
export const nativeCreateArtistSchema = createArtistSchema.omit({ id: true }).strict();

export const updateArtistSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(artistBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

/** Native writes must carry the exact timestamp returned with the loaded detail. */
export const nativeUpdateArtistSchema = createArtistSchema.omit({ id: true, bio: true, bio_document: true }).partial().extend({
  expected_updated_at: z.string().datetime(),
});

export const deleteArtistSchema = z.object({
  id: idSchema,
});

export type CreateArtistInput = z.infer<typeof createArtistSchema>;
export type NativeCreateArtistInput = z.infer<typeof nativeCreateArtistSchema>;
export type UpdateArtistInput = z.infer<typeof updateArtistSchema>;
export type NativeUpdateArtistInput = UpdateArtistInput & { expected_updated_at: string };
export type DeleteArtistInput = z.infer<typeof deleteArtistSchema>;

export interface ArtistRosterRow {
  id: string;
  name: string;
  image_url: string | null;
  bio: string | null;
  spotify_id: string | null;
  spotify_followers: number | null;
  spotify_popularity: number | null;
  pro: string | null;
  ipi: string | null;
  instagram: string | null;
  tiktok: string | null;
  relationship: ArtistRelationship | null;
  contact_id: string | null;
  contact_name?: string | null;
  airtable_record_id?: string | null;
  release_count: number;
  campaign_count: number;
  open_task_count: number;
  next_release_id: string | null;
  next_release_title: string | null;
  next_release_date: string | null;
  next_release_status: string | null;
  next_release_cover_art_url: string | null;
  latest_release_id: string | null;
  latest_release_title: string | null;
  latest_release_date: string | null;
  latest_release_cover_art_url: string | null;
  missing_profile_fields: string[];
}

export async function listArtists(orgId: string) {
  return db
    .select()
    .from(artists)
    .where(eq(artists.org_id, orgId))
    .orderBy(asc(artists.name));
}

export async function listArtistRoster(orgId: string): Promise<ArtistRosterRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    image_url: string | null;
    bio: string | null;
    spotify_id: string | null;
    spotify_followers: number | null;
    spotify_popularity: number | null;
    pro: string | null;
    ipi: string | null;
    instagram: string | null;
    tiktok: string | null;
    relationship: string | null;
    contact_id: string | null;
    contact_name: string | null;
    airtable_record_id: string | null;
    release_count: string | number;
    campaign_count: string | number;
    open_task_count: string | number;
    next_release_id: string | null;
    next_release_title: string | null;
    next_release_date: string | null;
    next_release_status: string | null;
    next_release_cover_art_url: string | null;
    latest_release_id: string | null;
    latest_release_title: string | null;
    latest_release_date: string | null;
    latest_release_cover_art_url: string | null;
  }>(sql`
    with release_counts as (
      select artist_id, count(*)::int as release_count
      from label_suite.releases
      where org_id = ${orgId}
      group by artist_id
    ),
    campaign_counts as (
      select linked_artist_id as artist_id, count(*)::int as campaign_count
      from label_suite.campaigns
      where org_id = ${orgId}
        and linked_artist_id is not null
        and coalesce(status, '') not in ('done', 'complete', 'completed', 'archived')
      group by linked_artist_id
    ),
    task_counts as (
      select linked_artist_id as artist_id, count(*)::int as open_task_count
      from label_suite.ops_tasks
      where org_id = ${orgId}
        and linked_artist_id is not null
        and coalesce(status, '') not in ('done', 'complete', 'completed', 'cancelled')
      group by linked_artist_id
    ),
    next_releases as (
      select distinct on (artist_id)
        artist_id,
        id,
        title,
        release_date,
        status,
        cover_art_url
      from label_suite.releases
      where org_id = ${orgId}
        and release_date is not null
        and release_date >= to_char(current_date, 'YYYY-MM-DD')
      order by artist_id, release_date asc, title asc
    ),
    latest_releases as (
      select distinct on (artist_id)
        artist_id,
        id,
        title,
        release_date,
        cover_art_url
      from label_suite.releases
      where org_id = ${orgId}
      order by artist_id, release_date desc nulls last, title asc
    )
    select
      a.id,
      a.name,
      a.image_url,
      a.bio,
      a.spotify_id,
      a.spotify_followers,
      a.spotify_popularity,
      a.pro,
      a.ipi,
      a.instagram,
      a.tiktok,
      a.relationship,
      a.contact_id,
      c.name as contact_name,
      mapping.airtable_record_id,
      coalesce(rc.release_count, 0)::int as release_count,
      coalesce(cc.campaign_count, 0)::int as campaign_count,
      coalesce(tc.open_task_count, 0)::int as open_task_count,
      nr.id as next_release_id,
      nr.title as next_release_title,
      nr.release_date as next_release_date,
      nr.status as next_release_status,
      nr.cover_art_url as next_release_cover_art_url,
      lr.id as latest_release_id,
      lr.title as latest_release_title,
      lr.release_date as latest_release_date,
      lr.cover_art_url as latest_release_cover_art_url
    from label_suite.artists a
    left join label_suite.contacts c
      on c.id = a.contact_id
     and c.org_id = a.org_id
    left join lateral (
      select m.airtable_record_id
      from label_suite.airtable_record_mappings m
      where m.org_id = a.org_id
        and m.airtable_base_id = ${AIRTABLE_ARTISTS_BASE_ID}
        and m.airtable_table_name = 'Artists'
        and m.postgres_record_id = a.id
      order by m.updated_at desc nulls last
      limit 1
    ) mapping on true
    left join release_counts rc on rc.artist_id = a.id
    left join campaign_counts cc on cc.artist_id = a.id
    left join task_counts tc on tc.artist_id = a.id
    left join next_releases nr on nr.artist_id = a.id
    left join latest_releases lr on lr.artist_id = a.id
    where a.org_id = ${orgId}
    order by a.name asc
  `);

  return (rows.rows ?? []).map((row) => ({
    ...row,
    spotify_followers: row.spotify_followers == null ? null : Number(row.spotify_followers),
    spotify_popularity: row.spotify_popularity == null ? null : Number(row.spotify_popularity),
    relationship: normalizeArtistRelationship(row.relationship),
    contact_id: row.contact_id ?? null,
    contact_name: row.contact_name ?? null,
    airtable_record_id: row.airtable_record_id ?? null,
    release_count: Number(row.release_count ?? 0),
    campaign_count: Number(row.campaign_count ?? 0),
    open_task_count: Number(row.open_task_count ?? 0),
    missing_profile_fields: missingArtistFields(row),
  }));
}

function missingArtistFields(row: {
  bio: string | null;
  spotify_id: string | null;
  spotify_followers: number | null;
  spotify_popularity: number | null;
  pro: string | null;
  ipi: string | null;
  instagram: string | null;
  tiktok: string | null;
}): string[] {
  const missing: string[] = [];
  if (!row.bio) missing.push("bio");
  if (!row.spotify_id) missing.push("Spotify ID");
  if (row.spotify_followers == null) missing.push("followers");
  if (row.spotify_popularity == null) missing.push("popularity");
  if (!row.pro) missing.push("PRO");
  if (!row.ipi) missing.push("IPI");
  if (!row.instagram) missing.push("Instagram");
  if (!row.tiktok) missing.push("TikTok");
  return missing;
}

export async function listArtistOptions(orgId: string) {
  return db
    .select({ id: artists.id, name: artists.name })
    .from(artists)
    .where(eq(artists.org_id, orgId))
    .orderBy(asc(artists.name));
}

type ArtistWriteClient = Pick<typeof db, "select" | "insert" | "update">;

async function requireArtistContactInOrg(
  orgId: string,
  id: string | null | undefined,
  client: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  if (!id) return null;
  const rows = await client
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.org_id, orgId)))
    .limit(1);

  if (!rows.length) {
    throw new NotFoundError("Primary contact not found in active workspace");
  }

  return id;
}

export async function getArtistDetail(orgId: string, id: string) {
  const artistRows = await db
    .select()
    .from(artists)
    .where(and(eq(artists.id, id), eq(artists.org_id, orgId)));
  const releaseRows = await db
    .select()
    .from(releases)
    .where(and(eq(releases.artist_id, id), eq(releases.org_id, orgId)));
  const assetRows = await db
    .select({
      id: media_assets.id,
      asset_name: media_assets.asset_name,
      asset_type: media_assets.asset_type,
      linked_artist_id: media_assets.linked_artist_id,
      linked_release_id: media_assets.linked_release_id,
      version: media_assets.version,
      approval_status: media_assets.approval_status,
      delivery_status: media_assets.delivery_status,
      file_link: media_assets.file_link,
      notes: media_assets.notes,
      date_uploaded: media_assets.date_uploaded,
      release_title: releases.title,
    })
    .from(media_assets)
    .leftJoin(releases, and(eq(media_assets.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(media_assets.linked_artist_id, id), eq(media_assets.org_id, orgId)))
    .orderBy(desc(media_assets.created_at));
  const campaignRows = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      owner: campaigns.owner,
      goal: campaigns.goal,
      budget_planned: campaigns.budget_planned,
      budget_actual: campaigns.budget_actual,
      linked_release_id: campaigns.linked_release_id,
      release_title: releases.title,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(campaigns.linked_artist_id, id), eq(campaigns.org_id, orgId)))
    .orderBy(desc(campaigns.created_at));
  const documentRows = await db
    .select({
      id: documents.id,
      name: documents.name,
      doc_type: documents.doc_type,
      status: documents.status,
      file_link: documents.file_link,
      notes: documents.notes,
      release_id: documents.release_id,
      release_title: releases.title,
    })
    .from(documents)
    .leftJoin(releases, and(eq(documents.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(documents.artist_id, id), eq(documents.org_id, orgId)))
    .orderBy(desc(documents.created_at));
  const rightsRows = await db
    .select({
      id: roles.id,
      role: roles.role,
      ownership_type: roles.ownership_type,
      scope: roles.scope,
      percent_share: roles.percent_share,
      clearance_status: roles.clearance_status,
      contact_id: roles.contact_id,
      contact_name: contacts.name,
      work_id: roles.work_id,
      work_title: works.title,
    })
    .from(roles)
    .leftJoin(contacts, and(eq(roles.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .leftJoin(works, and(eq(roles.work_id, works.id), eq(works.org_id, orgId)))
    .where(and(eq(roles.org_id, orgId), sql`${roles.work_id} in (
      select t.work_id
      from label_suite.tracks t
      join label_suite.releases r on r.id = t.release_id and r.org_id = ${orgId}
      where r.artist_id = ${id}
        and t.work_id is not null
    )`))
    .orderBy(desc(roles.created_at));
  const taskRows = await db
    .select({
      id: ops_tasks.id,
      task_name: ops_tasks.task_name,
      status: ops_tasks.status,
      priority: ops_tasks.priority,
      owner: ops_tasks.owner,
      due_date: ops_tasks.due_date,
      next_action: ops_tasks.next_action,
      linked_release_id: ops_tasks.linked_release_id,
      release_title: releases.title,
    })
    .from(ops_tasks)
    .leftJoin(releases, and(eq(ops_tasks.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(ops_tasks.linked_artist_id, id), eq(ops_tasks.org_id, orgId)))
    .orderBy(desc(ops_tasks.created_at));
  const primaryContactRows = artistRows[0]?.contact_id
    ? await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        image_url: contacts.image_url,
        role: contacts.role,
        company: contacts.company,
      })
      .from(contacts)
      .where(and(eq(contacts.id, artistRows[0].contact_id), eq(contacts.org_id, orgId)))
    : [];
  const artist = artistRows[0]
    ? {
      ...artistRows[0],
      relationship: normalizeArtistRelationship(artistRows[0].relationship),
      contact_id: artistRows[0].contact_id ?? null,
    }
    : null;

  return {
    artist,
    releases: releaseRows,
    mediaAssets: assetRows,
    campaigns: campaignRows,
    documents: documentRows,
    rights: rightsRows,
    tasks: taskRows,
    primaryContact: primaryContactRows[0] ?? null,
  };
}

export async function createArtist(orgId: string, input: CreateArtistInput) {
  const id = input.id ?? crypto.randomUUID();
  const contactId = await requireArtistContactInOrg(orgId, input.contact_id);
  const bio = deriveArtistBio(input as Record<string, unknown>, true)!;

  await db.insert(artists).values({
    id,
    org_id: orgId,
    name: input.name,
    image_url: input.image_url ?? null,
    bio: bio.plainText,
    bio_document: bio.document as unknown as Record<string, unknown>,
    bio_html: bio.html,
    bio_review_status: "draft",
    bio_reviewed_hash: null,
    spotify_id: input.spotify_id ?? null,
    spotify_followers: input.spotify_followers ?? null,
    spotify_popularity: input.spotify_popularity ?? null,
    pro: input.pro ?? null,
    ipi: input.ipi ?? null,
    instagram: input.instagram ?? null,
    tiktok: input.tiktok ?? null,
    relationship: input.relationship ?? null,
    contact_id: contactId,
  }).onConflictDoNothing({ target: artists.id });

  return { id, ok: true };
}

export async function createArtistForNative(orgId: string, input: NativeCreateArtistInput, actorUserId: string) {
  return db.transaction(async (tx: ArtistWriteClient) => {
    const id = crypto.randomUUID();
    const contactId = await requireArtistContactInOrg(orgId, input.contact_id, tx);
    const bio = deriveArtistBio(input as Record<string, unknown>, true)!;

    await tx.insert(artists).values({
      id,
      org_id: orgId,
      name: input.name,
      image_url: input.image_url ?? null,
      bio: bio.plainText,
      bio_document: bio.document as unknown as Record<string, unknown>,
      bio_html: bio.html,
      bio_review_status: "draft",
      bio_reviewed_hash: null,
      spotify_id: input.spotify_id ?? null,
      spotify_followers: input.spotify_followers ?? null,
      spotify_popularity: input.spotify_popularity ?? null,
      pro: input.pro ?? null,
      ipi: input.ipi ?? null,
      instagram: input.instagram ?? null,
      tiktok: input.tiktok ?? null,
      relationship: input.relationship ?? null,
      contact_id: contactId,
    });

    const row = (await tx
      .select()
      .from(artists)
      .where(and(eq(artists.id, id), eq(artists.org_id, orgId)))
      .limit(1))[0];
    if (!row) throw new NotFoundError("Artist not found after create");
    await recordAuditEvent(orgId, {
      actor_user_id: actorUserId,
      event_type: "artist.created",
      object_type: "artist",
      object_id: row.id,
      before: null,
      after: artistAuditData(row),
    }, tx);
    return row;
  });
}

export async function updateArtist(orgId: string, input: UpdateArtistInput) {
  const updates: Partial<typeof artists.$inferInsert> = { updated_at: new Date() };

  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "image_url")) updates.image_url = input.image_url as string | null;
  const bio = deriveArtistBio(input as Record<string, unknown>, false);
  if (bio) {
    updates.bio = bio.plainText;
    updates.bio_document = bio.document as unknown as Record<string, unknown>;
    updates.bio_html = bio.html;
    updates.bio_review_status = "draft";
    updates.bio_reviewed_hash = null;
    updates.bio_reviewed_at = null;
    updates.bio_reviewed_by = null;
  }
  if (hasOwn(input, "spotify_id")) updates.spotify_id = input.spotify_id as string | null;
  if (hasOwn(input, "spotify_followers")) updates.spotify_followers = input.spotify_followers as number | null;
  if (hasOwn(input, "spotify_popularity")) updates.spotify_popularity = input.spotify_popularity as number | null;
  if (hasOwn(input, "pro")) updates.pro = input.pro as string | null;
  if (hasOwn(input, "ipi")) updates.ipi = input.ipi as string | null;
  if (hasOwn(input, "instagram")) updates.instagram = input.instagram as string | null;
  if (hasOwn(input, "tiktok")) updates.tiktok = input.tiktok as string | null;
  if (hasOwn(input, "relationship")) updates.relationship = input.relationship as ArtistRelationship | null;
  if (hasOwn(input, "contact_id")) {
    updates.contact_id = await requireArtistContactInOrg(orgId, input.contact_id as string | null | undefined);
  }

  const updated = await db
    .update(artists)
    .set(updates)
    .where(and(eq(artists.id, input.id), eq(artists.org_id, orgId)))
    .returning({ id: artists.id });

  if (!updated.length) {
    throw new NotFoundError("Artist not found");
  }

  return { ok: true };
}

/**
 * The native mutation seam is deliberately separate from the older web form
 * service: an iPhone save is always revision-aware, actor-attributed, and
 * returns the canonical row that the protected snapshot can replace.
 */
export async function updateArtistForNative(orgId: string, input: NativeUpdateArtistInput, actorUserId: string) {
  return db.transaction(async (tx: ArtistWriteClient) => {
    const contactId = hasOwn(input, "contact_id")
      ? await requireArtistContactInOrg(orgId, input.contact_id as string | null | undefined, tx)
      : undefined;
    const currentRows = await tx
      .select()
      .from(artists)
      .where(and(eq(artists.id, input.id), eq(artists.org_id, orgId)))
      .limit(1);
    const current = currentRows[0];
    if (!current) throw new NotFoundError("Artist not found");
    const expected = new Date(input.expected_updated_at);
    if (!current.updated_at || current.updated_at.getTime() !== expected.getTime()) {
      throw new ConflictError("Artist changed while updating; refresh and retry");
    }

    const updates = buildArtistUpdates(input, contactId);
    const updated = await tx
      .update(artists)
      .set({ ...updates, updated_at: new Date(Math.max(Date.now(), current.updated_at.getTime() + 1)) })
      .where(and(
        eq(artists.id, input.id),
        eq(artists.org_id, orgId),
        sql`date_trunc('milliseconds', ${artists.updated_at}) = ${current.updated_at.toISOString()}::timestamp`,
      ))
      .returning();
    const row = updated[0];
    if (!row) throw new ConflictError("Artist changed while updating; refresh and retry");

    await recordAuditEvent(orgId, {
      actor_user_id: actorUserId,
      event_type: "artist.updated",
      object_type: "artist",
      object_id: row.id,
      before: artistAuditData(current),
      after: artistAuditData(row),
    }, tx);

    return row;
  });
}

function buildArtistUpdates(input: UpdateArtistInput, contactId?: string | null): Partial<typeof artists.$inferInsert> {
  const updates: Partial<typeof artists.$inferInsert> = {};
  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "image_url")) updates.image_url = input.image_url as string | null;
  const bio = deriveArtistBio(input as Record<string, unknown>, false);
  if (bio) {
    updates.bio = bio.plainText;
    updates.bio_document = bio.document as unknown as Record<string, unknown>;
    updates.bio_html = bio.html;
    updates.bio_review_status = "draft";
    updates.bio_reviewed_hash = null;
    updates.bio_reviewed_at = null;
    updates.bio_reviewed_by = null;
  }
  if (hasOwn(input, "spotify_id")) updates.spotify_id = input.spotify_id as string | null;
  if (hasOwn(input, "spotify_followers")) updates.spotify_followers = input.spotify_followers as number | null;
  if (hasOwn(input, "spotify_popularity")) updates.spotify_popularity = input.spotify_popularity as number | null;
  if (hasOwn(input, "pro")) updates.pro = input.pro as string | null;
  if (hasOwn(input, "ipi")) updates.ipi = input.ipi as string | null;
  if (hasOwn(input, "instagram")) updates.instagram = input.instagram as string | null;
  if (hasOwn(input, "tiktok")) updates.tiktok = input.tiktok as string | null;
  if (hasOwn(input, "relationship")) updates.relationship = input.relationship as ArtistRelationship | null;
  if (hasOwn(input, "contact_id")) updates.contact_id = contactId ?? null;
  return updates;
}

function artistAuditData(row: typeof artists.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    image_url: row.image_url,
    bio: row.bio,
    relationship: row.relationship,
    contact_id: row.contact_id,
    spotify_id: row.spotify_id,
    spotify_followers: row.spotify_followers,
    spotify_popularity: row.spotify_popularity,
    pro: row.pro,
    ipi: row.ipi,
    instagram: row.instagram,
    tiktok: row.tiktok,
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}

export async function reviewArtistBio(orgId: string, artistId: string, actorId: string) {
  const row = (await db
    .select({
      id: artists.id,
      bio: artists.bio,
      bio_document: artists.bio_document,
      bio_review_status: artists.bio_review_status,
      bio_reviewed_hash: artists.bio_reviewed_hash,
    })
    .from(artists)
    .where(and(eq(artists.id, artistId), eq(artists.org_id, orgId)))
    .limit(1))[0];

  if (!row) throw new NotFoundError("Artist not found");
  const derived = normalizeReviewedRichText(row.bio_document, row.bio, {
    reviewStatus: row.bio_review_status === "reviewed" ? "reviewed" : "draft",
    reviewedHash: row.bio_reviewed_hash,
  });
  if (derived.usedFallback) {
    throw new ConflictError("Review unavailable: replace the invalid biography draft before reviewing");
  }
  if (derived.state === "missing") throw new ConflictError("Artist biography is missing");

  const reviewed = await db.update(artists).set({
    bio_document: derived.document as unknown as Record<string, unknown>,
    bio: derived.plainText,
    bio_html: derived.html,
    bio_review_status: "reviewed",
    bio_reviewed_hash: derived.hash,
    bio_reviewed_at: new Date(),
    bio_reviewed_by: actorId,
    updated_at: new Date(),
  }).where(and(
    eq(artists.id, artistId),
    eq(artists.org_id, orgId),
    row.bio_document === null ? isNull(artists.bio_document) : eq(artists.bio_document, row.bio_document),
    row.bio === null ? isNull(artists.bio) : eq(artists.bio, row.bio),
  )).returning({ id: artists.id });

  if (!reviewed.length) throw new ConflictError("Artist biography changed before review; refresh and review the current draft");

  return { ok: true, state: "reviewed" as const, hash: derived.hash };
}

function deriveArtistBio(input: Record<string, unknown>, required: boolean) {
  if (hasOwn(input, "bio_document")) return deriveCampaignDocument(input.bio_document, 20_000);
  if (hasOwn(input, "bio")) return deriveCampaignDocument(input.bio ?? "", 20_000);
  return required ? deriveCampaignDocument("", 20_000) : null;
}

export async function deleteArtist(orgId: string, input: DeleteArtistInput) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: artists.id })
      .from(artists)
      .where(and(eq(artists.id, input.id), eq(artists.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Artist not found");
    }

    const releaseCount = await tx
      .select({ count: sql<number>`count(*)` })
      .from(releases)
      .where(and(eq(releases.artist_id, input.id), eq(releases.org_id, orgId)));

    const n = Number(releaseCount[0]?.count ?? 0);
    if (n > 0) {
      throw new ConflictError(
        `Cannot delete artist with ${n} release${n > 1 ? "s" : ""} - reassign or delete those releases first.`,
      );
    }

    await tx.delete(artists).where(and(eq(artists.id, input.id), eq(artists.org_id, orgId)));
  });

  return { ok: true };
}
