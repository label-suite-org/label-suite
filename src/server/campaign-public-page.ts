import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z, ZodError } from "zod";
import {
  campaign_public_pages,
  campaign_public_page_revisions,
  campaigns,
  catalog_entries,
  contacts,
  media_assets,
  org_memberships,
  releases,
  roles,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { writeAuditLog } from "./audit";
import {
  buildPublicPageProjection,
  campaignPublicPageContentSchema,
  getPublicPageReviewBlockers,
  isCampaignPublicPageContentHashValid,
  normalizePublicPageSlug,
  type CampaignPublicPageContent,
  type PublicPageArtworkSnapshot,
  type PublicPageProjection,
  type PublicPageReleaseSnapshot,
  type PublicPageTrack,
} from "./campaign-public-page-core";

export const saveCampaignPublicPageDraftSchema = z.object({
  slug: z.string().trim().min(1).max(180),
  content: campaignPublicPageContentSchema,
}).strict();

export const reviewCampaignPublicPageRevisionSchema = z.object({
  revision_id: z.string().trim().min(1),
}).strict();

export const publishCampaignPublicPageRevisionSchema = z.discriminatedUnion("confirmation", [
  z.object({ revision_id: z.string().trim().min(1), confirmation: z.literal("publish") }).strict(),
  z.object({ confirmation: z.literal("unpublish") }).strict(),
]);

export type SaveCampaignPublicPageDraftInput = z.input<typeof saveCampaignPublicPageDraftSchema>;

type PageRow = typeof campaign_public_pages.$inferSelect;
type QueryClient = any;
type CanonicalTrackRow = { id: string; title: string; duration: number | null; work_id: string | null; updated_at: Date | null };

export const nativePublicPageActionSchema = z.object({
  revision_id: z.string().trim().min(1),
  expected_review_token: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.enum(["review", "publish"]),
}).strict();

function nativePublicPageReviewToken(page: PageRow, revision: typeof campaign_public_page_revisions.$inferSelect) {
  return createHash("sha256").update(JSON.stringify([page.id, page.slug, page.status, page.current_draft_revision_id, page.current_published_revision_id, page.updated_at,
    revision.id, revision.version, revision.review_status, revision.content, revision.content_hash, revision.source_snapshot, revision.updated_at])).digest("hex");
}

export async function applyNativePublicPageAction(orgId: string, campaignId: string, actorId: string, raw: unknown) {
  const input = nativePublicPageActionSchema.parse(raw);
  return db.transaction(async tx => {
    const [membership] = await tx.select({ role: org_memberships.role }).from(org_memberships).where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, actorId))).for("share").limit(1);
    if (!membership || (input.confirmation === "publish" ? membership.role !== "owner" : !["owner", "operator"].includes(membership.role))) throw new HttpError("Insufficient permissions", 403);
    const [campaign] = await tx.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId))).for("share").limit(1);
    if (!campaign) throw new NotFoundError("Campaign not found");
    if (campaign.status === "archived") throw new ConflictError("Archived campaigns cannot change public pages");
    const [page] = await tx.select().from(campaign_public_pages).where(and(eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).for("update").limit(1);
    if (!page || page.current_draft_revision_id !== input.revision_id) throw new ConflictError("The current page draft changed; refresh before continuing");
    const [revision] = await tx.select().from(campaign_public_page_revisions).where(and(eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_page_revisions.page_id, page.id), eq(campaign_public_page_revisions.id, input.revision_id))).for("update").limit(1);
    if (!revision || nativePublicPageReviewToken(page, revision) !== input.expected_review_token) throw new ConflictError("The reviewed page changed; refresh before continuing");
    return input.confirmation === "publish"
      ? publishCampaignPublicPageRevision(orgId, campaignId, revision.id, actorId, tx)
      : reviewCampaignPublicPageRevision(orgId, campaignId, revision.id, actorId, tx);
  });
}

