import { describe, expect, it } from "vitest";
import { parseAnalyticsRunCompleteness } from "../src/server/analytics-data-quality";
import {
  SANDBOX_FIXTURE_VERSION,
  SANDBOX_ID_PREFIX,
  buildAnalyticsSandboxFixture,
} from "./analytics-sandbox-fixtures";

describe("buildAnalyticsSandboxFixture", () => {
  it("builds the complete, visibly fictional analytics bundle", () => {
    const fixture = buildAnalyticsSandboxFixture("sandbox-org");

    expect(fixture.version).toBe("analytics-sandbox-v1");
    expect(fixture.artists).toHaveLength(3);
    expect(fixture.releases).toHaveLength(3);
    expect(fixture.tracks).toHaveLength(5);
    expect(fixture.metricRows).toHaveLength(78);
    expect(fixture.importRuns).toHaveLength(1);
    expect(new Set(fixture.metricRows.map((row) => row.widget_key))).toEqual(new Set([
      "spotify-streams-source",
      "apple-streams-source",
      "tracks-by-growth-rate",
      "spotify-superfans-active-streams-city",
      "spotify-demographics-passion-indicators",
      "spotify-playlist-listings",
      "passion-indicator-benchmarks-genre",
    ]));
    expect(fixture.artists.map((artist) => artist.name)).toEqual([
      "North Window",
      "Paper Lantern",
      "Salt Index",
    ]);
    expect(fixture.releases.map((release) => release.title)).toEqual([
      "Tide Lines",
      "Still Signal",
      "Amber Rooms",
    ]);
    expect(fixture.tracks.map((track) => track.title)).toEqual([
      "Low Current",
      "Glass Maps",
      "Soft Relay",
      "Night Index",
      "After Weather",
    ]);
  });

  it("uses deterministic sandbox-owned IDs, tenancy, and timestamps", () => {
    const fixture = buildAnalyticsSandboxFixture("sandbox-org");
    const records = [
      ...fixture.artists,
      ...fixture.releases,
      ...fixture.tracks,
      ...fixture.importRuns,
      ...fixture.metricRows,
    ];

    expect(SANDBOX_FIXTURE_VERSION).toBe("analytics-sandbox-v1");
    expect(SANDBOX_ID_PREFIX).toBe("sandbox-v1-");
    expect(records.every((record) => record.id.startsWith(SANDBOX_ID_PREFIX))).toBe(true);
    expect(records.every((record) => record.org_id === "sandbox-org")).toBe(true);
    expect(fixture.importRuns[0]).toMatchObject({
      source: "sisense",
      status: "completed",
      started_at: "2026-07-15T08:00:00.000Z",
      completed_at: "2026-07-15T08:00:00.000Z",
      rows_imported: fixture.metricRows.length,
      rows_inserted: fixture.metricRows.length,
      metadata: { sandbox_fixture: "analytics-sandbox-v1" },
    });
    expect(fixture.metricRows.every((row) => (
      row.first_seen_at === "2026-07-15T08:00:00.000Z"
      && row.last_seen_at === "2026-07-15T08:00:00.000Z"
      && row.dimensions._sandbox_fixture === "analytics-sandbox-v1"
    ))).toBe(true);
    expect(new Set(fixture.metricRows.map((row) => row.dimensions.date).filter(Boolean))).toEqual(new Set([
      "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07",
      "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14",
    ]));
  });

  it("returns an exactly identical bundle for the same organization", () => {
    expect(buildAnalyticsSandboxFixture("sandbox-org")).toEqual(buildAnalyticsSandboxFixture("sandbox-org"));
  });

  it("populates the canonical keys consumed by listAnalyticsTracksByGrowth", () => {
    const growthRows = buildAnalyticsSandboxFixture("sandbox-org").metricRows
      .filter((row) => row.widget_key === "tracks-by-growth-rate");

    expect(growthRows).toHaveLength(5);
    for (const row of growthRows) {
      expect(row.metrics).toMatchObject({
        combined_streams: expect.any(Number),
        spotify_streams: expect.any(Number),
        apple_streams: expect.any(Number),
        amazon_streams: expect.any(Number),
        pandora_streams: expect.any(Number),
        streams_growth: expect.any(Number),
        youtube_views: expect.any(Number),
        tiktok_views: expect.any(Number),
        combined_views: expect.any(Number),
        views_growth: expect.any(Number),
      });
      expect(row.metrics.combined_streams).toBeGreaterThan(0);
      expect(row.metrics.combined_streams).toBe(
        (row.metrics.spotify_streams ?? 0)
        + (row.metrics.apple_streams ?? 0)
        + (row.metrics.amazon_streams ?? 0)
        + (row.metrics.pandora_streams ?? 0),
      );
      expect(row.metrics.streams_growth).not.toBeNull();
      expect(row.metrics.views_growth).not.toBeNull();
      expect(row.metrics).not.toHaveProperty("growth_rate");
    }
  });

  it("populates the source and city keys consumed by listAnalyticsStreamSources and listAnalyticsCities", () => {
    const fixture = buildAnalyticsSandboxFixture("sandbox-org");
    const dailyRows = fixture.metricRows.filter((row) => row.widget_key.endsWith("-streams-source"));
    const cityRows = fixture.metricRows.filter((row) => row.widget_key === "spotify-superfans-active-streams-city");

    expect(dailyRows).toHaveLength(56);
    expect(dailyRows.every((row) => (
      typeof row.dimensions.date === "string"
      && typeof row.dimensions._col0 === "string"
      && typeof row.dimensions.source === "string"
      && (row.metrics.streams ?? 0) > 0
    ))).toBe(true);
    expect(cityRows).toHaveLength(6);
    expect(cityRows.every((row) => (row.metrics.streams ?? 0) > 0 && (row.metrics.listeners ?? 0) > 0)).toBe(true);
    expect(cityRows.every((row) => row.metrics.active_streams === undefined && row.metrics.superfans === undefined)).toBe(true);
  });

  it("marks the completed run as version-two complete evidence for parseAnalyticsRunCompleteness", () => {
    const fixture = buildAnalyticsSandboxFixture("sandbox-org");
    const completeness = parseAnalyticsRunCompleteness(fixture.importRuns[0]!.metadata, fixture.metricRows.length);

    expect(completeness.coverage).toBe("complete");
    expect(fixture.importRuns[0]!.metadata).toMatchObject({
      sandbox_fixture: "analytics-sandbox-v1",
      completeness: {
        version: 2,
        expectedWidgetKeys: [
          "apple-streams-source",
          "passion-indicator-benchmarks-genre",
          "spotify-demographics-passion-indicators",
          "spotify-playlist-listings",
          "spotify-streams-source",
          "spotify-superfans-active-streams-city",
          "tracks-by-growth-rate",
        ],
        downloadedWidgetKeys: [
          "apple-streams-source",
          "passion-indicator-benchmarks-genre",
          "spotify-demographics-passion-indicators",
          "spotify-playlist-listings",
          "spotify-streams-source",
          "spotify-superfans-active-streams-city",
          "tracks-by-growth-rate",
        ],
        observedEmptyWidgets: [],
        skippedWidgets: [],
        state: "complete",
      },
    });
  });

  it("namespaces deterministic IDs per organization without cross-organization references", () => {
    const alpha = buildAnalyticsSandboxFixture("alpha-org");
    const beta = buildAnalyticsSandboxFixture("beta-org");
    const alphaRecords = [...alpha.artists, ...alpha.releases, ...alpha.tracks, ...alpha.importRuns, ...alpha.metricRows];
    const betaRecords = [...beta.artists, ...beta.releases, ...beta.tracks, ...beta.importRuns, ...beta.metricRows];
    const alphaIds = new Set(alphaRecords.map((record) => record.id));
    const betaIds = new Set(betaRecords.map((record) => record.id));

    expect(alphaRecords.every((record) => record.id.startsWith("sandbox-v1-alpha-org:"))).toBe(true);
    expect(betaRecords.every((record) => record.id.startsWith("sandbox-v1-beta-org:"))).toBe(true);
    expect([...alphaIds].some((id) => betaIds.has(id))).toBe(false);

    for (const fixture of [alpha, beta]) {
      const artistIds = new Set(fixture.artists.map(({ id }) => id));
      const releaseIds = new Set(fixture.releases.map(({ id }) => id));
      const trackIds = new Set(fixture.tracks.map(({ id }) => id));
      const runIds = new Set(fixture.importRuns.map(({ id }) => id));
      expect(fixture.releases.every((release) => artistIds.has(release.artist_id))).toBe(true);
      expect(fixture.tracks.every((track) => track.release_id !== null && releaseIds.has(track.release_id))).toBe(true);
      expect(fixture.metricRows.every((row) => (
        (row.artist_id === null || artistIds.has(row.artist_id))
        && (row.release_id === null || releaseIds.has(row.release_id))
        && (row.track_id === null || trackIds.has(row.track_id))
        && runIds.has(row.first_seen_run_id)
        && runIds.has(row.last_seen_run_id)
      ))).toBe(true);
    }
  });
});
