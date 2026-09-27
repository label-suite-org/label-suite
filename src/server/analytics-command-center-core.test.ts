import { describe, expect, it } from "vitest";
import { buildAnalyticsCommandCenter, normalizeAnalyticsFilter, selectDashboardAnalyticsCards } from "./analytics-command-center-core";

const baseInput = {
  tracks: [
    {
      id: "track-a",
      trackTitle: "Cherry-coloured Funk",
      primaryArtist: "True Blue",
      combinedStreams: 1000,
      spotifyStreams: 800,
      appleStreams: 200,
      streamsGrowth: 0.25,
      combinedViews: 500,
      viewsGrowth: 0.1,
    },
    {
      id: "track-b",
      trackTitle: "Bad Behavior",
      primaryArtist: "True Blue",
      combinedStreams: 700,
      spotifyStreams: 690,
      appleStreams: 10,
      streamsGrowth: -0.05,
      combinedViews: 200,
      viewsGrowth: null,
    },
  ],
  cities: [
    { city: "New York, United States", streams: 500, listeners: 40, trackCount: 0 },
    { city: "Copenhagen, Denmark", streams: 250, listeners: 20, trackCount: 0 },
  ],
  playlists: [
    {
      id: "playlist-a",
      label: "discoverWeekly",
      dimensions: { playlist__name: "discoverWeekly" },
      metrics: { streams: 120, latest_position: null },
      lastSeenAt: "2026-07-05",
    },
  ],
  shazams: [
    {
      id: "shazam-a",
      label: "Paris, France",
      dimensions: { city: "Paris", country: "France" },
      metrics: { shazams: 44 },
      lastSeenAt: "2026-07-05",
    },
  ],
  widgets: [{ widgetKey: "csv-track-totals", rowCount: 2, trackCount: 2, lastSeenAt: "2026-07-05" }],
  runHistory: [{ status: "completed", completedAt: "2026-07-05", rowsImported: 10, rowsInserted: 10, rowsUpdated: 0, rowsUnchanged: 0, filesDownloaded: 1, error: null }],
  totalRows: 10,
  totalWidgets: 1,
  totalLinkedTracks: 2,
  lastSeenAt: "2026-07-05",
};

