import { beforeEach, expect, it, vi } from "vitest";

const { readCommand } = vi.hoisted(() => ({ readCommand: vi.fn() }));
vi.mock("./analytics", () => ({ listAnalyticsCommandCenter: readCommand }));
vi.mock("./analytics-data-quality", () => ({ listAnalyticsDataQuality: async () => ({ health: {
  coverage: "complete", stale: false, failedRuns: 0, lastSuccessfulRunAt: null, degradedReasons: [],
} }) }));
vi.mock("../lib/db", () => ({ db: { transaction: async (read: (tx: unknown) => unknown) => read({
  select: () => ({ from: () => ({ where: () => ({ groupBy: async () => [] }) }) }),
}) } }));

import { getNativeAnalytics } from "./native-analytics";

const point = { date: "2026-07-01", spotify: 0, apple: 0, total: 0, cumulative: 0 };
const period = { key: "all", label: "All reported days", from: point.date, to: point.date,
  streamTotal: 0, previousStreamTotal: null, changePct: null,
  trendState: { kind: "insufficient", invalidRows: 0, totalRows: 1 }, dailyTrend: [point], insights: [],
};
const command = { dataWindow: { from: point.date, to: point.date }, periods: [period], catalog: {},
  availableArtists: [], availableReleases: [],
};

beforeEach(() => readCommand.mockReset());

it.each(["missing platform", "unverified coverage", "no observations"])("withholds %s from numeric-only native clients without manufacturing zeroes", async reason => {
  readCommand.mockResolvedValue({ ...command,
    ...(reason === "unverified coverage" ? { providerIntegrity: { status: "unverified" } } : {}),
    periods: [{ ...period, dailyTrend: reason === "no observations" ? []
      : [{ ...point, spotify: reason === "missing platform" ? null : 0 }] }],
  });
  const result = await getNativeAnalytics("fixture-org", {}, new Date("2026-07-02"));
  expect(result.periods).toEqual([]);
  expect(result.workspace_ingestion.degradedReasons).toContain("native_periods_withheld_unverified_or_missing_provider_data");
  expect(result.import_handoff.explanation).toContain("Period totals and forecasts are withheld");
});

it("preserves measured zero when both platform observations are known", async () => {
  readCommand.mockResolvedValue(command);
  const result = await getNativeAnalytics("fixture-org", {}, new Date("2026-07-02"));
  expect(result.periods[0].dailyTrend).toEqual([point]);
  expect(result.periods[0]).not.toHaveProperty("insights");
  expect(result.workspace_ingestion.degradedReasons).toEqual([]);
});