export async function getNativeCampaignPublicPageReview(orgId: string, campaignId: string) {
  return db.transaction(async tx => {
    const campaign = await loadCampaign(tx, orgId, campaignId);
    const [page] = await tx.select().from(campaign_public_pages).where(and(eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).limit(1);
    if (!page) return { campaign, page: null, revision: null, preview: null, blocker: "No public-page draft exists" };
    const [revision] = page.current_draft_revision_id ? await tx.select().from(campaign_public_page_revisions).where(and(
      eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_page_revisions.page_id, page.id), eq(campaign_public_page_revisions.id, page.current_draft_revision_id),
    )).limit(1) : [];
    if (!revision) return { campaign, page: redactPage(page), revision: null, preview: null, blocker: "The current page draft is unavailable" };
    const identity = { id: revision.id, version: revision.version, review_status: revision.review_status, content: revision.content, content_hash: revision.content_hash, reviewed_at: revision.reviewed_at, review_token: nativePublicPageReviewToken(page, revision) };
    try {
      const content = campaignPublicPageContentSchema.parse(revision.content);
      if (revision.review_status === "reviewed" && !isCampaignPublicPageContentHashValid(revision.content, revision.content_hash)) throw new ConflictError("Revision content changed after review");
      const source = await loadCanonicalSource(tx, orgId, campaign, content);
      const blockers = getPublicPageReviewBlockers({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot });
      if (!sameSnapshot(revision.source_snapshot, source.snapshot) || blockers.length) throw new ConflictError("Page sources changed; save a new draft before review");
      const timestamp = revision.reviewed_at ?? revision.updated_at ?? revision.created_at ?? new Date();
      const preview = buildPublicPageProjection({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot, publishedAt: timestamp, updatedAt: revision.updated_at ?? timestamp });
      return { campaign, page: redactPage(page), revision: identity, preview: { ...preview, release_note_document: content.release_note_document }, blocker: null };
    } catch (error) {
      if (!isExpectedPublicPageUnavailable(error)) throw error;
      return { campaign, page: redactPage(page), revision: identity, preview: null, blocker: error instanceof ZodError ? "Page content is invalid; repair the draft before review" : (error as Error).message };
    }
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getCampaignPublicPageEditor(orgId: string, campaignId: string) {
  const page = (await db.select().from(campaign_public_pages).where(and(
    eq(campaign_public_pages.org_id, orgId),
    eq(campaign_public_pages.campaign_id, campaignId),
  )).limit(1))[0] ?? null;
  if (!page) return { page: null, draft: null, revisions: [] };

  const revisions = await db.select().from(campaign_public_page_revisions).where(and(
    eq(campaign_public_page_revisions.org_id, orgId),
    eq(campaign_public_page_revisions.page_id, page.id),
  )).orderBy(desc(campaign_public_page_revisions.version));
  return {
    page: redactPage(page),
    draft: revisions.find((revision) => revision.id === page.current_draft_revision_id) ?? null,
    revisions,
  };
}

export async function saveCampaignPublicPageDraft(
  orgId: string,
  campaignId: string,
  input: SaveCampaignPublicPageDraftInput,
  authorId: string,
) {
  const payload = saveCampaignPublicPageDraftSchema.parse(input);
  const content = campaignPublicPageContentSchema.parse(payload.content);
  return db.transaction(async (tx) => {
    const campaign = await loadCampaign(tx, orgId, campaignId);
    const now = new Date();
    let page = (await tx.select().from(campaign_public_pages).where(and(
      eq(campaign_public_pages.org_id, orgId),
      eq(campaign_public_pages.campaign_id, campaignId),
    )).for("update").limit(1))[0] as PageRow | undefined;

    const normalizedSlug = normalizePublicPageSlug(payload.slug);
    if (!normalizedSlug) throw new ConflictError("Slug must contain at least one letter or number");
    if (!page) {
      const inserted = await tx.insert(campaign_public_pages).values({
        id: crypto.randomUUID(), org_id: orgId, campaign_id: campaignId,
        slug: normalizedSlug, status: "draft", updated_at: now,
      }).onConflictDoNothing().returning();
      page = inserted[0] as PageRow | undefined;
      if (!page) {
        page = (await tx.select().from(campaign_public_pages).where(and(eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).for("update").limit(1))[0] as PageRow | undefined;
        if (!page) throw new ConflictError("Public page slug conflicts with another campaign");
      }
    }
    if (page.slug !== normalizedSlug) {
      const slugOwner = (await tx.select({ id: campaign_public_pages.id }).from(campaign_public_pages).where(eq(campaign_public_pages.slug, normalizedSlug)).limit(1))[0];
      if (slugOwner && slugOwner.id !== page.id) throw new ConflictError("Public page slug conflicts with another campaign");
      const changed = await tx.update(campaign_public_pages).set({ slug: normalizedSlug, updated_at: now })
        .where(eq(campaign_public_pages.id, page.id)).returning();
      page = changed[0] as PageRow;
    }

    const source = await loadCanonicalSource(tx, orgId, campaign, content);
    const previousVersion = (await tx.select({ version: campaign_public_page_revisions.version })
      .from(campaign_public_page_revisions)
      .where(and(eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_page_revisions.page_id, page.id)))
      .orderBy(desc(campaign_public_page_revisions.version)).for("update").limit(1))[0]?.version ?? 0;
    const revisionId = crypto.randomUUID();
    const revision = (await tx.insert(campaign_public_page_revisions).values({
      id: revisionId,
      org_id: orgId,
      page_id: page.id,
      version: previousVersion + 1,
      content,
      source_snapshot: source.snapshot,
      author_id: authorId,
      authored_at: now,
      review_status: "draft",
      content_hash: hashContent(content),
      created_at: now,
      updated_at: now,
    }).returning())[0];

    if (page.current_draft_revision_id && page.current_draft_revision_id !== page.current_published_revision_id) {
      await tx.update(campaign_public_page_revisions).set({ review_status: "superseded", updated_at: now }).where(and(
        eq(campaign_public_page_revisions.id, page.current_draft_revision_id),
        eq(campaign_public_page_revisions.org_id, orgId),
        eq(campaign_public_page_revisions.page_id, page.id),
      ));
    }
    const updatedPage = (await tx.update(campaign_public_pages).set({ current_draft_revision_id: revisionId, updated_at: now })
      .where(and(eq(campaign_public_pages.id, page.id), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).returning())[0];
    return { page: redactPage(updatedPage), revision };
  });
}

export async function reviewCampaignPublicPageRevision(orgId: string, campaignId: string, revisionId: string, reviewerId: string, client: QueryClient = db) {
  return client.transaction(async (tx: QueryClient) => {
    const row = (await tx.select({ revision: campaign_public_page_revisions, page: campaign_public_pages })
      .from(campaign_public_page_revisions)
      .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
      .where(and(eq(campaign_public_page_revisions.id, revisionId), eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId)))
      .for("update").limit(1))[0];
    if (!row) throw new NotFoundError("Campaign page revision not found");
    if (row.revision.review_status !== "draft") throw new ConflictError("Revision is no longer a draft");
    if (row.page.current_draft_revision_id !== revisionId) throw new ConflictError("A newer page draft exists; review the current revision");
    const content = campaignPublicPageContentSchema.parse(row.revision.content);
    const campaign = await loadCampaign(tx, orgId, campaignId);
    const source = await loadCanonicalSource(tx, orgId, campaign, content);
    const blockers = getPublicPageReviewBlockers({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot });
    if (!sameSnapshot(row.revision.source_snapshot, source.snapshot)) blockers.push("source_snapshot_stale");
    if (blockers.length) throw new ConflictError(`Revision is not reviewable: ${[...new Set(blockers)].join(", ")}`);
    const now = new Date();
    const reviewed = (await tx.update(campaign_public_page_revisions).set({
      reviewer_id: reviewerId, reviewed_at: now, review_status: "reviewed", content_hash: hashContent(content), updated_at: now,
    }).where(and(eq(campaign_public_page_revisions.id, revisionId), eq(campaign_public_page_revisions.org_id, orgId))).returning())[0];
    await writeAuditLog({ orgId, actorUserId: reviewerId, action: "campaign.public_page.reviewed", entityType: "campaign_public_page", entityId: row.page.id,
      beforeData: { revision_id: revisionId, review_status: "draft" }, afterData: { revision_id: revisionId, review_status: "reviewed" },
      metadata: { campaign_id: campaignId, content_hash: reviewed.content_hash, version: reviewed.version },
    }, tx);
    return { ok: true as const, revision: reviewed };
  });
}

export async function publishCampaignPublicPageRevision(orgId: string, campaignId: string, revisionId: string, actorId: string, client: QueryClient = db) {
  return client.transaction(async (tx: QueryClient) => {
    const row = (await tx.select({ revision: campaign_public_page_revisions, page: campaign_public_pages })
      .from(campaign_public_page_revisions)
      .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
      .where(and(eq(campaign_public_page_revisions.id, revisionId), eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId)))
      .for("update").limit(1))[0];
    if (!row) throw new NotFoundError("Campaign page revision not found");
    if (row.revision.review_status !== "reviewed") throw new ConflictError("Revision is not reviewed");
    if (row.page.current_draft_revision_id !== revisionId) throw new ConflictError("A newer page draft exists; review the current revision");
    const content = campaignPublicPageContentSchema.parse(row.revision.content);
    if (!isCampaignPublicPageContentHashValid(row.revision.content, row.revision.content_hash)) {
      throw new ConflictError("Revision content changed after review");
    }
    const campaign = await loadCampaign(tx, orgId, campaignId);
    const source = await loadCanonicalSource(tx, orgId, campaign, content);
    const blockers = getPublicPageReviewBlockers({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot });
    if (!sameSnapshot(row.revision.source_snapshot, source.snapshot)) blockers.push("source_snapshot_stale");
    if (blockers.length) throw new ConflictError(`Revision is not publishable: ${[...new Set(blockers)].join(", ")}`);
    const now = new Date();
    const publishedRevision = (await tx.update(campaign_public_page_revisions).set({ updated_at: now })
      .where(and(eq(campaign_public_page_revisions.id, revisionId), eq(campaign_public_page_revisions.org_id, orgId))).returning())[0];
    const page = (await tx.update(campaign_public_pages).set({ status: "published", current_published_revision_id: revisionId, updated_at: now })
      .where(and(eq(campaign_public_pages.id, row.page.id), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).returning())[0];
    await writeAuditLog({ orgId, actorUserId: actorId, action: "campaign.public_page.published", entityType: "campaign_public_page", entityId: row.page.id,
      beforeData: { status: row.page.status, revision_id: row.page.current_published_revision_id },
      afterData: { status: "published", revision_id: revisionId },
      metadata: { campaign_id: campaignId, content_hash: row.revision.content_hash, version: row.revision.version },
    }, tx);
    return { ok: true as const, page: redactPage(page), revision: publishedRevision ?? row.revision, actor_id: actorId };
  });
}

export async function unpublishCampaignPublicPage(orgId: string, campaignId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const page = (await tx.select().from(campaign_public_pages).where(and(eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId))).for("update").limit(1))[0];
    if (!page) throw new NotFoundError("Campaign public page not found");
    const updated = (await tx.update(campaign_public_pages).set({ status: "unpublished", current_published_revision_id: null, updated_at: new Date() }).where(eq(campaign_public_pages.id, page.id)).returning())[0];
    return { ok: true as const, page: redactPage(updated), actor_id: actorId };
  });
}

