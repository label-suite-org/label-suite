import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const releases = vi.hoisted(() => ({
  getReleaseDetail: vi.fn(),
  nativeUpdateReleaseSchema: undefined,
  updateReleaseForNative: vi.fn(),
}));
const campaigns = vi.hoisted(() => ({ listCampaignsForRelease: vi.fn() }));
const providers = vi.hoisted(() => ({ getNativeReleaseProviderContext: vi.fn() }));
const timeline = vi.hoisted(() => ({ getReleaseTimeline: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/native-session", () => ({ getNativeSession: native.getNativeSession }));
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/releases", async () => {
  const { z } = await import("zod");
  return {
    ...releases,
    nativeUpdateReleaseSchema: z.object({
      title: z.string().trim().min(1).optional(), expected_updated_at: z.string().datetime(),
    }).strict(),
  };
});
vi.mock("../../../../server/release-timeline", () => timeline);
vi.mock("../../../../server/native-release-provider-context", () => providers);
vi.mock("../../../../server/campaigns", () => campaigns);

import { PATCH } from "./[id]";
import { HttpError, NotFoundError } from "../../../../server/errors";

const detail = {
  id: "release-a", title: "Release A", artist_id: "artist-a", artist_name: "Artist A", cover_art_url: null,
  release_date: "2026-09-01", status: "scheduled", format: "single", upc_ean: null, release_ready: false, release_missing: "cover",
};

describe("native release mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaigns.listCampaignsForRelease.mockResolvedValue([]);
    native.getNativeSession.mockResolvedValue(null);
    providers.getNativeReleaseProviderContext.mockResolvedValue({ audio: { state: "unavailable" }, dsp: { state: "manual" } });
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    releases.getReleaseDetail.mockResolvedValue(detail);
    releases.updateReleaseForNative.mockResolvedValue({ id: "release-a" });
    timeline.getReleaseTimeline.mockResolvedValue({ currentPhaseKey: "assets_metadata", phases: [], childReleases: [] });
  });

  const request = (body: unknown) => new Request("https://suite.test/api/native/releases/release-a?workspaceId=org-a", {
    method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });

  it("distinguishes revoked workspace membership from a signed-out session", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    native.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
    const req = request({ title: "Nope", expected_updated_at: "2026-08-15T10:00:00.000Z" });
    req.headers.set("authorization", "Bearer valid-session");
    const response = await PATCH({ params: { id: "release-a" }, request: req } as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(releases.updateReleaseForNative).not.toHaveBeenCalled();
  });

  it("updates through the canonical revision-aware service and returns refreshed readiness", async () => {
    const body = { title: "Renamed", expected_updated_at: "2026-08-15T10:00:00.000Z" };
    const response = await PATCH({ params: { id: "release-a" }, request: request(body) } as never);
    expect(response.status).toBe(200);
    expect(releases.updateReleaseForNative).toHaveBeenCalledWith("org-a", { ...body, id: "release-a" }, "user-a");
    expect(timeline.getReleaseTimeline).toHaveBeenCalledWith("org-a", "release-a");
    expect(await response.json()).toMatchObject({ provider_context: { audio: { state: "unavailable" }, dsp: { state: "manual" } } });
  });

  it("does not invoke mutation services for read-only members", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    const response = await PATCH({ params: { id: "release-a" }, request: request({ title: "Nope", expected_updated_at: "2026-08-15T10:00:00.000Z" }) } as never);
    expect(response.status).toBe(403);
    expect(releases.updateReleaseForNative).not.toHaveBeenCalled();
  });

  it("returns validation, not found, and conflict errors without updating", async () => {
    const invalid = await PATCH({ params: { id: "release-a" }, request: request({ title: "No revision" }) } as never);
    expect(invalid.status).toBe(400);
    expect(releases.updateReleaseForNative).not.toHaveBeenCalled();

    releases.updateReleaseForNative.mockRejectedValueOnce(new NotFoundError("Release not found"));
    const missing = await PATCH({ params: { id: "release-a" }, request: request({ title: "Missing", expected_updated_at: "2026-08-15T10:00:00.000Z" }) } as never);
    expect(missing.status).toBe(404);

    releases.updateReleaseForNative.mockRejectedValueOnce(new HttpError("Release changed while updating; refresh and retry", 409));
    const stale = await PATCH({ params: { id: "release-a" }, request: request({ title: "Stale", expected_updated_at: "2026-08-15T10:00:00.000Z" }) } as never);
    expect(stale.status).toBe(409);
  });
});
