import { describe, expect, it, vi } from "vitest";
import { addImportedFileCounts, analyticsDuplicateReviewSchema, assertAnalyticsDuplicateReviewCurrent, countAnalyticsIngestionFailuresSinceLastSuccess, deriveReportingThrough, evaluateAnalyticsIngestionServiceHealth, evaluateAnalyticsIngestionServiceStatus, findAnalyticsDuplicateCandidates, getAnalyticsIngestionServiceHealthFromProbe, getAnalyticsIngestionServiceStatusFromProbe, isAnalyticsEvidenceComplete, isAnalyticsEvidencePartial, isAnalyticsIngestionStale, parseAnalyticsRunCompleteness, resolveAnalyticsFreshness, type AnalyticsEvidenceRow } from "./analytics-data-quality";
import { HttpError } from "./errors";

function row(input: Partial<AnalyticsEvidenceRow> & Pick<AnalyticsEvidenceRow, "id">): AnalyticsEvidenceRow {
  return {
    id: input.id,
    source: input.source ?? "sisense",
    widgetKey: input.widgetKey ?? "tracks-by-growth-rate",
    sourceId: input.sourceId ?? null,
    isrc: input.isrc ?? null,
    artist: input.artist ?? null,
    title: input.title ?? null,
    metricGrain: input.metricGrain ?? "track:all-time",
  };
}

describe("findAnalyticsDuplicateCandidates", () => {
  it("detects normalized ISRC evidence without merging source rows", () => {
    const candidates = findAnalyticsDuplicateCandidates([
      row({ id: "a", sourceId: "1", isrc: "DKABC2600001" }),
      row({ id: "b", sourceId: "2", isrc: "DK-ABC-26-00001" }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      reason: "same_isrc",
      rowIds: ["a", "b"],
      sourceKeys: ["sisense:tracks-by-growth-rate:1", "sisense:tracks-by-growth-rate:2"],
      isrc: "DKABC2600001",
      disposition: "unreviewed",
    });
  });

  it("detects artist and title evidence only at a compatible metric grain", () => {
    const candidates = findAnalyticsDuplicateCandidates([
      row({ id: "a", artist: "True Blue", title: "Track", sourceId: "spotify" }),
      row({ id: "b", artist: " true blue ", title: "TRACK", sourceId: "apple" }),
      row({ id: "c", artist: "True Blue", title: "Track", sourceId: "daily", metricGrain: "track:daily" }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ reason: "same_artist_title", rowIds: ["a", "b"] });
  });

  it("preserves overlapping duplicate candidates for explicit review", () => {
    const candidates = findAnalyticsDuplicateCandidates([
      row({ id: "a", sourceId: "provider-row-1", isrc: "DKABC2600001" }),
      row({ id: "b", sourceId: "provider-row-1", isrc: "DKABC2600001" }),
    ]);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "same_source_identity", rowIds: ["a", "b"] }),
      expect.objectContaining({ reason: "same_isrc", rowIds: ["a", "b"] }),
    ]));
  });

  it("does not compare the same source identity across incompatible ranges", () => {
    expect(findAnalyticsDuplicateCandidates([
      row({ id: "all", sourceId: "provider-1", metricGrain: "tracks:daily:All Dates" }),
      row({ id: "recent", sourceId: "provider-1", metricGrain: "tracks:daily:Last 30 days" }),
    ])).toEqual([]);
  });

  it("preserves exact source-ID case and structured identity boundaries", () => {
    expect(findAnalyticsDuplicateCandidates([
      row({ id: "upper", sourceId: "Provider-ID" }),
      row({ id: "lower", sourceId: "provider-id" }),
    ])).toEqual([]);

    expect(findAnalyticsDuplicateCandidates([
      row({ id: "one", source: "sisense:tracks", widgetKey: "growth", sourceId: "provider-1" }),
      row({ id: "two", source: "sisense", widgetKey: "tracks:growth", sourceId: "provider-1" }),
    ])).toEqual([]);
  });

  it("rejects sentinel and malformed ISRC values", () => {
    expect(findAnalyticsDuplicateCandidates([
      row({ id: "a", sourceId: "1", isrc: "N/A" }),
      row({ id: "b", sourceId: "2", isrc: "NA" }),
      row({ id: "c", sourceId: "3", isrc: "DKABC260001" }),
      row({ id: "d", sourceId: "4", isrc: "DKABC260001" }),
    ])).toEqual([]);
  });

  it("creates deterministic candidate keys independent of evidence row order", () => {
    const evidence = [
      row({ id: "a", sourceId: "one", isrc: "DKABC2600001" }),
      row({ id: "b", sourceId: "two", isrc: "DKABC2600001" }),
    ];
    const keys = findAnalyticsDuplicateCandidates(evidence).map((candidate) => candidate.key);
    expect(findAnalyticsDuplicateCandidates(evidence.slice().reverse()).map((candidate) => candidate.key)).toEqual(keys);
    expect(keys[0]).toMatch(/^same_isrc:[a-f0-9]{64}$/);
  });
});

