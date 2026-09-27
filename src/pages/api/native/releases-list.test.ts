import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const releases = vi.hoisted(() => ({ listReleaseRoster: vi.fn() }));
const timelines = vi.hoisted(() => ({ listReleaseTimelinePhases: vi.fn() }));

vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/releases", () => releases);
vi.mock("../../../server/release-timeline", () => timelines);

import { GET as list } from "./releases";

describe("native release pipeline route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" } } });
    releases.listReleaseRoster.mockResolvedValue([{
      id: "release-a", title: "Release A", artist_name: "Artist A", cover_art_url: null, release_date: "2026-09-01",
      status: "scheduled", release_ready: false, missing_release_fields: ["cover"],
    }]);
    timelines.listReleaseTimelinePhases.mockResolvedValue(new Map([["release-a", "assets_metadata"]]));
  });

  it("lists only the selected workspace's release pipeline", async () => {
    const response = await list({ request: new Request("https://suite.test/api/native/releases?workspaceId=org-a") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, has_more: false, items: [{ id: "release-a", phase: "assets_metadata", readiness: "blocked", blockers: ["cover"] }] });
    expect(releases.listReleaseRoster).toHaveBeenCalledWith("org-a");
    expect(timelines.listReleaseTimelinePhases).toHaveBeenCalledWith("org-a", expect.arrayContaining([expect.objectContaining({ id: "release-a" })]));
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
  });

  it("rejects absent workspace access", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    const response = await list({ request: new Request("https://suite.test/api/native/releases") } as never);
    expect(response.status).toBe(401);
    expect(releases.listReleaseRoster).not.toHaveBeenCalled();
  });
});