describe("analytics command center core", () => {
  it("clears a release that is outside the selected artist scope", () => {
    expect(normalizeAnalyticsFilter({ artistId: "artist-a", releaseId: "release-b" }, ["release-a"]))
      .toEqual({ artistId: "artist-a", releaseId: undefined });
    expect(normalizeAnalyticsFilter({ artistId: "artist-a", releaseId: "release-a" }, ["release-a"]))
      .toEqual({ artistId: "artist-a", releaseId: "release-a" });
    expect(normalizeAnalyticsFilter({ releaseId: "release-a" }, ["release-a"])).toEqual({ releaseId: "release-a" });
  });

  it("reserves a dashboard card slot for analytics data health", () => {
    const cards = [
      { key: "top-mover" },
      { key: "city" },
      { key: "source" },
      { key: "analytics-data-health" },
    ];

    expect(selectDashboardAnalyticsCards(cards, 3).map((card) => card.key))
      .toEqual(["top-mover", "city", "analytics-data-health"]);
  });

  it("builds period summaries with previous-period deltas and cumulative trend", () => {
    const dailySources = [
      { date: "2026-06-01", platform: "spotify", source: "radio", streams: 10 },
      { date: "2026-06-02", platform: "apple", source: "DISCOVERY", streams: 20 },
      { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
      { date: "2026-07-05", platform: "apple", source: "DISCOVERY", streams: 50 },
    ];

    const command = buildAnalyticsCommandCenter({ ...baseInput, dailySources });
    const last7 = command.periods.find((period) => period.key === "7d")!;

    expect(command.defaultPeriod).toBe("30d");
    expect(command.dataWindow).toEqual({ from: "2026-06-01", to: "2026-07-05" });
    expect(last7.streamTotal).toBe(150);
    expect(last7.previousStreamTotal).toBe(0);
    expect(last7.dailyTrend).toEqual([
      { date: "2026-07-04", spotify: 100, apple: 0, total: 100, cumulative: 100 },
      { date: "2026-07-05", spotify: 0, apple: 50, total: 50, cumulative: 150 },
    ]);
    expect(last7.topSource).toMatchObject({ source: "radio", platform: "spotify", streams: 100 });
  });

  it("flags trend state as valid when observations are available", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [
        { date: "2026-07-01", platform: "spotify", source: "radio", streams: 50 },
        { date: "2026-07-02", platform: "spotify", source: "radio", streams: 75 },
      ],
    });

    const period = command.periods.find((value) => value.key === "7d")!;
    expect(period.trendState.kind).toBe("valid");
    expect(period.dailyTrend).toHaveLength(2);
  });

  it("flags an empty period when no rows exist", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [],
    });

    const period = command.periods.find((value) => value.key === "7d")!;
    expect(period.trendState.kind).toBe("empty");
    expect(period.dailyTrend).toHaveLength(0);
  });

  it("preserves measured zero days while rejecting malformed counts and calendar dates", () => {
    const command = buildAnalyticsCommandCenter({ ...baseInput, dailySources: [
      { date: "2026-07-01", platform: "spotify", source: "radio", streams: 0 },
      { date: "2026-07-02", platform: "spotify", source: "radio", streams: "0" },
      ...[null, "", "bad", -1, Infinity].map(streams => ({ date: "2026-07-02", platform: "spotify", source: "radio", streams })),
      { date: "2026-02-30", platform: "spotify", source: "radio", streams: 10 },
      { date: "2026-13-01", platform: "spotify", source: "radio", streams: 10 },
    ] });
    const period = command.periods.find(value => value.key === "7d")!;
    expect(period.trendState).toMatchObject({ kind: "valid", invalidRows: 5 });
    expect(period.dailyTrend.map(point => point.total)).toEqual([0, 0]);
    expect(command.dataWindow).toEqual({ from: "2026-07-01", to: "2026-07-02" });
  });

  it("flags an invalid trend when period rows cannot be interpreted", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [
        { date: "not-a-date", platform: "spotify", source: "radio", streams: 10 as unknown as number },
        { date: "2026-07-05", platform: "spotify", source: "radio", streams: "bad" as unknown as number },
      ],
    });

    const period = command.periods.find((value) => value.key === "7d")!;
    expect(period.trendState.kind).toBe("invalid");
    expect(period.dailyTrend).toHaveLength(0);
  });

  it("treats all-undated rows as invalid rather than empty", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [
        { date: "not-a-date", platform: "spotify", source: "radio", streams: 10 },
      ],
    });

    const period = command.periods.find((value) => value.key === "7d")!;
    expect(period.trendState).toMatchObject({ kind: "invalid", invalidRows: 1, totalRows: 1 });
    expect(period.dailyTrend).toHaveLength(0);
  });

  it("marks trend as insufficient when only one sample point exists", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 12 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 24 },
      ],
    });

    const period = command.periods.find((value) => value.key === "7d")!;
    expect(period.trendState.kind).toBe("insufficient");
    expect(period.dailyTrend).toHaveLength(1);
  });

  it("surfaces decision signals for top mover, city, playlist, and data health", () => {
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      dailySources: [{ date: "2026-07-05", platform: "spotify", source: "radio", streams: 100 }],
    });

    expect(command.catalog.topMover?.trackTitle).toBe("Cherry-coloured Funk");
    expect(command.catalog.growingTracks).toBe(1);
    expect(command.catalog.decliningTracks).toBe(1);
  expect(command.markets.topCity?.city).toBe("New York, United States");
    expect(command.playlists.topPlaylist?.label).toBe("discoverWeekly");
    expect(command.dataHealth.latestRunStatus).toBe("completed");
    expect(command.periods.find((period) => period.key === "30d")?.insights).toHaveLength(4);
  });
});

it("keeps unknown geo buckets out of actionable market rankings", () => {
  const command = buildAnalyticsCommandCenter({
    ...baseInput,
    dailySources: [{ date: "2026-08-03", platform: "spotify", source: "radio", streams: 10 }],
    cities: [
      { city: "Unknown", streams: 9999, listeners: null, trackCount: 0 },
      { city: "New York", streams: 500, listeners: 40, trackCount: 0 },
    ],
  });

  expect(command.markets.topCity?.city).toBe("New York");
  expect(command.markets.topCities.map((row) => row.city)).not.toContain("Unknown");
  expect(command.periods[0]?.insights.find((insight) => insight.label === "Market")?.title).toBe("New York");
});
