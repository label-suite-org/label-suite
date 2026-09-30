import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ quality: vi.fn(), select: vi.fn(), execute: vi.fn() }));
vi.mock("../lib/db", () => ({ db: { select: mocks.select, execute: mocks.execute } }));
vi.mock("./analytics-data-quality", async () => ({
  ...await vi.importActual<typeof import("./analytics-data-quality")>("./analytics-data-quality"),
  listAnalyticsDataQuality: mocks.quality,
}));
import { listReleaseCockpit } from "./analytics";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("rejects stale release dates despite a healthy global import and keeps the page available when quality fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  mocks.execute.mockResolvedValue({ rows: [{ date: "2026-09-05", platform: "spotify", source: "fixture", streams: 12 }] });
  mocks.quality.mockResolvedValue({
    health: { coverage: "complete", freshnessBasis: "row_reporting_date", stale: false, lastSuccessfulRunAt: new Date(), degradedReasons: [] },
    evidence: { complete: true, partial: false },
  });
  installReleaseQueries();
  const cockpit = await listReleaseCockpit("tenant-a", "release-a");
  expect(cockpit?.dataQuality).toBe("stale");
  expect(cockpit?.dataWindow.to).toBe("2026-09-05");
  expect(mocks.quality).toHaveBeenCalledWith("tenant-a");

  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.quality.mockRejectedValue(new Error("Fixture quality unavailable"));
  installReleaseQueries();
  await expect(listReleaseCockpit("tenant-a", "release-a")).resolves.toMatchObject({ releaseId: "release-a", dataQuality: "unknown" });
  expect(warning).toHaveBeenCalledWith("Release analytics quality unavailable", { errorType: "Error" });
});

function installReleaseQueries() {
  const results = [[{ id: "release-a", title: "Fixture", artistName: null, format: null, releaseDate: null }], [], [], [], [], [], []];
  mocks.select.mockReset().mockImplementation(() => {
    const rows = results.shift() ?? [];
    const query: Record<string, unknown> = {};
    for (const method of ["from", "leftJoin", "where", "limit", "orderBy"]) query[method] = () => query;
    query.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return query;
  });
}
