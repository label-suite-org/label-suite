import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const releases = vi.hoisted(() => ({ getReleaseDetail: vi.fn() }));
const timeline = vi.hoisted(() => ({ getReleaseTimeline: vi.fn() }));
const campaigns = vi.hoisted(() => ({ listCampaignsForRelease: vi.fn() }));
const providers = vi.hoisted(() => ({ getNativeReleaseProviderContext: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/native-session", () => ({ getNativeSession: native.getNativeSession }));
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/releases", () => releases);
vi.mock("../../../../server/release-timeline", () => timeline);
vi.mock("../../../../server/native-release-provider-context", () => providers);
vi.mock("../../../../server/campaigns", () => campaigns);

import { GET as detail } from "./[id]";

const requestFor = (id = "release-a") => new Request(`https://suite.test/api/native/releases/${id}?workspaceId=org-a`);

function allow(role: "owner" | "operator" | "fundraiser" | "member") {
  native.resolveNativeActor.mockResolvedValue({ userId: `${role}-a`, workspace: { org: { id: "org-a" }, role } });
}

describe("native release detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.getNativeSession.mockResolvedValue(null);
    allow("member");
    providers.getNativeReleaseProviderContext.mockResolvedValue({
      audio: { source: "samply", state: "unavailable", freshness: { state: "unknown", observed_at: null }, access: { state: "unavailable", reason: "No linked Samply project" }, item_count: 0, unresolved_item_count: 0 },
      dsp: { source: "canonical_dsp_pitches", state: "unavailable", freshness: { state: "unknown", observed_at: null }, pitches: [] },
    });
    releases.getReleaseDetail.mockResolvedValue({
      id: "release-a", title: "Release A", artist_id: "artist-a", artist_name: "Artist A", cover_art_url: null,
      release_date: "2026-09-01", status: "scheduled", format: "single", upc_ean: null, release_ready: false, release_missing: "cover",
    });
    timeline.getReleaseTimeline.mockResolvedValue({ currentPhaseKey: "assets_metadata", phases: [], childReleases: [] });
    campaigns.listCampaignsForRelease.mockResolvedValue([{ id: "campaign-a", campaign_name: "Autumn campaign", campaign_type: "editorial", status: "active" }]);
  });

  it.each(["owner", "operator", "fundraiser", "member"] as const)("permits %s read-only release detail access", async (role) => {
    allow(role);

    const response = await detail({ params: { id: "release-a" }, request: requestFor() } as never);

    expect(response.status).toBe(200);
    expect(releases.getReleaseDetail).toHaveBeenCalledWith("org-a", "release-a");
    expect(timeline.getReleaseTimeline).toHaveBeenCalledWith("org-a", "release-a");
    expect(providers.getNativeReleaseProviderContext).toHaveBeenCalledWith("org-a", "release-a");
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: `${role}-a`, orgId: "org-a" }, expect.any(Function));
  });

  it("returns a native detail with timeline phase and no mutation authority", async () => {
    const response = await detail({ params: { id: "release-a" }, request: requestFor() } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ release: { id: "release-a" }, phase: "assets_metadata", readiness: { blockers: ["cover"] }, provider_context: { audio: { source: "samply", state: "unavailable" } }, freshness: { state: "fresh" } });
    expect(body.campaigns).toEqual([{ id: "campaign-a", name: "Autumn campaign", type: "editorial", status: "active" }]);
    expect(body).not.toHaveProperty("can_mutate");
  });

  it("returns not found for a foreign release before timeline or provider reads", async () => {
    releases.getReleaseDetail.mockResolvedValueOnce(null);

    const response = await detail({ params: { id: "release-other" }, request: requestFor("release-other") } as never);

    expect(response.status).toBe(404);
    expect(timeline.getReleaseTimeline).not.toHaveBeenCalled();
    expect(providers.getNativeReleaseProviderContext).not.toHaveBeenCalled();
  });

  it("denies payees before every release and provider read", async () => {
    native.resolveNativeActor.mockResolvedValueOnce({ userId: "payee-a", workspace: { org: { id: "org-a" }, role: "payee" } });

    const response = await detail({ params: { id: "release-a" }, request: requestFor() } as never);

    expect(response.status).toBe(403);
    expect(releases.getReleaseDetail).not.toHaveBeenCalled();
    expect(timeline.getReleaseTimeline).not.toHaveBeenCalled();
    expect(providers.getNativeReleaseProviderContext).not.toHaveBeenCalled();
  });

  it("denies unauthenticated requests before every release and provider read", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);

    const response = await detail({ params: { id: "release-a" }, request: requestFor() } as never);

    expect(response.status).toBe(401);
    expect(releases.getReleaseDetail).not.toHaveBeenCalled();
    expect(timeline.getReleaseTimeline).not.toHaveBeenCalled();
    expect(providers.getNativeReleaseProviderContext).not.toHaveBeenCalled();
  });
});
