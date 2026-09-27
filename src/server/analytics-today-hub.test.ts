import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));

import {
  buildTodayHub,
  isAnalyticsIngestionSchemaUnavailable,
  loadTodayAnalyticsDataQuality,
  unavailableAnalyticsDataQualityReport,
} from "./analytics";
import type { AnalyticsDataQualityReport } from "./analytics-data-quality";
import type { AnalyticsCommandCenter } from "./analytics-command-center-core";

const command = {
  periods: [{ key: "30d", insights: [] }],
  catalog: { topTracks: [], topMover: null },
  markets: { topCity: null },
  dataHealth: { lastSeenAt: null, totalRows: 0, totalWidgets: 0 },
} as unknown as AnalyticsCommandCenter;

describe("Today Hub analytics data health compatibility", () => {
  it("uses consistent English operator copy", () => {
    const copyCommand = {
      periods: [{ key: "30d", insights: [] }],
      catalog: {
        topMover: null,
        topTracks: [
          { id: "declining", trackTitle: "Track down", primaryArtist: null, combinedStreams: 1_200, streamsGrowth: -0.2 },
          { id: "growing", trackTitle: "Track up", primaryArtist: null, combinedStreams: 1_400, streamsGrowth: 0.2 },
        ],
      },
      markets: { topCity: { city: "Copenhagen", streams: 4_000, listeners: null } },
      dataHealth: { lastSeenAt: null, totalRows: 2, totalWidgets: 1 },
    } as unknown as AnalyticsCommandCenter;
    const healthyReport = {
      evidence: { partial: false },
      health: { stale: false, failedRuns: 0, unreviewedDuplicateCandidates: 0 },
    } as unknown as AnalyticsDataQualityReport;

    const cards = buildTodayHub(copyCommand, healthyReport).cards;

    expect(cards.map((card) => card.linkLabel)).toEqual(["Investigate", "Use momentum", "View markets"]);
    expect(cards.map((card) => card.detail).join(" ")).toContain("Unknown artist");
    expect(cards.at(-1)?.title).toBe("📍 Top market: Copenhagen");
  });

  it("returns a truthful degraded card when migration-owned schema is absent", async () => {
    const missingSchema = Object.assign(
      new Error('relation "analytics_duplicate_reviews" does not exist'),
      { code: "42P01" },
    );

    const report = await loadTodayAnalyticsDataQuality("org-1", async () => {
      throw missingSchema;
    });
    const hub = buildTodayHub(command, report);

    expect(report).toMatchObject({ compatibility: "schema_unavailable", health: { stale: true } });
    expect(hub.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "analytics-data-health",
        detail: expect.stringContaining("schema migration"),
      }),
    ]));
  });

  it("recognizes only missing ingestion tables or columns", () => {
    expect(isAnalyticsIngestionSchemaUnavailable(Object.assign(
      new Error('column "storage_status" does not exist'),
      { code: "42703" },
    ))).toBe(true);
    expect(isAnalyticsIngestionSchemaUnavailable(Object.assign(
      new Error('relation "artists" does not exist'),
      { code: "42P01" },
    ))).toBe(false);
  });

  it("does not swallow unrelated analytics query failures", async () => {
    const unrelated = Object.assign(new Error("database timeout"), { code: "57014" });
    await expect(loadTodayAnalyticsDataQuality("org-1", async (): Promise<AnalyticsDataQualityReport> => {
      throw unrelated;
    })).rejects.toBe(unrelated);
  });
});

it("keeps never-imported workspaces quiet but surfaces failed or incomplete imports", () => {
  const report: AnalyticsDataQualityReport = {
    ...unavailableAnalyticsDataQualityReport(),
    compatibility: undefined,
    health: { ...unavailableAnalyticsDataQualityReport().health, coverage: "empty" },
  };
  expect(buildTodayHub(command, report).cards).toEqual([]);
  expect(buildTodayHub(command, { ...report, health: { ...report.health, failedRuns: 1 } }).cards).toContainEqual(expect.objectContaining({ key: "analytics-data-health" }));
  const populated = { ...command, dataHealth: { ...command.dataHealth, totalRows: 1 } };
  expect(buildTodayHub(populated, { ...report, evidence: { ...report.evidence, partial: true } }).cards).toContainEqual(expect.objectContaining({ detail: expect.stringContaining("truncated") }));
});
