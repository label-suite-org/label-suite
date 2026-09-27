import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("./audit", async original => {
  const actual = await original<typeof import("./audit")>();
  return { ...actual, writeAuditLog: async (...args: Parameters<typeof actual.writeAuditLog>) => {
    if (audit.fail) throw new Error("Fixture audit failure");
    return actual.writeAuditLog(...args);
  } };
});

const state = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const result = (value: unknown[]) => {
    const promise = Promise.resolve(value) as Promise<unknown[]> & { limit: () => Promise<unknown[]>; for: () => typeof promise; orderBy: () => typeof promise };
    promise.limit = () => promise;
    promise.for = () => promise;
    promise.orderBy = () => promise;
    return promise;
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const value = rows.shift() ?? [];
        const chain = { innerJoin: vi.fn(() => chain), where: vi.fn(() => result(value)), orderBy: vi.fn(() => result(value)) };
        return chain;
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => { updates.push(value); return { where: vi.fn(() => ({ returning: vi.fn(async () => [{ ...value as object }]) })) }; }) })),
    insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { inserts.push(value); return { returning: vi.fn(async () => [value]) }; }) })),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  };
  return { rows, updates, inserts, db };
});

vi.mock("../lib/db", () => ({ db: state.db }));

import {
  getPublishedCampaignPageBySlug,
  publishCampaignPublicPageRevision,
  publishCampaignPublicPageRevisionSchema,
  unpublishCampaignPublicPage,
} from "./campaign-public-page";