describe("addImportedFileCounts", () => {
  it("retains an empty imported widget as evidence instead of throwing", () => {
    expect(addImportedFileCounts(new Map(), [{ source: "sisense", widgetKey: "empty-widget", rowCount: 0 }]))
      .toEqual([{ source: "sisense", widgetKey: "empty-widget", requestedDateRange: null, requestedAggregation: null, imported: 0, raw: 0, linked: 0, unmatched: 0, lastSeenAt: null }]);
  });

  it("sums every file for a widget in the latest completed run", () => {
    expect(addImportedFileCounts(new Map(), [
      { source: "sisense", widgetKey: "tracks", rowCount: 12 },
      { source: "sisense", widgetKey: "tracks", rowCount: 12 },
    ])).toMatchObject([{ source: "sisense", widgetKey: "tracks", imported: 24 }]);
  });
});

describe("duplicate review API contract", () => {
  const evidenceVersion = "a".repeat(64);
  const current = { evidence: { limit: 1_000, returnedRows: 2, partial: false, complete: true, version: evidenceVersion }, candidates: [row({ id: "candidate" })].map((candidate) => ({ key: candidate.id })) } as never;

  it("requires the evidence version at the HTTP boundary", () => {
    expect(analyticsDuplicateReviewSchema.safeParse({ candidateKey: "candidate", disposition: "keep_separate" }).success).toBe(false);
  });

  it("rejects stale versions and orphaned candidates before an upsert", () => {
    expect(() => assertAnalyticsDuplicateReviewCurrent(current, { candidateKey: "candidate", evidenceVersion: "b".repeat(64) })).toThrow(HttpError);
    expect(() => assertAnalyticsDuplicateReviewCurrent(current, { candidateKey: "orphaned", evidenceVersion })).toThrow("no longer present");
  });
});

it("keeps complete evidence reviewable above the per-query batch size", () => {
  expect(isAnalyticsEvidencePartial(1_000)).toBe(false);
  expect(isAnalyticsEvidencePartial(1_832)).toBe(false);
});