export async function getPublishedCampaignPageBySlug(slug: string) {
  const normalized = normalizePublicPageSlug(slug);
  const row = (await db.select({ page: campaign_public_pages, revision: campaign_public_page_revisions })
    .from(campaign_public_pages)
    .innerJoin(campaign_public_page_revisions, eq(campaign_public_page_revisions.id, campaign_public_pages.current_published_revision_id))
    .where(and(eq(campaign_public_pages.slug, normalized), eq(campaign_public_pages.status, "published"), eq(campaign_public_page_revisions.review_status, "reviewed"))).limit(1))[0];
  if (!row) return null;
  try {
    const content = campaignPublicPageContentSchema.parse(row.revision.content);
    if (!isCampaignPublicPageContentHashValid(row.revision.content, row.revision.content_hash)) return null;
    const source = await loadCanonicalSource(db, row.page.org_id, await loadCampaign(db, row.page.org_id, row.page.campaign_id), content);
    const blockers = getPublicPageReviewBlockers({ content, campaignId: row.page.campaign_id, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot });
    if (!sameSnapshot(row.revision.source_snapshot, source.snapshot) || blockers.length) return null;
    const publishedAt = row.revision.updated_at ?? row.revision.reviewed_at;
    const projection = buildPublicPageProjection({ content, campaignId: row.page.campaign_id, release: source.release as PublicPageReleaseSnapshot & { releaseDate: string | null; catalogNumber: string | null; tracks: readonly PublicPageTrack[] }, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot, publishedAt: publishedAt ?? new Date(), updatedAt: publishedAt ?? new Date() });
    return { slug: row.page.slug, revision: { id: row.revision.id, version: row.revision.version }, ...projection };
  } catch (error) {
    if (isExpectedPublicPageUnavailable(error)) return null;
    throw error;
  }
}

