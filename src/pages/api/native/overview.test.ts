import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const runtime = vi.hoisted(() => ({ context: null as { userId: string; orgId: string } | null }));
const database = vi.hoisted(() => ({
  runWithDatabaseContext: vi.fn(async (context: { userId: string; orgId: string }, operation: () => Promise<unknown>) => {
    runtime.context = context;
    try { return await operation(); }
    finally { runtime.context = null; }
  }),
}));
const artists = vi.hoisted(() => ({ listArtists: vi.fn() }));
const releases = vi.hoisted(() => ({ listReleases: vi.fn() }));
const campaigns = vi.hoisted(() => ({ listNativeCampaignSummaries: vi.fn() }));

vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/artists", () => artists);
vi.mock("../../../server/releases", () => releases);
vi.mock("../../../server/native-campaigns", () => campaigns);

import { GET } from "./overview";

describe("native label overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.context = null;
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" } } });
    artists.listArtists.mockImplementation(async (orgId: string) => runtime.context?.orgId === orgId
      ? [{ id: "artist-a", name: "Artist A", image_url: null }]
      : []);
    releases.listReleases.mockImplementation(async (orgId: string) => runtime.context?.orgId === orgId
      ? [{ id: "release-a", title: "Release A", artist_name: "Artist A" }]
      : []);
    campaigns.listNativeCampaignSummaries.mockImplementation(async (orgId: string) => ({
      items: runtime.context?.orgId === orgId ? [{ id: "campaign-a", name: "Campaign A" }] : [],
      next_cursor: null,
    }));
  });

  it("returns canonical label context from the selected tenant", async () => {
    const response = await GET({ request: new Request("https://suite.test/api/native/overview?workspaceId=org-a") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ artists: [{ id: "artist-a" }], releases: [{ id: "release-a" }], campaigns: [{ id: "campaign-a" }] });
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith(
      { userId: "user-a", orgId: "org-a" },
      expect.any(Function),
    );
    expect(artists.listArtists).toHaveBeenCalledWith("org-a");
    expect(releases.listReleases).toHaveBeenCalledWith("org-a");
  });

  it("rejects absent or removed workspace access", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    const response = await GET({ request: new Request("https://suite.test/api/native/overview") } as never);
    expect(response.status).toBe(401);
    expect(artists.listArtists).not.toHaveBeenCalled();
  });
});