describe("deriveReportingThrough", () => {
  it("uses source date evidence rather than the ingestion observation time", () => {
    expect(deriveReportingThrough([
      { dimensions: { Date: "2026-07-01" }, rawRow: {}, lastSeenAt: new Date("2026-07-29T12:00:00Z") },
    ])).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("recognizes Periscope's _col0 reporting-date column", () => {
    expect(deriveReportingThrough([
      { dimensions: { _col0: "2026-08-03" }, rawRow: {}, lastSeenAt: new Date("2026-08-10T12:00:00Z") },
    ])).toEqual(new Date("2026-08-03T00:00:00.000Z"));
  });

  it("does not promote release or ingestion dates into source reporting freshness", () => {
    expect(deriveReportingThrough([
      { dimensions: { release_date: "2026-07-30", added_at: "2026-07-29", Date: null }, rawRow: { created_at: "2026-07-28" }, lastSeenAt: new Date("2026-07-30T12:00:00Z") },
    ])).toBeNull();
  });
});

it("does not compare evidence from different requested ranges", () => {
  expect(findAnalyticsDuplicateCandidates([
    row({ id: "all", isrc: "DKABC2600001", metricGrain: "tracks:daily:All Dates" }),
    row({ id: "recent", isrc: "DKABC2600001", metricGrain: "tracks:daily:Last 30 days" }),
  ])).toEqual([]);
});

describe("isAnalyticsIngestionStale", () => {
  it("does not call stale source data current merely because it was re-imported today", () => {
    expect(isAnalyticsIngestionStale({
      lastSuccessfulRunAt: new Date("2026-07-29T12:00:00Z"),
      reportingThrough: new Date("2026-07-01T00:00:00Z"),
      now: new Date("2026-07-29T12:00:00Z"),
    })).toBe(true);
  });

  it("degrades unknown reporting coverage and an empty latest feed", () => {
    expect(isAnalyticsIngestionStale({ lastSuccessfulRunAt: new Date("2026-07-29T12:00:00Z"), reportingThrough: null, now: new Date("2026-07-29T12:00:00Z") })).toBe(true);
  });
});

describe("analytics freshness contract", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("treats a complete date-less sync snapshot as fresh observation evidence", () => {
    const freshness = resolveAnalyticsFreshness({
      mode: "sync",
      completedAt: now,
      reportingThrough: null,
      coverage: "complete",
      totalRows: 1_832,
      now,
    });

    expect(freshness).toMatchObject({ freshnessBasis: "snapshot_observed_at", sourceObservedAt: now, stale: false, coverage: "complete" });
    expect(evaluateAnalyticsIngestionServiceStatus({ ...freshness, lastSuccessfulRunAt: now, failedRuns: 0 }, now)).toBe("ok");
  });

  it("does not turn an import replay into a reporting-time claim", () => {
    const freshness = resolveAnalyticsFreshness({
      mode: "import",
      completedAt: now,
      reportingThrough: null,
      coverage: "complete",
      totalRows: 1_832,
    });

    expect(freshness).toMatchObject({ freshnessBasis: "unknown", sourceObservedAt: null, stale: true });
    expect(evaluateAnalyticsIngestionServiceStatus({ ...freshness, lastSuccessfulRunAt: now, failedRuns: 0 }, now)).toBe("degraded");
  });

  it.each(["partial", "empty", "invalid"] as const)("does not treat a %s sync as an observed source snapshot", (coverage) => {
    const freshness = resolveAnalyticsFreshness({ mode: "sync", completedAt: now, reportingThrough: null, coverage, totalRows: coverage === "empty" ? 0 : 1_832 });
    expect(freshness).toMatchObject({ freshnessBasis: "unknown", sourceObservedAt: null, stale: true });
  });
});

describe("versioned completeness contract", () => {
  const complete = { completeness: { version: 1, state: "complete", expectedWidgetKeys: ["a", "b"], downloadedWidgetKeys: ["a", "b"], skippedWidgets: [] } };

  it("accepts only an exact complete widget contract", () => {
    expect(parseAnalyticsRunCompleteness(complete, 1_832)).toMatchObject({ coverage: "complete", expectedWidgetKeys: ["a", "b"] });
    expect(parseAnalyticsRunCompleteness({ completeness: { ...complete.completeness, state: "partial", skippedWidgets: [] } }, 1_832).coverage).toBe("invalid");
    expect(parseAnalyticsRunCompleteness({ completeness: { ...complete.completeness, state: "complete", downloadedWidgetKeys: ["a"] } }, 1_832).coverage).toBe("invalid");
    expect(parseAnalyticsRunCompleteness({ completeness: { ...complete.completeness, version: 2 } }, 1_832).coverage).toBe("invalid");
    expect(parseAnalyticsRunCompleteness({ completeness: { ...complete.completeness, state: "unknown" } }, 1_832).coverage).toBe("invalid");
  });

  it("honors valid partial and empty contracts without promoting them", () => {
    expect(parseAnalyticsRunCompleteness({ completeness: { version: 1, state: "partial", expectedWidgetKeys: ["a", "b"], downloadedWidgetKeys: ["a"], skippedWidgets: [{ key: "b", reason: "No rows" }] } }, 10).coverage).toBe("partial");
    expect(parseAnalyticsRunCompleteness({ completeness: { version: 1, state: "partial", expectedWidgetKeys: ["a", "b"], downloadedWidgetKeys: ["a"], skippedWidgets: [{ key: "b", reason: "header-only scrape" }] } }, 0)).toMatchObject({ coverage: "partial", skippedWidgets: [{ key: "b", reason: "header-only scrape" }] });
    expect(parseAnalyticsRunCompleteness({ completeness: { version: 1, state: "empty", expectedWidgetKeys: ["a"], downloadedWidgetKeys: [], skippedWidgets: [{ key: "a", reason: "No rows" }] } }, 0).coverage).toBe("empty");
  });

  it("accepts a nonempty v2 snapshot when each widget was downloaded or explicitly observed empty", () => {
    const completeness = {
      completeness: {
        version: 2,
        state: "complete",
        expectedWidgetKeys: ["shazams-city", "tracks"],
        downloadedWidgetKeys: ["tracks"],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      },
    };

    expect(parseAnalyticsRunCompleteness(completeness, 19)).toMatchObject({
      coverage: "complete",
      observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
    });
  });

  it("fails closed when a v2 run claims complete but its downloaded evidence has no imported rows", () => {
    const completeness = {
      completeness: {
        version: 2,
        state: "complete",
        expectedWidgetKeys: ["shazams-city", "tracks"],
        downloadedWidgetKeys: ["tracks"],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      },
    };

    expect(parseAnalyticsRunCompleteness(completeness, 0).coverage).toBe("invalid");
  });

  it("fails closed when a v2 run claims complete without any downloaded widget", () => {
    const completeness = {
      completeness: {
        version: 2,
        state: "complete",
        expectedWidgetKeys: ["shazams-city"],
        downloadedWidgetKeys: [],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      },
    };

    expect(parseAnalyticsRunCompleteness(completeness, 1).coverage).toBe("invalid");
  });

  it("rejects a v2 observed-empty reason that is not the provider contract", () => {
    const completeness = {
      completeness: {
        version: 2,
        state: "complete",
        expectedWidgetKeys: ["shazams-city", "tracks"],
        downloadedWidgetKeys: ["tracks"],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "No data" }],
        skippedWidgets: [],
      },
    };

    expect(parseAnalyticsRunCompleteness(completeness, 19).coverage).toBe("invalid");
  });

  it("recognizes all-observed-empty v2 evidence only when it has zero imported rows", () => {
    const completeness = {
      completeness: {
        version: 2,
        state: "empty",
        expectedWidgetKeys: ["shazams-city"],
        downloadedWidgetKeys: [],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      },
    };

    expect(parseAnalyticsRunCompleteness(completeness, 0).coverage).toBe("empty");
    expect(parseAnalyticsRunCompleteness(completeness, 1).coverage).toBe("invalid");
  });
});