/** Server-only freshness gate for authenticated consumers of reviewed revisions. */
export async function isCampaignPublicPageRevisionFresh(orgId: string, campaignId: string, revisionId: string, client: QueryClient = db) {
  const row = (await client.select({ revision: campaign_public_page_revisions, page: campaign_public_pages })
    .from(campaign_public_page_revisions)
    .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
    .where(and(
      eq(campaign_public_page_revisions.id, revisionId),
      eq(campaign_public_page_revisions.org_id, orgId),
      eq(campaign_public_pages.org_id, orgId),
      eq(campaign_public_pages.campaign_id, campaignId),
      eq(campaign_public_page_revisions.review_status, "reviewed"),
    )).limit(1))[0];
  if (!row) return false;
  try {
    const content = campaignPublicPageContentSchema.parse(row.revision.content);
    if (!isCampaignPublicPageContentHashValid(row.revision.content, row.revision.content_hash)) return false;
    const source = await loadCanonicalSource(client, orgId, await loadCampaign(client, orgId, campaignId), content);
    return sameSnapshot(row.revision.source_snapshot, source.snapshot)
      && getPublicPageReviewBlockers({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot }).length === 0;
  } catch (error) {
    if (isExpectedPublicPageUnavailable(error)) return false;
    throw error;
  }
}

