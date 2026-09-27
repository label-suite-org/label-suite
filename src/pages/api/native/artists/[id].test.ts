import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({
  runWithDatabaseContext: vi.fn(async (context: { userId: string; orgId: string }, operation: () => Promise<unknown>) => {
    try { return await operation(); }
    finally { void context; }
  }),
}));
const artists = vi.hoisted(() => ({ getArtistDetail: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/artists", () => artists);

import { GET } from "./[id]";
import * as route from "./[id]";

describe("native artist detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" } } });
    artists.getArtistDetail.mockResolvedValue({
      artist: {
        id: "artist-a", name: "Artist A", image_url: null, bio: "A bio", spotify_id: "spotify-a",
        spotify_followers: 1200, spotify_popularity: 42, pro: "KODA", ipi: "IPI-A", instagram: "artist-a", tiktok: null,
        relationship: "roster", contact_id: "contact-a",
      },
      releases: [{ id: "release-a", title: "Release A", release_date: "2026-09-01", status: "scheduled", cover_art_url: null }],
      campaigns: [{ id: "campaign-a", campaign_name: "Campaign A", campaign_type: "editorial", status: "active", linked_release_id: "release-a", release_title: "Release A", owner: "operator" }],
      mediaAssets: [{ id: "asset-a" }],
      documents: [],
      rights: [{ id: "right-a" }],
      tasks: [{ id: "task-a", task_name: "Finish bio", status: "open", priority: "high", due_date: "2026-08-20", next_action: "Review" }],
      primaryContact: { id: "contact-a", name: "Contact A" },
    });
  });

  it("returns a bounded read-only projection scoped to the selected workspace and record", async () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "PATCH", "prerender"]);
    const response = await GET({
      params: { id: "artist-a" },
      request: new Request("https://suite.test/api/native/artists/artist-a?workspaceId=org-a"),
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artist: {
        id: "artist-a", name: "Artist A", image_url: null, image_state: "missing", bio: "A bio", contact_id: "contact-a",
        relationship: "roster", spotify_id: "spotify-a", spotify_followers: 1200, spotify_popularity: 42,
        pro: "KODA", ipi: "IPI-A", instagram: "artist-a", tiktok: null,
      },
      readiness: { complete: 7, total: 9, missing: ["Image", "TikTok"] },
      relationships: {
        releases: [{ id: "release-a", title: "Release A", release_date: "2026-09-01", status: "scheduled", cover_art_url: null }],
        campaigns: [{ id: "campaign-a", name: "Campaign A", type: "editorial", status: "active", release_id: "release-a", release_title: "Release A", owner: "operator" }],
        tasks: [{ id: "task-a", name: "Finish bio", status: "open", priority: "high", due_date: "2026-08-20", next_action: "Review" }],
        primary_contact: { id: "contact-a", name: "Contact A" },
        counts: { releases: 1, campaigns: 1, works: 0, rights: 1, tasks: 1, assets: 1, documents: 0 },
      },
    });
    expect(artists.getArtistDetail).toHaveBeenCalledWith("org-a", "artist-a");
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
  });

  it("rejects absent or removed workspace access", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    const response = await GET({ params: { id: "artist-a" }, request: new Request("https://suite.test/api/native/artists/artist-a") } as never);
    expect(response.status).toBe(401);
    expect(artists.getArtistDetail).not.toHaveBeenCalled();
  });

  it("returns not found when the canonical artist is outside the workspace", async () => {
    artists.getArtistDetail.mockResolvedValue({ artist: null, releases: [], campaigns: [], mediaAssets: [], documents: [], rights: [], tasks: [], primaryContact: null });
    const response = await GET({ params: { id: "artist-other" }, request: new Request("https://suite.test/api/native/artists/artist-other?workspaceId=org-a") } as never);
    expect(response.status).toBe(404);
  });
});
