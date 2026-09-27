import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnalyticsDataQuality from "./AnalyticsDataQuality";
import type { AnalyticsDataQualityReport } from "../../server/analytics-data-quality";

const report: AnalyticsDataQualityReport = {
  health: { lastSuccessfulRunAt: new Date("2026-07-29T10:00:00Z"), sourceObservedAt: null, reportingThrough: new Date("2026-07-28T00:00:00Z"), freshnessBasis: "row_reporting_date", coverage: "complete", stale: false, failedRuns: 0, unreviewedDuplicateCandidates: 3, degradedReasons: [] },
  currentRun: {
    id: "run-current",
    mode: "sync",
    completedAt: new Date("2026-07-29T10:00:00Z"),
    requestedDateRange: "Last 30 days",
    requestedAggregation: "Daily",
    expectedWidgetKeys: ["tracks"],
    downloadedWidgetKeys: ["tracks"],
    skippedWidgets: [],
    observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
    rawFiles: [{ id: "file-1", source: "sisense", widgetKey: "tracks", fileName: "tracks.csv", sha256: "a".repeat(64), byteSize: 2048, rowCount: 2, requestedDateRange: "Last 30 days", requestedAggregation: "Daily", storageBucket: "evidence", storageKey: "sisense/run-current/tracks.csv", storageStatus: "uploaded", storageUploadedAt: new Date("2026-07-29T09:59:00Z") }],
  },
  evidence: { limit: 1_000, returnedRows: 2, partial: false, complete: true, version: "b".repeat(64) },
  sources: [{ source: "sisense", widgetKey: "tracks", requestedDateRange: "Last 30 days", requestedAggregation: "Daily", imported: 2, raw: 2, linked: 1, unmatched: 1, lastSeenAt: new Date("2026-07-29T10:00:00Z") }],
  candidates: [
    { key: "source", reason: "same_source_identity", rowIds: ["a", "b"], sourceKeys: ["a", "b"], isrc: null, artist: "Artist", title: "Track", disposition: "unreviewed" },
    { key: "isrc", reason: "same_isrc", rowIds: ["a", "b"], sourceKeys: ["a", "b"], isrc: "DKABC2600001", artist: null, title: null, disposition: "unreviewed" },
    { key: "title", reason: "same_artist_title", rowIds: ["a", "b"], sourceKeys: ["a", "b"], isrc: null, artist: "Artist", title: "Track", disposition: "unreviewed" },
  ],
};

describe("AnalyticsDataQuality", () => {
  it("renders current-run provenance and separate duplicate-reason groups", () => {
    const html = renderToStaticMarkup(<AnalyticsDataQuality report={report} />);

    expect(html).toContain("Current import run");
    expect(html).toContain("run-current");
    expect(html).toContain("tracks.csv");
    expect(html).toContain("evidence/sisense/run-current/tracks.csv");
    expect(html).toContain("Daily · Last 30 days");
    expect(html).toContain("Same source identity");
    expect(html).toContain("Same ISRC");
    expect(html).toContain("Same artist and title");
    expect(html).toContain("Source coverage");
    expect(html).toContain("Duplicate candidates");
    expect(html).toContain("Source observed");
    expect(html).toContain("Freshness basis");
    expect(html).toContain("Complete batched evidence: 2 rows reviewed.");
    expect(html).toContain("Observed empty widgets");
    expect(html).toContain("shazams-city (Query returned no matching rows.)");
    expect(html).toContain("Missing or unmatched data remains visible");
    // Only the two scrollable provenance regions are explicit tab stops.
    expect(html.match(/role="region" tabindex="0"/g)).toHaveLength(2);
    expect(html.match(/role="region"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Current import raw-file provenance"');
    expect(html).toContain('aria-label="Analytics source coverage"');
  });

  it("keeps absent import evidence and source coverage visible", () => {
    const html = renderToStaticMarkup(<AnalyticsDataQuality report={{
      ...report,
      health: { ...report.health, unreviewedDuplicateCandidates: 0 },
      currentRun: null,
      sources: [],
      candidates: [],
    }} />);

    expect(html).toContain("No current import evidence");
    expect(html).toContain("No source coverage rows");
  });

  it("explains degraded coverage in plain language without exposing an operator command", () => {
    const html = renderToStaticMarkup(<AnalyticsDataQuality report={{
      ...report,
      health: {
        ...report.health,
        sourceObservedAt: null,
        reportingThrough: null,
        freshnessBasis: "unknown",
        coverage: "partial",
        stale: true,
        degradedReasons: ["missing_widgets", "unknown_source_time"],
      },
    }} />);

    expect(html).toContain("Some analytics sources are missing");
    expect(html).toContain("reporting date could not be confirmed");
    expect(html).toContain("Affected headline metrics are marked unavailable");
    expect(html).not.toContain("npm run sisense:sync");
  });
});

it("does not describe never-imported data as a schema problem", () => {
  const empty: AnalyticsDataQualityReport = { ...report, currentRun: null, sources: [], candidates: [], evidence: { ...report.evidence, complete: false, partial: false, returnedRows: 0 }, health: { ...report.health, lastSuccessfulRunAt: null, coverage: "empty", failedRuns: 0, unreviewedDuplicateCandidates: 0 } };
  const html = renderToStaticMarkup(<AnalyticsDataQuality report={empty} />);
  expect(html).toContain("No automated Sisense import evidence yet");
  expect(html).not.toContain("schema state");
  expect(renderToStaticMarkup(<AnalyticsDataQuality report={{ ...empty, health: { ...empty.health, failedRuns: 1 } }} />)).toContain("Failed runs");
});