describe("campaign public page publication service", () => {
  beforeEach(() => {
    state.rows.length = 0;
    state.updates.length = 0;
    state.inserts.length = 0;
    vi.clearAllMocks();
  });

  it("rejects publication of an unreviewed revision and leaves the live pointer untouched", async () => {
    state.rows.push([{
      revision: { id: "revision-1", review_status: "draft", content: {} },
      page: { id: "page-1", org_id: "org-1", campaign_id: "campaign-1", current_published_revision_id: "live-1" },
    }]);
    await expect(publishCampaignPublicPageRevision("org-1", "campaign-1", "revision-1", "owner-1"))
      .rejects.toThrow("Revision is not reviewed");
    expect(state.updates).toHaveLength(0);
  });

  it("keeps unpublish history while clearing only the live pointer", async () => {
    state.rows.push([{ id: "page-1", org_id: "org-1", campaign_id: "campaign-1", current_published_revision_id: "revision-2", status: "published" }]);
    const result = await unpublishCampaignPublicPage("org-1", "campaign-1", "owner-1");
    expect(result.ok).toBe(true);
    expect(state.updates[0]).toMatchObject({ status: "unpublished", current_published_revision_id: null });
  });

  it("rejects an older reviewed revision after a new draft without changing public state", async () => {
    state.rows.push([{ revision: { id: "revision-1", review_status: "reviewed" },
      page: { id: "page-1", current_draft_revision_id: "revision-2", current_published_revision_id: "live-1" } }]);
    await expect(publishCampaignPublicPageRevision("org-1", "campaign-1", "revision-1", "owner-1"))
      .rejects.toThrow("A newer page draft exists");
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("uses unambiguous owner confirmations and rejects unknown publish fields", () => {
    expect(publishCampaignPublicPageRevisionSchema.parse({ revision_id: "r1", confirmation: "publish" })).toEqual({ revision_id: "r1", confirmation: "publish" });
    expect(publishCampaignPublicPageRevisionSchema.parse({ confirmation: "unpublish" })).toEqual({ confirmation: "unpublish" });
    expect(() => publishCampaignPublicPageRevisionSchema.parse({ revision_id: "r1", confirmation: "publish", slug: "mutated" })).toThrow();
  });

  it("does not expose a draft-only or stale page publicly", async () => {
    state.rows.push([]);
    await expect(getPublishedCampaignPageBySlug("draft-only")).resolves.toBeNull();
  });

  it("invalidates a reviewed revision when its canonical document changes", async () => {
    state.rows.push([{
      revision: {
        id: "revision-1",
        review_status: "reviewed",
        content_hash: "hash-of-the-reviewed-document",
        content: {
          label_line: "True Nature",
          title: "Fountain Edits",
          release_note: "Changed after review",
          release_note_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Changed after review" }] }] },
          artwork_asset_id: "artwork-1",
          focus_track_ids: ["track-1"],
          listen_url: "https://listen.example.test",
          download_url: null,
          metadata_url: null,
          contact_name: "Radio desk",
          contact_email: "radio@example.test",
          network_statement: "Shared with our independent radio network.",
        },
      },
      page: { id: "page-1", org_id: "org-1", campaign_id: "campaign-1", current_draft_revision_id: "revision-1", current_published_revision_id: null },
    }]);

    await expect(publishCampaignPublicPageRevision("org-1", "campaign-1", "revision-1", "owner-1"))
      .rejects.toThrow("Revision content changed after review");
    expect(state.updates).toHaveLength(0);
  });
});

describe.skipIf(!process.env.FOUNTAIN_PUBLIC_PAGE_INTEGRATION)("campaign public page PostgreSQL lifecycle", () => {
  const prefix = `fountain_page_test_${Date.now()}`;
  const orgId = `${prefix}_org`;
  const campaignId = `${prefix}_campaign`;
  const releaseId = `${prefix}_release`;
  const trackId = `${prefix}_track`;
  const artworkId = `${prefix}_artwork`;
  const author1 = `${prefix}_author1`;
  const author2 = `${prefix}_author2`;
  const reviewer = `${prefix}_reviewer`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let actual: typeof import("./campaign-public-page");
  let actualOutreach: typeof import("./campaign-outreach");
  let nativeRoute: typeof import("../pages/api/native/campaigns/[id]/public-page");
  const content = {
    label_line: "True Nature", title: "Fountain Edits", release_note: "Radio update",
    artwork_asset_id: artworkId, focus_track_ids: [trackId], listen_url: "https://listen.example.test",
    download_url: null, metadata_url: null, contact_name: "Radio Desk", contact_email: "radio@example.test",
    network_statement: "Shared with our independent radio network." as const,
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.doUnmock("../lib/db");
    vi.doUnmock("./campaign-public-page");
    actual = await import("./campaign-public-page");
    actualOutreach = await import("./campaign-outreach");
    vi.doMock("../lib/native-workspace", () => ({ resolveNativeActor: async () => ({ userId: author1, workspace: { role: "owner", org: { id: orgId } } }) }));
    nativeRoute = await import("../pages/api/native/campaigns/[id]/public-page");
    await pool.query("insert into label_suite.orgs (id,name,slug) values ($1,$2,$3)", [orgId, "Fountain Page Test", prefix]);
    await pool.query("insert into label_suite.user (id,name,email) values ($1,$2,$3),($4,$5,$6),($7,$8,$9)", [author1, "Author", `${prefix}-author@example.test`, author2, "Author Two", `${prefix}-author2@example.test`, reviewer, "Reviewer", `${prefix}-reviewer@example.test`]);
    await pool.query("insert into label_suite.org_memberships (id,org_id,user_id,role) values ($1,$2,$3,'owner'),($4,$2,$5,'operator')", [`${prefix}_owner`, orgId, author1, `${prefix}_operator`, reviewer]);
    await pool.query("insert into label_suite.releases (id,org_id,title,release_date) values ($1,$2,$3,$4)", [releaseId, orgId, "Fountain Release", "2026-08-01"]);
    await pool.query("insert into label_suite.campaigns (id,org_id,campaign_name,linked_release_id) values ($1,$2,$3,$4)", [campaignId, orgId, "Fountain Campaign", releaseId]);
    await pool.query("insert into label_suite.tracks (id,org_id,title,release_id,duration) values ($1,$2,$3,$4,$5)", [trackId, orgId, "Night Edit", releaseId, 210]);
    await pool.query("insert into label_suite.media_assets (id,org_id,asset_name,linked_release_id,approval_status,file_link) values ($1,$2,$3,$4,'approved',$5)", [artworkId, orgId, "Artwork", releaseId, "https://cdn.example.test/artwork.jpg"]);
  });
  afterAll(async () => {
    await pool.query("delete from label_suite.campaign_dogfood_entries where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.campaign_public_page_revisions where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.campaign_public_pages where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.media_assets where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.tracks where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.campaigns where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.releases where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.audit_logs where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.org_memberships where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.orgs where id=$1", [orgId]);
    await pool.query("delete from label_suite.user where email like $1", [`${prefix}-%@example.test`]);
    await pool.end();
  });

  it("serializes concurrent first saves, keeps the live revision after a new draft, and fails closed on canonical changes", async () => {
    const [first, second] = await Promise.all([
      actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "fountain-edits", content }, author1),
      actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "fountain-edits", content }, author2),
    ]);
    const versions = [first.revision.version, second.revision.version].sort();
    expect(versions).toEqual([1, 2]);
    const latest = first.revision.version === 2 ? first : second;
    const nativeResponse = await nativeRoute.GET({ params: { id: campaignId }, request: new Request(`https://suite.test/api/native/campaigns/${campaignId}/public-page`) } as never);
    expect(nativeResponse.status).toBe(200);
    const nativeDraft = await nativeResponse.json();
    expect(nativeDraft).toMatchObject({ campaign: { id: campaignId, name: "Fountain Campaign" }, revision: { id: latest.revision.id, review_status: "draft" }, blocker: null,
      preview: { content: { title: content.title, release_note: content.release_note }, tracks: [{ title: "Night Edit" }] } });
    expect(nativeDraft.preview.release_note_document).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Radio update" }] }] });
    await expect(actual.getNativeCampaignPublicPageReview(`${orgId}_other`, campaignId)).rejects.toThrow("Campaign not found");
    const reviewed = await actual.reviewCampaignPublicPageRevision(orgId, campaignId, latest.revision.id, reviewer);
    expect(reviewed.ok).toBe(true);
    audit.fail = true;
    try {
      await expect(actual.publishCampaignPublicPageRevision(orgId, campaignId, latest.revision.id, "owner-1")).rejects.toThrow("Fixture audit failure");
    } finally { audit.fail = false; }
    const unpublished = await actual.getCampaignPublicPageEditor(orgId, campaignId);
    expect(unpublished.page).toMatchObject({ status: "draft", current_published_revision_id: null });
    await actual.publishCampaignPublicPageRevision(orgId, campaignId, latest.revision.id, "owner-1");
    const auditRows = await pool.query("select actor_user_id, before_data, after_data, metadata from label_suite.audit_logs where org_id=$1 and action='campaign.public_page.published'", [orgId]);
    expect(auditRows.rows).toEqual([expect.objectContaining({ actor_user_id: "owner-1", after_data: { status: "published", revision_id: latest.revision.id }, metadata: expect.objectContaining({ campaign_id: campaignId, content_hash: reviewed.revision.content_hash }) })]);
    const liveBeforeDraft = await actual.getPublishedCampaignPageBySlug("fountain-edits");
    expect(liveBeforeDraft?.revision.version).toBe(2);
    const nativeReviewed = await actual.getNativeCampaignPublicPageReview(orgId, campaignId);
    expect(nativeReviewed).toMatchObject({ revision: { id: latest.revision.id, review_status: "reviewed" }, page: { current_published_revision_id: latest.revision.id }, blocker: null });
    expect(nativeReviewed.preview?.content).toEqual(liveBeforeDraft?.content);
    const draft = await actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "fountain-edits", content: { ...content, release_note: "New draft" } }, author1);
    expect(draft.revision.version).toBe(3);
    await expect(actual.publishCampaignPublicPageRevision(orgId, campaignId, latest.revision.id, "owner-1")).rejects.toThrow("A newer page draft exists");
    const liveAfterDraft = await actual.getPublishedCampaignPageBySlug("fountain-edits");
    expect(liveAfterDraft?.revision).toEqual(liveBeforeDraft?.revision);
    expect(liveAfterDraft?.publishedAt).toBe(liveBeforeDraft?.publishedAt);
    expect(liveAfterDraft?.updatedAt).toBe(liveBeforeDraft?.updatedAt);
    await pool.query("update label_suite.tracks set title='Changed after review' where id=$1", [trackId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.toBeNull();
    expect(await actual.getNativeCampaignPublicPageReview(orgId, campaignId)).toMatchObject({ revision: { id: draft.revision.id, content: expect.objectContaining({ release_note: "New draft" }) }, preview: null, blocker: "Page sources changed; save a new draft before review" });
  });

  it("enforces tenant-scoped editor reads and rejects punctuation-only slugs before insert", async () => {
    await expect(actual.getCampaignPublicPageEditor(`${orgId}_other`, campaignId)).resolves.toMatchObject({ page: null });
    await expect(actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "!!!", content }, author1)).rejects.toThrow("Slug must contain");
  });

  it("accepts a same-campaign dogfood revision link and rejects a cross-campaign link", async () => {
    const page = await actual.getCampaignPublicPageEditor(orgId, campaignId);
    const revisionId = page.page?.current_published_revision_id;
    if (!revisionId) throw new Error("fixture did not publish a revision");
    const accepted = await actualOutreach.createCampaignDogfoodEntry(orgId, { campaign_id: campaignId, entry_type: "improvement", severity: "P2", title: "Page feedback", details: null, ui_surface: null, status: "logged", evidence_url: null, linked_page_revision_id: revisionId });
    expect(accepted.ok).toBe(true);
    await actualOutreach.updateCampaignDogfoodEntry(orgId, { id: accepted.id, campaign_id: campaignId, linked_page_revision_id: revisionId });
    const otherCampaignId = `${prefix}_other_campaign`;
    await pool.query("insert into label_suite.campaigns (id,org_id,campaign_name,linked_release_id) values ($1,$2,$3,$4)", [otherCampaignId, orgId, "Other Campaign", releaseId]);
    const otherEntry = await actualOutreach.createCampaignDogfoodEntry(orgId, { campaign_id: otherCampaignId, entry_type: "improvement", severity: "P2", title: "Cross link", details: null, ui_surface: null, status: "logged", evidence_url: null });
    await expect(actualOutreach.updateCampaignDogfoodEntry(orgId, { id: otherEntry.id, campaign_id: otherCampaignId, linked_page_revision_id: revisionId })).rejects.toThrow("Campaign page revision not found");
  });

  it("checks fresh native authority, loaded snapshot, audit rollback and no outreach at publication", async () => {
    await pool.query("update label_suite.tracks set title='Night Edit' where id=$1", [trackId]);
    await actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "fountain-edits", content }, author1);
    const before = await actual.getNativeCampaignPublicPageReview(orgId, campaignId);
    const input = { revision_id: before.revision!.id, expected_review_token: before.revision!.review_token, confirmation: "review" };
    await expect(actual.applyNativePublicPageAction(orgId, campaignId, author2, input)).rejects.toMatchObject({ status: 403 });
    await expect(actual.applyNativePublicPageAction(orgId, campaignId, reviewer, { ...input, expected_review_token: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await actual.applyNativePublicPageAction(orgId, campaignId, reviewer, input);
    const reviewed = await actual.getNativeCampaignPublicPageReview(orgId, campaignId);
    const publish = { ...input, expected_review_token: reviewed.revision!.review_token, confirmation: "publish" };
    await expect(actual.applyNativePublicPageAction(orgId, campaignId, reviewer, publish)).rejects.toMatchObject({ status: 403 });
    await pool.query("update label_suite.org_memberships set role='member' where org_id=$1 and user_id=$2", [orgId, author1]);
    await expect(actual.applyNativePublicPageAction(orgId, campaignId, author1, publish)).rejects.toMatchObject({ status: 403 });
    await pool.query("update label_suite.org_memberships set role='owner' where org_id=$1 and user_id=$2", [orgId, author1]);
    audit.fail = true;
    try { await expect(actual.applyNativePublicPageAction(orgId, campaignId, author1, publish)).rejects.toThrow("Fixture audit failure"); }
    finally { audit.fail = false; }
    expect((await actual.getNativeCampaignPublicPageReview(orgId, campaignId)).page?.current_published_revision_id).toBe(before.page?.current_published_revision_id);
    const response = await nativeRoute.POST({ params: { id: campaignId }, request: new Request("https://suite.test/api/native/campaigns/current/public-page", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(publish) }) } as never);
    expect(response.status).toBe(200);
    expect((await actual.getNativeCampaignPublicPageReview(orgId, campaignId)).page?.current_published_revision_id).toBe(input.revision_id);
    await expect(actual.applyNativePublicPageAction(orgId, campaignId, author1, publish)).rejects.toMatchObject({ status: 409 });
    expect((await pool.query("select id from label_suite.campaign_outreach_events where org_id=$1", [orgId])).rows).toEqual([]);
  });

  it("returns null when canonical campaign, artwork, or stored content is unavailable", async () => {
    await pool.query("update label_suite.tracks set title='Night Edit' where id=$1", [trackId]);
    const freshDraft = await actual.saveCampaignPublicPageDraft(orgId, campaignId, { slug: "fountain-edits", content }, author1);
    await actual.reviewCampaignPublicPageRevision(orgId, campaignId, freshDraft.revision.id, reviewer);
    await actual.publishCampaignPublicPageRevision(orgId, campaignId, freshDraft.revision.id, "owner-1");
    const baseline = await actual.getPublishedCampaignPageBySlug("fountain-edits");
    expect(baseline).not.toBeNull();
    const revisionId = baseline?.revision.id;
    if (!revisionId) throw new Error("fixture did not publish a revision");
    await pool.query("update label_suite.campaigns set linked_release_id=null where id=$1", [campaignId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.toBeNull();
    await pool.query("update label_suite.campaigns set linked_release_id=$1 where id=$2", [releaseId, campaignId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.not.toBeNull();
    await pool.query("update label_suite.campaign_public_page_revisions set content='{}'::jsonb where id=$1", [revisionId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.toBeNull();
    await pool.query("update label_suite.campaign_public_page_revisions set content=$1::jsonb where id=$2", [JSON.stringify(content), revisionId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.not.toBeNull();
    await pool.query("delete from label_suite.media_assets where id=$1", [artworkId]);
    await expect(actual.getPublishedCampaignPageBySlug("fountain-edits")).resolves.toBeNull();
  });
});