/** Build an authenticated, server-derived preview without exposing page IDs or slugs. */
export async function getCampaignPublicPageRevisionPreview(orgId: string, campaignId: string, revisionId: string): Promise<PublicPageProjection> {
  const row = (await db.select({ revision: campaign_public_page_revisions, page: campaign_public_pages })
    .from(campaign_public_page_revisions)
    .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
    .where(and(
      eq(campaign_public_page_revisions.id, revisionId),
      eq(campaign_public_page_revisions.org_id, orgId),
      eq(campaign_public_pages.org_id, orgId),
      eq(campaign_public_pages.campaign_id, campaignId),
      eq(campaign_public_page_revisions.review_status, "reviewed"),
    )).limit(1))[0];
  if (!row) throw new NotFoundError("Campaign page revision not found");
  const content = campaignPublicPageContentSchema.parse(row.revision.content);
  if (!isCampaignPublicPageContentHashValid(row.revision.content, row.revision.content_hash)) {
    throw new ConflictError("Revision preview is stale; save a new page draft");
  }
  const source = await loadCanonicalSource(db, orgId, await loadCampaign(db, orgId, campaignId), content);
  const blockers = getPublicPageReviewBlockers({ content, campaignId, release: source.release, artwork: source.artwork, sourceSnapshot: source.sourceSnapshot });
  if (!sameSnapshot(row.revision.source_snapshot, source.snapshot) || blockers.length) {
    throw new ConflictError("Revision preview is stale; save a new page draft");
  }
  const timestamp = row.revision.reviewed_at ?? row.revision.updated_at ?? row.revision.created_at ?? new Date();
  return buildPublicPageProjection({
    content,
    campaignId,
    release: source.release,
    artwork: source.artwork,
    sourceSnapshot: source.sourceSnapshot,
    publishedAt: timestamp,
    updatedAt: row.revision.updated_at ?? timestamp,
  });
}

function isExpectedPublicPageUnavailable(error: unknown): boolean {
  if (error instanceof NotFoundError || error instanceof ConflictError || error instanceof ZodError) return true;
  if (!(error instanceof Error)) return false;
  return /^(Public page source is not reviewable|Public artwork URL must use HTTPS|Canonical track .* is missing|Invalid publication timestamp)/.test(error.message);
}

async function loadCampaign(client: QueryClient, orgId: string, campaignId: string) {
  const row = (await client.select({ id: campaigns.id, name: campaigns.campaign_name, status: campaigns.status, linked_release_id: campaigns.linked_release_id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))).limit(1))[0];
  if (!row) throw new NotFoundError("Campaign not found");
  return row;
}

