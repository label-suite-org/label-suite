import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";
process.env.DATABASE_URL ??= "postgres://label_suite:label_suite@127.0.0.1:55432/label_suite";

const service = vi.hoisted(() => ({
  getCampaignPublicPageEditor: vi.fn().mockResolvedValue({ page: null, draft: null, revisions: [] }),
  getCampaignPublicPageRevisionPreview: vi.fn().mockResolvedValue({ content: { title: "Fountain Edits" }, tracks: [], artworkUrl: "https://example.test/art.jpg" }),
  saveCampaignPublicPageDraft: vi.fn().mockResolvedValue({ ok: true }),
  reviewCampaignPublicPageRevision: vi.fn().mockResolvedValue({ ok: true }),
  publishCampaignPublicPageRevision: vi.fn().mockResolvedValue({ ok: true }),
  unpublishCampaignPublicPage: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./campaign-public-page", async () => {
  const actual = await vi.importActual<typeof import("./campaign-public-page")>("./campaign-public-page");
  return { ...actual, ...service };
});
vi.mock("./tenant", () => ({
  requireCapability: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole !== "operator" && locals.membershipRole !== "owner") throw new HttpError("Insufficient permissions", 403);
    return locals.orgId ?? "org-1";
  },
  requireOwnerRole: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole !== "owner") throw new HttpError("Owner role required", 403);
    return locals.orgId ?? "org-1";
  },
}));

describe("campaign public page routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows an operator to save a draft but never publishes implicitly", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/public-page");
    const content = {
      label_line: "True Nature",
      title: "Fountain Edits",
      release_note: "Notes",
      artwork_asset_id: "art-1",
      focus_track_ids: ["track-1"],
      listen_url: "https://listen.example.test",
      download_url: null,
      metadata_url: null,
      contact_name: "Malthe",
      contact_email: "malthe@example.test",
      network_statement: "Shared with our independent radio network.",
    };
    const response = await POST({
      request: new Request("https://suite.test/api/campaigns/campaign-1/public-page", { method: "POST", body: JSON.stringify({ slug: "fountain-edits", content }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } },
    } as never);
    expect(response.status).toBe(201);
    expect(service.saveCampaignPublicPageDraft).toHaveBeenCalledWith("org-1", "campaign-1", expect.objectContaining({ slug: "fountain-edits" }), "operator-1");
    expect(service.publishCampaignPublicPageRevision).not.toHaveBeenCalled();
  });

  it("returns 403 to an operator attempting owner-only publication", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/public-page/publish");
    const response = await POST({
      request: new Request("https://suite.test/api/campaigns/campaign-1/public-page/publish", { method: "POST", body: JSON.stringify({ revision_id: "revision-1", confirmation: "publish" }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } },
    } as never);
    expect(response.status).toBe(403);
    expect(service.publishCampaignPublicPageRevision).not.toHaveBeenCalled();
  });

  it("rejects extra fields on publication input", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/public-page/publish");
    const response = await POST({
      request: new Request("https://suite.test/api/campaigns/campaign-1/public-page/publish", { method: "POST", body: JSON.stringify({ revision_id: "revision-1", confirmation: "publish", slug: "mutated" }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "owner", user: { id: "owner-1" } },
    } as never);
    expect(response.status).toBe(400);
    expect(service.publishCampaignPublicPageRevision).not.toHaveBeenCalled();
  });

  it("allows an operator to review the path campaign revision", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/public-page/review");
    const response = await POST({
      request: new Request("https://suite.test/api/campaigns/campaign-path/public-page/review", { method: "POST", body: JSON.stringify({ revision_id: "revision-1" }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-path" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } },
    } as never);
    expect(response.status).toBe(200);
    expect(service.reviewCampaignPublicPageRevision).toHaveBeenCalledWith("org-1", "campaign-path", "revision-1", "operator-1");
  });

  it("returns only the server-derived reviewed preview projection", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/public-page/preview");
    const response = await GET({
      url: new URL("https://suite.test/api/campaigns/campaign-1/public-page/preview?revision_id=revision-1"),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ content: { title: "Fountain Edits" } });
    expect(service.getCampaignPublicPageRevisionPreview).toHaveBeenCalledWith("org-1", "campaign-1", "revision-1");
  });

  it("denies operator unpublish and missing actors", async () => {
    const { POST: publish } = await import("../pages/api/campaigns/[id]/public-page/publish");
    const denied = await publish({
      request: new Request("https://suite.test/api/campaigns/campaign-1/public-page/publish", { method: "POST", body: JSON.stringify({ confirmation: "unpublish" }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } },
    } as never);
    expect(denied.status).toBe(403);

    const { POST: draft } = await import("../pages/api/campaigns/[id]/public-page");
    const missingActor = await draft({
      request: new Request("https://suite.test/api/campaigns/campaign-1/public-page", { method: "POST", body: JSON.stringify({ slug: "fountain-edits", content: {} }), headers: { "content-type": "application/json" } }),
      params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);
    expect(missingActor.status).toBe(401);
  });
});
