import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ catalogues: vi.fn(), command: vi.fn(), quality: vi.fn(), select: vi.fn() }));
vi.mock("../lib/db", () => ({ db: { transaction: (operation: (tx: unknown) => unknown) => operation({ select: mocks.select }) } }));
vi.mock("./analytics", () => ({ listAnalyticsCommandCenter: mocks.command }));
vi.mock("./analytics-data-quality", () => ({ listAnalyticsDataQuality: mocks.quality }));
vi.mock("./native-music-import", () => ({ listNativeMusicCatalogues: mocks.catalogues }));
import { getNativeAnalytics } from "./native-analytics";
function query(rows: unknown[]) {
  const chain = { from: () => chain, where: () => chain, limit: async () => rows, groupBy: async () => rows };
  return chain;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockImplementation(() => query([]));
  mocks.catalogues.mockResolvedValue([{ runId: "capture-a", artistId: "artist-a", rows: [{ value: null }, { value: 0 }] }]);
  mocks.command.mockResolvedValue({ periods: [], dataWindow: { to: null }, catalog: {}, availableArtists: [], availableReleases: [], providerIntegrity: { verified: false } });
  mocks.quality.mockResolvedValue({ health: { degradedReasons: ["stale"] } });
});
it("reads captures from the authenticated workspace without converting unknown values or claiming daily coverage", async () => {
  const result = await getNativeAnalytics("org-a", {});
  expect(mocks.catalogues).toHaveBeenCalledWith("org-a", undefined);
  expect(result.native_catalogues[0].rows).toEqual([{ value: null }, { value: 0 }]);
  expect(result.periods).toEqual([]);
  expect(result.reporting.through).toBeNull();
  expect(result.workspace_ingestion.degradedReasons).toContain("stale");
});
it("forwards only the validated artist and withholds artist-wide captures for a release", async () => {
  mocks.select.mockReturnValueOnce(query([{ id: "artist-a", name: "Artist A" }]));
  await getNativeAnalytics("org-a", { artist_id: "artist-a" });
  expect(mocks.catalogues).toHaveBeenCalledWith("org-a", "artist-a");
  mocks.catalogues.mockClear();
  mocks.select.mockReturnValueOnce(query([{ id: "release-a", title: "Release A", artist_id: "artist-a" }]));
  expect((await getNativeAnalytics("org-a", { release_id: "release-a" })).native_catalogues).toEqual([]);
  expect(mocks.catalogues).not.toHaveBeenCalled();
});
it("rejects an inaccessible artist before loading captures", async () => {
  await expect(getNativeAnalytics("org-a", { artist_id: "foreign" })).rejects.toThrow("Artist not found");
  expect(mocks.catalogues).not.toHaveBeenCalled();
});