async function loadCanonicalSource(client: QueryClient, orgId: string, campaign: { id: string; linked_release_id: string | null }, content: CampaignPublicPageContent) {
  if (!campaign.linked_release_id) throw new ConflictError("Campaign must link a release");
  const release = (await client.select({ id: releases.id, release_date: releases.release_date, updated_at: releases.updated_at }).from(releases).where(and(eq(releases.id, campaign.linked_release_id), eq(releases.org_id, orgId))).limit(1))[0];
  if (!release) throw new ConflictError("Campaign release not found");
  const trackRows: CanonicalTrackRow[] = await client.select({ id: tracks.id, title: tracks.title, duration: tracks.duration, work_id: tracks.work_id, updated_at: tracks.updated_at }).from(tracks).where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, release.id))).orderBy(asc(tracks.position), asc(tracks.id));
  const selectedTrackIds = content.focus_track_ids;
  const selectedTracks = trackRows.filter((track) => selectedTrackIds.includes(track.id));
  const roleRows = selectedTracks.length ? await client.select({ workId: roles.work_id, role: roles.role, name: contacts.name }).from(roles).leftJoin(contacts, eq(contacts.id, roles.contact_id)).where(and(eq(roles.org_id, orgId), inArray(roles.work_id, selectedTracks.map((track) => track.work_id).filter((id): id is string => Boolean(id))))) : [];
  const creditsByWork = new Map<string, Array<{ name: string; role: string }>>();
  for (const role of roleRows) if (role.workId && role.name) creditsByWork.set(role.workId, [...(creditsByWork.get(role.workId) ?? []), { name: role.name, role: role.role ?? "Credit" }]);
  const tracksSnapshot: PublicPageTrack[] = trackRows.map((track) => ({ id: track.id, title: track.title, duration: track.duration, credits: creditsByWork.get(track.work_id ?? "") ?? [] }));
  const artworkRow = (await client.select({ id: media_assets.id, linked_release_id: media_assets.linked_release_id, approval_status: media_assets.approval_status, file_link: media_assets.file_link, updated_at: media_assets.updated_at }).from(media_assets).where(and(eq(media_assets.id, content.artwork_asset_id), eq(media_assets.org_id, orgId))).limit(1))[0];
  if (!artworkRow) throw new ConflictError("Artwork asset not found");
  const catalog = (await client.select({ catalog_number: catalog_entries.catalog_number }).from(catalog_entries).where(and(eq(catalog_entries.org_id, orgId), eq(catalog_entries.release_id, release.id))).limit(1))[0];
  const token = stableHash({
    campaign_id: campaign.id,
    release_id: release.id,
    release_date: release.release_date,
    release_updated_at: release.updated_at?.toISOString() ?? null,
    track_ids: trackRows.map((track) => track.id),
    tracks: tracksSnapshot,
    track_updated_at: trackRows.map((track) => track.updated_at?.toISOString() ?? null),
    catalog_number: catalog?.catalog_number ?? null,
    artwork_id: artworkRow.id,
    artwork_release_id: artworkRow.linked_release_id,
    artwork_approval_status: artworkRow.approval_status,
    artwork_updated_at: artworkRow.updated_at?.toISOString() ?? null,
    artwork_link: artworkRow.file_link,
  });
  const releaseSnapshot: PublicPageReleaseSnapshot & { releaseDate: string | null; catalogNumber: string | null; tracks: readonly PublicPageTrack[] } = { id: release.id, campaignId: campaign.id, trackIds: trackRows.map((track) => track.id), sourceSnapshot: token, releaseDate: release.release_date, catalogNumber: catalog?.catalog_number ?? null, tracks: tracksSnapshot };
  const artwork: PublicPageArtworkSnapshot = { id: artworkRow.id, releaseId: artworkRow.linked_release_id, approvalStatus: artworkRow.approval_status, fileLink: artworkRow.file_link, sourceSnapshot: token };
  return { sourceSnapshot: token, snapshot: { token, release: releaseSnapshot, artwork }, release: releaseSnapshot, artwork };
}

function sameSnapshot(value: unknown, current: { token: string } | string) {
  const token = typeof current === "string" ? current : current.token;
  return Boolean(value && typeof value === "object" && (value as { token?: unknown }).token === token);
}

function hashContent(content: CampaignPublicPageContent) { return stableHash(content); }
function stableHash(value: unknown) { return createHash("sha256").update(JSON.stringify(sortForHash(value))).digest("hex"); }
function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortForHash(item)]));
  return value;
}
function redactPage(page: PageRow | undefined) { return page ? { id: page.id, campaign_id: page.campaign_id, slug: page.slug, status: page.status, current_draft_revision_id: page.current_draft_revision_id, current_published_revision_id: page.current_published_revision_id, created_at: page.created_at, updated_at: page.updated_at } : null; }