describe("evidence reconciliation", () => {
  it("does not call absent, unterminated, or mismatched evidence complete", () => {
    expect(isAnalyticsEvidenceComplete({ hasLatestRun: true, exactTotal: 1_832, processedRows: 1_832, reachedTerminalBatch: true })).toBe(true);
    expect(isAnalyticsEvidenceComplete({ hasLatestRun: false, exactTotal: 0, processedRows: 0, reachedTerminalBatch: true })).toBe(false);
    expect(isAnalyticsEvidenceComplete({ hasLatestRun: true, exactTotal: 1_832, processedRows: 1_000, reachedTerminalBatch: false })).toBe(false);
    expect(isAnalyticsEvidenceComplete({ hasLatestRun: true, exactTotal: 1_832, processedRows: 1_831, reachedTerminalBatch: true })).toBe(false);
  });
});

describe("analytics ingestion service probe", () => {
  it("only returns healthy for a non-empty, complete, current source window", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    expect(evaluateAnalyticsIngestionServiceStatus({ lastSuccessfulRunAt: now, totalRows: 1, reportingThrough: now, failedRuns: 0, freshnessBasis: "row_reporting_date", coverage: "complete", sourceObservedAt: null }, now)).toBe("ok");
    expect(evaluateAnalyticsIngestionServiceStatus({ lastSuccessfulRunAt: now, totalRows: 0, reportingThrough: now, failedRuns: 0 }, now)).toBe("degraded");
    expect(evaluateAnalyticsIngestionServiceStatus({ lastSuccessfulRunAt: now, totalRows: 1_832, reportingThrough: now, failedRuns: 0, freshnessBasis: "row_reporting_date", coverage: "complete", sourceObservedAt: null }, now)).toBe("ok");
    expect(evaluateAnalyticsIngestionServiceStatus({ lastSuccessfulRunAt: now, totalRows: 1, reportingThrough: null, failedRuns: 0 }, now)).toBe("degraded");
    expect(evaluateAnalyticsIngestionServiceStatus({ lastSuccessfulRunAt: now, totalRows: 1, reportingThrough: now, failedRuns: 2 }, now)).toBe("degraded");
  });

  it("uses an injected query seam and fails closed on probe failure", async () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const probe = vi.fn().mockResolvedValue({ lastSuccessfulRunAt: now, totalRows: 1, reportingThrough: now, failedRuns: 0 });
    await expect(getAnalyticsIngestionServiceStatusFromProbe(probe, now)).resolves.toBe("ok");
    await expect(getAnalyticsIngestionServiceStatusFromProbe(async () => { throw new Error("db unavailable"); }, now)).resolves.toBe("degraded");
  });

  it("returns enum-only readiness detail and makes probe failures unknown", async () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const probe = { lastSuccessfulRunAt: now, totalRows: 1, reportingThrough: now, failedRuns: 0, freshnessBasis: "row_reporting_date" as const, coverage: "complete" as const, sourceObservedAt: null };

    expect(evaluateAnalyticsIngestionServiceHealth(probe, now)).toEqual({ status: "ok", freshness: "current", coverage: "complete" });
    await expect(getAnalyticsIngestionServiceHealthFromProbe(async () => probe, now)).resolves.toEqual({ status: "ok", freshness: "current", coverage: "complete" });
    await expect(getAnalyticsIngestionServiceHealthFromProbe(async () => { throw new Error("query failed"); }, now)).resolves.toEqual({ status: "unknown", freshness: "unknown", coverage: "unknown" });
  });
});

it("clears historical failures after a successful run but retains the current failure streak", () => {
  const latestSuccess = new Date("2026-07-29T12:00:00Z");
  expect(countAnalyticsIngestionFailuresSinceLastSuccess([
    { status: "failed", completedAt: "2026-07-28T12:00:00Z" },
    { status: "completed", completedAt: latestSuccess },
    { status: "failed", completedAt: "2026-07-29T12:01:00Z" },
    { status: "failed", completedAt: "2026-07-29T12:02:00Z" },
  ], latestSuccess)).toBe(2);
});
