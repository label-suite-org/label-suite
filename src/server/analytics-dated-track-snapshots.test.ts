import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const database = vi.hoisted(() => {
  const results: unknown[][] = [];
  const selections: unknown[] = [];
  const whereClauses: unknown[] = [];
  const joinClauses: unknown[] = [];
  const orderClauses: unknown[][] = [];
  const limits: number[] = [];
  const offsets: number[] = [];
  const executed: unknown[] = [];
  const executeResults: unknown[][] = [];
  const trace: { kind: "select" | "execute"; value: unknown }[] = [];
  const select = vi.fn((selection: unknown) => {
    selections.push(selection);
    trace.push({ kind: "select", value: selection });
    const chain = {
      from: () => chain,
      innerJoin: (_table: unknown, on: unknown) => {
        joinClauses.push(on);
        return chain;
      },
      leftJoin: (_table: unknown, on: unknown) => {
        joinClauses.push(on);
        return chain;
      },
      where: (where: unknown) => {
        whereClauses.push(where);
        return chain;
      },
      orderBy: (...values: unknown[]) => {
        orderClauses.push(values);
        return chain;
      },
      limit: (value: number) => {
        limits.push(value);
        return chain;
      },
      offset: (value: number) => {
        offsets.push(value);
        return chain;
      },
      then: <T>(
        onfulfilled?: (value: unknown[]) => T | PromiseLike<T>,
        onrejected?: (reason: unknown) => T | PromiseLike<T>,
      ) => Promise.resolve(results.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  });
  const tx = {
    select,
    execute: vi.fn(async (query: unknown) => {
      executed.push(query);
      trace.push({ kind: "execute", value: query });
      return { rows: executed.length > 2 ? (executeResults.shift() ?? []) : [] };
    }),
  };
  const transaction = vi.fn(async <T>(work: (value: typeof tx) => Promise<T>) => work(tx));
  return {
    results,
    selections,
    whereClauses,
    joinClauses,
    orderClauses,
    limits,
    offsets,
    executed,
    executeResults,
    trace,
    select,
    transaction,
    tx,
  };
});

vi.mock("../lib/db", () => ({ db: { transaction: database.transaction } }));

import { listDatedTrackSnapshotWorkspace, listFilteredTracksByGrowth } from "./analytics";

type FakeScopedQueries = {
  listCompletedRunsWithUploadedFile: (input: { orgId: string; artistId: string; limit?: number; offset?: number }) => Promise<unknown[]>;
  listCompletedRunsWithLatestUploadedFile?: (input: {
    orgId: string;
    artistId: string;
    limit?: number;
    offset?: number;
  }) => Promise<unknown[]>;
  listMetricRowsForRun: (input: {
    orgId: string;
    artistId: string;
    runId: string;
    limit?: number;
    offset?: number;
    releaseId?: string;
  }) => Promise<unknown[]>;
  summarizeMetricRowsForRun?: (input: {
    orgId: string;
    artistId: string;
    runId: string;
    releaseId?: string;
  }) => Promise<{
    uniqueTrackCount: number;
    cumulativeStreams: number;
    cumulativeViews?: number | null;
  }>;
  listLegacyTrackRows: () => Promise<
    | { status?: "available"; recordCount: number; rows: unknown[] }
    | { status: "unavailable"; recordCount: null; rows: [] }
  >;
};

function boundary(queries: FakeScopedQueries) {
  const safeOptionalCount = (value: unknown): string | null => {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : null;
  };
  const listMetricRowsForRun = async (input: Parameters<FakeScopedQueries["listMetricRowsForRun"]>[0]) => {
    const rows = await queries.listMetricRowsForRun(input);
    return rows.map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const metrics = (row as { metrics?: Record<string, unknown> }).metrics;
      const rawValue = metrics?.combined_streams;
      const parsed = typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string" && /^[0-9]+$/.test(rawValue)
          ? Number(rawValue)
          : Number.NaN;
      return {
        ...row,
        safeCombinedStreams: "safeCombinedStreams" in row
          ? (row as { safeCombinedStreams: unknown }).safeCombinedStreams
          : Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : "0",
        safeSpotifyStreams: "safeSpotifyStreams" in row
          ? (row as { safeSpotifyStreams: unknown }).safeSpotifyStreams
          : safeOptionalCount(metrics?.spotify_streams),
        safeAppleStreams: "safeAppleStreams" in row
          ? (row as { safeAppleStreams: unknown }).safeAppleStreams
          : safeOptionalCount(metrics?.apple_streams),
        safeAmazonStreams: "safeAmazonStreams" in row
          ? (row as { safeAmazonStreams: unknown }).safeAmazonStreams
          : safeOptionalCount(metrics?.amazon_streams),
        safePandoraStreams: "safePandoraStreams" in row
          ? (row as { safePandoraStreams: unknown }).safePandoraStreams
          : safeOptionalCount(metrics?.pandora_streams),
        safeYoutubeViews: "safeYoutubeViews" in row
          ? (row as { safeYoutubeViews: unknown }).safeYoutubeViews
          : safeOptionalCount(metrics?.youtube_views),
        safeTiktokViews: "safeTiktokViews" in row
          ? (row as { safeTiktokViews: unknown }).safeTiktokViews
          : safeOptionalCount(metrics?.tiktok_views),
        safeCombinedViews: "safeCombinedViews" in row
          ? (row as { safeCombinedViews: unknown }).safeCombinedViews
          : safeOptionalCount(metrics?.combined_views),
      };
    });
  };
  const summarizeMetricRowsForRun = queries.summarizeMetricRowsForRun ?? (async (input) => {
    const rows = await queries.listMetricRowsForRun(input) as Array<{
      orgId?: string;
      artistId?: string;
      source?: string;
      widgetKey?: string;
      lastSeenRunId?: string;
      rowKey?: string;
      metrics?: {
        combined_streams?: string | number | null;
        combined_views?: string | number | null;
      };
    }>;
    const accepted = rows.filter((row) => (
      row.orgId === input.orgId
      && row.artistId === input.artistId
      && row.source === "sisense"
      && row.widgetKey === "tracks-by-growth-rate"
      && row.lastSeenRunId === input.runId
      && (!input.releaseId || (row as { releaseId?: string }).releaseId === input.releaseId)
      && typeof row.rowKey === "string"
    ));
    const uniqueRows = [...new Map(accepted.map((row) => [row.rowKey, row])).values()];
    let cumulativeStreams = 0;
    let cumulativeViews = 0;
    let hasCompleteCumulativeViews = uniqueRows.length > 0;
    for (const row of uniqueRows) {
      const rawValue = row.metrics?.combined_streams;
      const parsed = typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string" && /^[0-9]+$/.test(rawValue)
          ? Number(rawValue)
          : Number.NaN;
      const value = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
      if (cumulativeStreams > Number.MAX_SAFE_INTEGER - value) {
        cumulativeStreams = Number.MAX_SAFE_INTEGER;
      } else {
        cumulativeStreams += value;
      }

      const rawViews = row.metrics?.combined_views;
      const parsedViews = typeof rawViews === "number"
        ? rawViews
        : typeof rawViews === "string" && /^[0-9]+$/.test(rawViews)
          ? Number(rawViews)
          : Number.NaN;
      if (Number.isSafeInteger(parsedViews) && parsedViews >= 0) {
        cumulativeViews = Math.min(Number.MAX_SAFE_INTEGER, cumulativeViews + parsedViews);
      } else {
        hasCompleteCumulativeViews = false;
      }
    }
    return {
      uniqueTrackCount: uniqueRows.length,
      cumulativeStreams,
      cumulativeViews: hasCompleteCumulativeViews ? cumulativeViews : null,
    };
  });
  return {
    async forTenant<T>(
      _orgId: string,
      work: (scoped: FakeScopedQueries) => Promise<T>,
    ): Promise<T> {
      return work({
        ...queries,
        listMetricRowsForRun,
        summarizeMetricRowsForRun,
        listCompletedRunsWithLatestUploadedFile: (
          queries.listCompletedRunsWithLatestUploadedFile
          ?? queries.listCompletedRunsWithUploadedFile
        ),
      });
    },
  };
}

describe("dated track snapshot analytics read model", () => {
  beforeEach(() => {
    database.results.length = 0;
    database.selections.length = 0;
    database.whereClauses.length = 0;
    database.joinClauses.length = 0;
    database.orderClauses.length = 0;
    database.limits.length = 0;
    database.offsets.length = 0;
    database.executed.length = 0;
    database.executeResults.length = 0;
    database.trace.length = 0;
    database.select.mockClear();
    database.transaction.mockClear();
    database.tx.execute.mockClear();
  });

  it("selects the latest completed manual Sisense track run that has an uploaded file", async () => {
    // Break caught: a newer running/failed run or an archive-less run replaces
    // the latest completed import that has durable uploaded-file evidence.
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [
        {
          orgId: "org-a",
          artistId: "artist-a",
          runId: "run-old",
          source: "sisense",
          mode: "manual_import",
          status: "completed",
          widgetKey: "tracks-by-growth-rate",
          storageStatus: "uploaded",
          fileId: "file-old",
          fileName: "old.csv",
          sha256: "old-hash",
          fileRowCount: 2,
          requestedDateRange: "2026-07-01 to 2026-07-31",
          requestedAggregation: "Daily",
          startedAt: "2026-08-01T09:00:00.000Z",
          completedAt: "2026-08-01T09:01:00.000Z",
          fileCreatedAt: "2026-08-01T09:00:30.000Z",
          metadata: { counts: { sourceRows: 2, uniqueTracks: 2 } },
        },
        {
          orgId: "org-a",
          artistId: "artist-a",
          runId: "run-new",
          source: "sisense",
          mode: "manual_import",
          status: "completed",
          widgetKey: "tracks-by-growth-rate",
          storageStatus: "uploaded",
          fileId: "file-new",
          fileName: "new.csv",
          sha256: "new-hash",
          fileRowCount: 2,
          requestedDateRange: "2026-08-01 to 2026-08-08",
          requestedAggregation: "Daily",
          startedAt: "2026-08-08T09:00:00.000Z",
          completedAt: "2026-08-08T09:01:00.000Z",
          fileCreatedAt: "2026-08-08T09:00:30.000Z",
          metadata: {
            reporting_from: "2026-08-01",
            reporting_through: "2026-08-08",
            counts: {
              sourceRows: 2,
              uniqueTracks: 2,
              matched: 1,
              unmatched: 1,
              ambiguous: 0,
              exactDuplicates: 3,
            },
          },
        },
        {
          orgId: "org-a",
          artistId: "artist-a",
          runId: "run-archive-pending",
          source: "sisense",
          mode: "manual_import",
          status: "completed",
          widgetKey: "tracks-by-growth-rate",
          storageStatus: "pending",
          fileId: "file-pending",
          fileName: "pending.csv",
          sha256: "pending-hash",
          fileRowCount: 2,
          requestedDateRange: "2026-08-09 to 2026-08-10",
          requestedAggregation: "Daily",
          startedAt: "2026-08-10T09:00:00.000Z",
          completedAt: "2026-08-10T09:01:00.000Z",
          fileCreatedAt: "2026-08-10T09:00:30.000Z",
          metadata: { counts: { sourceRows: 2, uniqueTracks: 2 } },
        },
      ],
      listMetricRowsForRun: async () => [],
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 0, rows: [] }),
    }) as never);

    expect(workspace.latest).toMatchObject({
      runId: "run-new",
      fileName: "new.csv",
      requestedDateRange: "2026-08-01 to 2026-08-08",
    });
    expect(workspace.history.map((entry) => entry.runId)).toEqual(["run-new", "run-old"]);
    expect(workspace.history[0]).toMatchObject({
      sha256: "new-hash",
      sha256Prefix: "new-hash",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      sourceRowCount: 2,
      uniqueTrackCount: 2,
      matchedCount: 1,
      unmatchedCount: 1,
      ambiguousCount: 0,
      exactDuplicateCount: 3,
    });
    expect(workspace.history[1]).toMatchObject({
      reportingFrom: null,
      reportingThrough: null,
      matchedCount: null,
      unmatchedCount: null,
      ambiguousCount: null,
      exactDuplicateCount: null,
    });
    expect(workspace.history[0]).not.toHaveProperty("rows");
    expect(workspace.history[0]).not.toHaveProperty("cumulativeStreams");
  });

  it("builds current rows and totals only from exact latest-run membership", async () => {
    // Break caught: a same-range stale row, another tenant/artist row, or a
    // duplicate query result leaks into the current snapshot and its total.
    const run = {
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-new",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-new",
      fileName: "new.csv",
      sha256: "new-hash",
      fileRowCount: 2,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 2, uniqueTracks: 2 } },
    };
    const row = (overrides: Record<string, unknown>) => ({
      id: "row-a",
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: "release-a",
      trackId: "track-a",
      rowKey: "isrc:DKAAA2600001",
      lastSeenRunId: "run-new",
      dimensions: { track_title: "A", primary_artist: "Artist A" },
      metrics: { combined_streams: "75000", spotify_streams: 70_000 },
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: "Canonical A",
      releaseTitle: "Release A",
      ...overrides,
    });
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [run],
      listMetricRowsForRun: async () => [
        row({}),
        row({
          id: "row-b",
          trackId: "track-b",
          rowKey: "isrc:DKAAA2600002",
          dimensions: { track_title: "B", primary_artist: "Artist A" },
          metrics: { combined_streams: "924", spotify_streams: "900" },
        }),
        row({ id: "row-stale", rowKey: "stale", lastSeenRunId: "run-old" }),
        row({ id: "row-other-org", rowKey: "other-org", orgId: "org-b" }),
        row({ id: "row-other-artist", rowKey: "other-artist", artistId: "artist-b" }),
        row({ id: "row-a-copy" }),
      ],
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 0, rows: [] }),
    }) as never);

    expect(workspace.latest).toMatchObject({
      runId: "run-new",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      uniqueTrackCount: 2,
      cumulativeStreams: 75_924,
    });
    expect(workspace.latest?.rows.map((current) => current.id)).toEqual(["row-a", "row-b"]);
  });

  it("keeps full-snapshot totals independent from bounded display rows", async () => {
    // Break caught: cumulative totals and unique count shrink to the currently
    // displayed row page instead of describing the complete latest snapshot.
    const run = {
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-new",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-new",
      fileName: "new.csv",
      sha256: "new-hash",
      fileRowCount: 250,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 250, uniqueTracks: 250 } },
    };
    const visibleRow = {
      id: "row-visible",
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: null,
      trackId: "track-visible",
      rowKey: "visible",
      lastSeenRunId: "run-new",
      dimensions: { track_title: "Visible", primary_artist: "Artist A" },
      metrics: { combined_streams: 10 },
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: "Visible",
      releaseTitle: null,
    };
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [run],
      summarizeMetricRowsForRun: async () => ({
        uniqueTrackCount: 250,
        cumulativeStreams: 5_000_000,
        cumulativeViews: 7_500_000,
      }),
      listMetricRowsForRun: async () => [visibleRow],
      listLegacyTrackRows: async () => ({ status: "unavailable", recordCount: null, rows: [] }),
    }) as never);

    expect(workspace.latest).toMatchObject({
      uniqueTrackCount: 250,
      cumulativeStreams: 5_000_000,
      cumulativeViews: 7_500_000,
    });
    expect(workspace.latest?.rows.map((row) => row.id)).toEqual(["row-visible"]);
  });

  it("bounds history and current rows while exposing page semantics", async () => {
    // Break caught: history/current queries read an unbounded snapshot or rows
    // are silently truncated without telling the consumer what page it sees.
    const requested: Record<string, unknown> = {};
    const baseRun = {
      orgId: "org-a",
      artistId: "artist-a",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileName: "snapshot.csv",
      sha256: "hash",
      fileRowCount: 250,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 250, uniqueTracks: 250 } },
    };
    const row = {
      id: "row-page",
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: null,
      trackId: "track-page",
      rowKey: "row-page",
      lastSeenRunId: "run-z",
      dimensions: { track_title: "Page row", primary_artist: "Artist A" },
      metrics: { combined_streams: 100 },
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: "Page row",
      releaseTitle: null,
    };
    const workspace = await listDatedTrackSnapshotWorkspace(
      "org-a",
      "artist-a",
      boundary({
        listCompletedRunsWithUploadedFile: async (input) => {
          requested.history = input;
          return [
            { ...baseRun, runId: "run-z", fileId: "file-z" },
            { ...baseRun, runId: "run-y", fileId: "file-y", completedAt: "2026-08-07T09:01:00.000Z" },
            { ...baseRun, runId: "run-x", fileId: "file-x", completedAt: "2026-08-06T09:01:00.000Z" },
          ];
        },
        summarizeMetricRowsForRun: async (input) => {
          requested.summary = input;
          return { uniqueTrackCount: 250, cumulativeStreams: 5_000_000 };
        },
        listMetricRowsForRun: async (input) => {
          requested.rows = input;
          return [row];
        },
        listLegacyTrackRows: async () => ({ status: "unavailable", recordCount: null, rows: [] }),
      }) as never,
      {
        rows: { limit: 1, offset: 2 },
        history: { limit: 2, offset: 0 },
      } as never,
    );

    expect(requested.history).toMatchObject({ limit: 3, offset: 0 });
    expect(requested.rows).toMatchObject({ limit: 1, offset: 2 });
    expect(workspace.history.map((entry) => entry.runId)).toEqual(["run-z", "run-y"]);
    expect(workspace.historyPage).toEqual({ limit: 2, offset: 0, returnedCount: 2, hasMore: true });
    expect(workspace.latest?.rowsPage).toEqual({
      limit: 1,
      offset: 2,
      returnedCount: 1,
      totalCount: 250,
      hasMore: true,
    });
  });

  it("keeps latest anchored to page zero when history is paged", async () => {
    // Break caught: requesting an older history page relabels that page's
    // first run as the latest/current snapshot.
    const baseRun = {
      orgId: "org-a",
      artistId: "artist-a",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileName: "snapshot.csv",
      sha256: "hash",
      fileRowCount: 0,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 0, uniqueTracks: 0 } },
    };
    const workspace = await listDatedTrackSnapshotWorkspace(
      "org-a",
      "artist-a",
      boundary({
        listCompletedRunsWithUploadedFile: async (input) => (
          (input as { offset?: number }).offset === 0
            ? [{ ...baseRun, runId: "run-new", fileId: "file-new", completedAt: "2026-08-08T09:01:00.000Z" }]
            : [
                { ...baseRun, runId: "run-old-b", fileId: "file-old-b", completedAt: "2026-08-06T09:01:00.000Z" },
                { ...baseRun, runId: "run-old-a", fileId: "file-old-a", completedAt: "2026-08-05T09:01:00.000Z" },
              ]
        ),
        summarizeMetricRowsForRun: async () => ({ uniqueTrackCount: 0, cumulativeStreams: 0 }),
        listMetricRowsForRun: async () => [],
        listLegacyTrackRows: async () => ({ status: "unavailable", recordCount: null, rows: [] }),
      }) as never,
      { history: { limit: 1, offset: 2 } } as never,
    );

    expect(workspace.latest?.runId).toBe("run-new");
    expect(workspace.history.map((entry) => entry.runId)).toEqual(["run-old-b"]);
    expect(workspace.historyPage).toEqual({ limit: 1, offset: 2, returnedCount: 1, hasMore: true });
  });

  it("paginates logical runs after choosing one deterministic uploaded file per run", async () => {
    // Break caught: two uploaded files for the newest run consume the first
    // raw join page, hiding hasMore and making the next logical run unreachable.
    const baseRun = {
      orgId: "org-a",
      artistId: "artist-a",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileName: "snapshot.csv",
      sha256: "hash",
      fileRowCount: 0,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      metadata: { counts: { sourceRows: 0, uniqueTracks: 0 } },
    };
    const evidence = [
      {
        ...baseRun,
        runId: "run-a",
        fileId: "file-a-old",
        completedAt: "2026-08-08T09:01:00.000Z",
        fileCreatedAt: "2026-08-08T09:00:10.000Z",
      },
      {
        ...baseRun,
        runId: "run-a",
        fileId: "file-a-new",
        completedAt: "2026-08-08T09:01:00.000Z",
        fileCreatedAt: "2026-08-08T09:00:30.000Z",
      },
      {
        ...baseRun,
        runId: "run-b",
        fileId: "file-b",
        completedAt: "2026-08-07T09:01:00.000Z",
        fileCreatedAt: "2026-08-07T09:00:30.000Z",
      },
    ];
    const rawPage = async ({ limit = 25, offset = 0 }: { limit?: number; offset?: number }) => (
      evidence.slice(offset, offset + limit)
    );
    const logicalPage = async ({ limit = 25, offset = 0 }: { limit?: number; offset?: number }) => {
      const newestByRun = [evidence[1], evidence[2]];
      return newestByRun.slice(offset, offset + limit);
    };
    const injectedBoundary = boundary({
      listCompletedRunsWithUploadedFile: rawPage,
      listCompletedRunsWithLatestUploadedFile: logicalPage,
      listMetricRowsForRun: async () => [],
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 0, rows: [] }),
    }) as never;

    const firstPage = await listDatedTrackSnapshotWorkspace(
      "org-a",
      "artist-a",
      injectedBoundary,
      { history: { limit: 1, offset: 0 } },
    );
    const secondPage = await listDatedTrackSnapshotWorkspace(
      "org-a",
      "artist-a",
      injectedBoundary,
      { history: { limit: 1, offset: 1 } },
    );

    expect(firstPage.history.map((entry) => entry.fileId)).toEqual(["file-a-new"]);
    expect(firstPage.historyPage.hasMore).toBe(true);
    expect(secondPage.history.map((entry) => entry.runId)).toEqual(["run-b"]);
    expect(secondPage.latest?.runId).toBe("run-a");
  });

  it("keeps legacy rows disclosed without promoting them when no dated run exists", async () => {
    // Break caught: legacy staging rows are relabelled as the latest/current
    // artist snapshot or gain misleading aggregate totals.
    const legacyRow = {
      id: "csv-legacy",
      trackTitle: "Legacy track",
      primaryArtist: "Legacy artist",
      appTrackTitle: null,
      releaseTitle: null,
      combinedStreams: 999_999,
      spotifyStreams: 999_999,
      appleStreams: 0,
      amazonStreams: 0,
      pandoraStreams: 0,
      streamsGrowth: null,
      youtubeViews: 0,
      tiktokViews: 0,
      combinedViews: 0,
      viewsGrowth: null,
      lastSeenAt: null,
    };
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [],
      listMetricRowsForRun: async () => {
        throw new Error("metric rows must not be queried without a dated run");
      },
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 95, rows: [legacyRow] }),
    }) as never);

    expect(workspace.latest).toBeNull();
    expect(workspace.history).toEqual([]);
    expect(workspace.legacy).toMatchObject({ recordCount: 95, rows: [legacyRow] });
    expect(workspace.legacy).not.toHaveProperty("totals");
    expect(workspace.legacy).not.toHaveProperty("cumulativeStreams");
  });

  it("reports unavailable legacy data distinctly from an available zero-row disclosure", async () => {
    // Break caught: the disabled unowned legacy relation is presented as an
    // authoritative zero-record result instead of an unavailable source.
    database.results.push([]);

    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a");

    expect(workspace.latest).toBeNull();
    expect(workspace.legacy).toEqual({
      status: "unavailable",
      recordCount: null,
      rows: [],
    });
  });

  it("ignores malformed query records and safely normalizes null metadata maps", async () => {
    // Break caught: a null joined-file row or null JSON metrics/dimensions can
    // crash the whole analytics read instead of being ignored or sanitized.
    const run = {
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-safe",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-safe",
      fileName: "safe.csv",
      sha256: "safe-hash",
      fileRowCount: 1,
      requestedDateRange: null,
      requestedAggregation: null,
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: null,
    };
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [null, "bad-file-row", run],
      summarizeMetricRowsForRun: async () => null as never,
      listMetricRowsForRun: async () => [
        null,
        {
          id: "row-safe",
          orgId: "org-a",
          source: "sisense",
          widgetKey: "tracks-by-growth-rate",
          artistId: "artist-a",
          releaseId: "release-safe",
          trackId: "track-safe",
          rowKey: "isrc:SAFE",
          lastSeenRunId: "run-safe",
          dimensions: null,
          metrics: null,
          lastSeenAt: "2026-08-08T09:01:00.000Z",
          trackTitle: "Canonical safe title",
          releaseTitle: "Canonical safe release",
        },
      ],
      listLegacyTrackRows: async () => ({ status: "unavailable", recordCount: null, rows: [] }),
    }) as never);

    expect(workspace.latest?.runId).toBe("run-safe");
    expect(workspace.latest).toMatchObject({ uniqueTrackCount: 0, cumulativeStreams: 0 });
    expect(workspace.latest?.rows).toEqual([
      expect.objectContaining({
        id: "row-safe",
        trackTitle: "Canonical safe title",
        releaseTitle: "Canonical safe release",
        combinedStreams: 0,
        streamsGrowth: null,
      }),
    ]);
  });

  it("runs the default queries in one tenant context with exact run and row scope", async () => {
    // Break caught: the public two-argument API skips RLS tenant context or
    // omits source/widget/mode/status/artist/run predicates in production.
    database.executeResults.push([{
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-new",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-new",
      fileName: "new.csv",
      sha256: "new-hash",
      fileRowCount: 1,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: new Date("2026-08-08T09:00:00.000Z"),
      completedAt: new Date("2026-08-08T09:01:00.000Z"),
      fileCreatedAt: new Date("2026-08-08T09:00:30.000Z"),
      metadata: { counts: { sourceRows: 1, uniqueTracks: 1 } },
    }]);
    database.results.push(
      [{ uniqueTrackCount: "1", cumulativeStreams: "100", cumulativeViews: "25" }],
      [{
        id: "row-a",
        orgId: "org-a",
        source: "sisense",
        widgetKey: "tracks-by-growth-rate",
        artistId: "artist-a",
        releaseId: "release-a",
        trackId: "track-a",
        rowKey: "isrc:DKAAA2600001",
        lastSeenRunId: "run-new",
        dimensions: { track_title: "A", primary_artist: "Artist A" },
        metrics: {
          combined_streams: 100,
          spotify_streams: 100,
          amazon_streams: 0,
          pandora_streams: "5",
          combined_views: 25,
          views_growth: 1.5,
        },
        safeCombinedStreams: "100",
        safeSpotifyStreams: "100",
        safeAppleStreams: null,
        safeAmazonStreams: "0",
        safePandoraStreams: "5",
        safeYoutubeViews: null,
        safeTiktokViews: null,
        safeCombinedViews: "25",
        lastSeenAt: new Date("2026-08-08T09:01:00.000Z"),
        trackTitle: "Canonical A",
        releaseTitle: "Release A",
      }],
    );

    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a");

    expect(workspace.latest).toMatchObject({ runId: "run-new", cumulativeStreams: 100, cumulativeViews: 25 });
    expect(workspace.latest?.rows).toEqual([
      expect.objectContaining({
        id: "row-a",
        combinedStreams: 100,
        spotifyStreams: 100,
        appleStreams: null,
        amazonStreams: 0,
        pandoraStreams: 5,
        combinedViews: 25,
        viewsGrowth: 1.5,
      }),
    ]);
    const dialect = new PgDialect();
    const isolationQuery = dialect.sqlToQuery(database.executed[0] as SQL);
    const tenantQuery = dialect.sqlToQuery(database.executed[1] as SQL);
    const runEvidenceQuery = dialect.sqlToQuery(database.executed[2] as SQL);
    const releaseJoin = dialect.sqlToQuery(database.joinClauses[1] as SQL);
    const rowQuery = dialect.sqlToQuery(database.whereClauses[1] as SQL);
    const rowOrder = dialect.sqlToQuery(database.orderClauses[0][0] as SQL);
    const aggregateSelection = database.selections[0] as { cumulativeStreams: SQL; cumulativeViews: SQL };
    const aggregateStreams = dialect.sqlToQuery(aggregateSelection.cumulativeStreams);
    const aggregateViews = dialect.sqlToQuery(aggregateSelection.cumulativeViews);
    const metricRowSelection = database.selections[1] as {
      safeCombinedStreams: SQL;
      safeSpotifyStreams: SQL;
      safeCombinedViews: SQL;
    };
    const projectedSafeStreams = dialect.sqlToQuery(metricRowSelection.safeCombinedStreams);
    const projectedSafeSpotify = dialect.sqlToQuery(metricRowSelection.safeSpotifyStreams);
    const projectedSafeViews = dialect.sqlToQuery(metricRowSelection.safeCombinedViews);
    expect(isolationQuery.sql).toBe("set transaction isolation level repeatable read");
    expect(tenantQuery.sql).toContain("set_config('app.current_org_id'");
    expect(tenantQuery.params).toContain("org-a");
    expect(runEvidenceQuery.sql).toContain("row_number() over");
    expect(runEvidenceQuery.sql).toContain("partition by");
    expect(runEvidenceQuery.sql).toContain('"fileRank" = 1');
    expect(runEvidenceQuery.sql).toContain('"completedAt" desc nulls last');
    expect(runEvidenceQuery.sql).toContain('"startedAt" desc nulls last');
    expect(runEvidenceQuery.sql).toContain('"fileCreatedAt" desc nulls last');
    expect(runEvidenceQuery.sql).toMatch(/created_at" desc nulls last/);
    expect(database.trace.slice(0, 4).map((entry) => entry.kind)).toEqual([
      "execute",
      "execute",
      "execute",
      "select",
    ]);
    expect(runEvidenceQuery.params).toEqual(expect.arrayContaining([
      "org-a", "artist-a", "sisense", "tracks-by-growth-rate", 26, 0,
    ]));
    expect(runEvidenceQuery.sql).toContain("manual_import");
    expect(runEvidenceQuery.sql).toContain("completed");
    expect(runEvidenceQuery.sql).toContain("uploaded");
    expect(rowQuery.params).toEqual(expect.arrayContaining([
      "org-a", "artist-a", "run-new", "sisense", "tracks-by-growth-rate",
    ]));
    expect(rowOrder.sql).toContain("combined_streams");
    expect(rowOrder.sql).toContain("jsonb_typeof");
    expect(rowOrder.sql).toContain("'string'");
    expect(rowOrder.sql).toContain("'number'");
    expect(rowOrder.sql).toContain("regexp_replace");
    expect(rowOrder.sql).toContain("length");
    expect(rowOrder.sql).toContain("trunc");
    expect(rowOrder.sql).toContain("9007199254740991");
    expect(rowOrder.sql).toContain("<=");
    expect(rowOrder.sql).not.toContain("then least");
    expect(rowOrder.params).toContain(Number.MAX_SAFE_INTEGER);
    const stringBranch = rowOrder.sql.slice(
      rowOrder.sql.indexOf("when 'string'"),
      rowOrder.sql.indexOf("when 'number'"),
    );
    expect(stringBranch.indexOf("^[0-9]+$")).toBeLessThan(stringBranch.indexOf("::numeric"));
    expect(stringBranch.indexOf("length")).toBeLessThan(stringBranch.indexOf("::numeric"));
    expect(stringBranch.indexOf("9007199254740991")).toBeLessThan(stringBranch.indexOf("::numeric"));
    const rowTimestampOrder = dialect.sqlToQuery(database.orderClauses[0][1] as SQL);
    expect(rowTimestampOrder.sql).toContain("nulls last");
    expect(aggregateStreams.sql).toContain("<=");
    expect(aggregateStreams.sql).toContain("least");
    expect(aggregateStreams.sql).toContain("sum");
    expect(aggregateStreams.params).toContain(Number.MAX_SAFE_INTEGER);
    const safeOrderExpression = rowOrder.sql.replace(/\s+desc$/, "");
    expect(aggregateStreams.sql).toContain(safeOrderExpression);
    expect(projectedSafeStreams.sql.replace(/::text$/, "")).toBe(safeOrderExpression);
    expect(aggregateViews.sql).toContain("sum");
    expect(aggregateViews.sql).toContain("count");
    expect(aggregateViews.sql).toContain("count(*)");
    expect(aggregateViews.sql).toContain("<>");
    expect(aggregateViews.sql).toContain("9007199254740991");
    expect(projectedSafeViews.sql).toContain("combined_views");
    expect(projectedSafeViews.sql).toContain("jsonb_typeof");
    expect(projectedSafeViews.sql).toContain("else null");
    expect(projectedSafeSpotify.sql).toContain("spotify_streams");
    expect(database.limits).toEqual([100]);
    expect(database.offsets).toEqual([0]);
    expect(releaseJoin.sql).toContain('"tracks"."release_id"');
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.select).toHaveBeenCalledTimes(2);
  });

  it("breaks equal completion and start timestamps deterministically by run id", async () => {
    // Break caught: database return order decides which equally-timed import
    // becomes latest, causing current evidence to flicker between requests.
    const baseRun = {
      orgId: "org-a",
      artistId: "artist-a",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileName: "snapshot.csv",
      sha256: "hash",
      fileRowCount: 0,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 0, uniqueTracks: 0 } },
    };
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [
        { ...baseRun, runId: "run-a", fileId: "file-a" },
        { ...baseRun, runId: "run-z", fileId: "file-z" },
        {
          ...baseRun,
          runId: "run-zzzz-null",
          fileId: "file-null",
          completedAt: null,
          startedAt: null,
        },
      ],
      listMetricRowsForRun: async () => [],
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 0, rows: [] }),
    }) as never);

    expect(workspace.latest?.runId).toBe("run-z");
    expect(workspace.history.map((entry) => entry.runId)).toEqual([
      "run-z",
      "run-a",
      "run-zzzz-null",
    ]);
  });

  it("sanitizes count metrics and saturates cumulative streams at the safe integer limit", async () => {
    // Break caught: malformed/negative counts produce NaN or an unsafe total,
    // making the latest snapshot internally inconsistent.
    const run = {
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-new",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-new",
      fileName: "new.csv",
      sha256: "new-hash",
      fileRowCount: 3,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 3, uniqueTracks: 3 } },
    };
    const metricRow = (id: string, combinedStreams: string | number) => ({
      id,
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: null,
      trackId: id,
      rowKey: id,
      lastSeenRunId: "run-new",
      dimensions: { track_title: id, primary_artist: "Artist A" },
      metrics: { combined_streams: combinedStreams },
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: id,
      releaseTitle: null,
    });
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [run],
      listMetricRowsForRun: async () => [
        {
          ...metricRow("row-max", "9007199254740991"),
          metrics: { combined_streams: "9007199254740991", combined_views: 5 },
        },
        metricRow("row-extra", 1),
        metricRow("row-too-large", "9007199254740992"),
        metricRow("row-formatted", "9,007,199,254,740,991"),
        metricRow("row-invalid", -50),
      ],
      listLegacyTrackRows: async () => ({ status: "available", recordCount: 0, rows: [] }),
    }) as never);

    expect(workspace.latest?.cumulativeStreams).toBe(Number.MAX_SAFE_INTEGER);
    expect(workspace.latest?.cumulativeViews).toBeNull();
    expect(workspace.latest?.rows.find((row) => row.id === "row-invalid")?.combinedStreams).toBe(0);
    expect(workspace.latest?.rows.find((row) => row.id === "row-too-large")?.combinedStreams).toBe(0);
    expect(workspace.latest?.rows.find((row) => row.id === "row-formatted")?.combinedStreams).toBe(0);
  });

  it("uses projected SQL-safe counts for display and ordering when decoded JSON numbers round", async () => {
    // Break caught: node-postgres decodes JSONB numbers through JavaScript, so
    // exact fractions rejected by SQL can round to valid-looking integers in metrics.
    const run = {
      orgId: "org-a",
      artistId: "artist-a",
      runId: "run-new",
      source: "sisense",
      mode: "manual_import",
      status: "completed",
      widgetKey: "tracks-by-growth-rate",
      storageStatus: "uploaded",
      fileId: "file-new",
      fileName: "new.csv",
      sha256: "new-hash",
      fileRowCount: 5,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      requestedAggregation: "Daily",
      startedAt: "2026-08-08T09:00:00.000Z",
      completedAt: "2026-08-08T09:01:00.000Z",
      fileCreatedAt: "2026-08-08T09:00:30.000Z",
      metadata: { counts: { sourceRows: 5, uniqueTracks: 5 } },
    };
    const metricRow = (
      id: string,
      decodedCombinedStreams: string | number,
      safeCombinedStreams: string,
    ) => ({
      id,
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: null,
      trackId: id,
      rowKey: id,
      lastSeenRunId: "run-new",
      dimensions: { track_title: id, primary_artist: "Artist A" },
      metrics: { combined_streams: decodedCombinedStreams },
      safeCombinedStreams,
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: id,
      releaseTitle: null,
    });
    const workspace = await listDatedTrackSnapshotWorkspace("org-a", "artist-a", boundary({
      listCompletedRunsWithUploadedFile: async () => [run],
      summarizeMetricRowsForRun: async () => ({
        uniqueTrackCount: 5,
        cumulativeStreams: Number.MAX_SAFE_INTEGER,
      }),
      listMetricRowsForRun: async () => [
        // Exact JSONB 1.00000000000000000001 is rejected by SQL but decoded as 1.
        metricRow("row-fraction-one", 1, "0"),
        // Exact JSONB 9007199254740990.9 is rejected by SQL but rounds to max-safe.
        metricRow("row-fraction-max", Number.MAX_SAFE_INTEGER, "0"),
        metricRow("row-valid-one", 1, "1.0"),
        metricRow("row-valid-max", Number.MAX_SAFE_INTEGER, "9007199254740991"),
        metricRow("row-valid-string", "42", "42"),
      ],
      listLegacyTrackRows: async () => ({ status: "unavailable", recordCount: null, rows: [] }),
    }) as never);

    expect(workspace.latest?.rows.map(({ id, combinedStreams }) => ({ id, combinedStreams }))).toEqual([
      { id: "row-valid-max", combinedStreams: Number.MAX_SAFE_INTEGER },
      { id: "row-valid-string", combinedStreams: 42 },
      { id: "row-valid-one", combinedStreams: 1 },
      { id: "row-fraction-max", combinedStreams: 0 },
      { id: "row-fraction-one", combinedStreams: 0 },
    ]);
  });

  it("returns no selected-artist current tracks when only legacy rows exist", async () => {
    // Break caught: the artist filter falls back to undated track_totals and
    // presents legacy duplicates as the selected artist's current snapshot.
    const rows = await listFilteredTracksByGrowth(
      "org-a",
      1,
      { artistId: "artist-a" },
      boundary({
        listCompletedRunsWithUploadedFile: async () => [],
        listMetricRowsForRun: async () => [],
        listLegacyTrackRows: async () => {
          throw new Error("selected-artist current rows must not query legacy storage");
        },
      }) as never,
    );

    expect(rows).toEqual([]);
  });

  it("prefers latest dated rows and applies the selected release inside the artist scope", async () => {
    // Break caught: selected-artist analytics either use legacy rows first or
    // ignore the release constraint after switching to canonical snapshots.
    const currentRow = {
      id: "row-a",
      orgId: "org-a",
      source: "sisense",
      widgetKey: "tracks-by-growth-rate",
      artistId: "artist-a",
      releaseId: "release-a",
      trackId: "track-a",
      rowKey: "isrc:DKAAA2600001",
      lastSeenRunId: "run-new",
      dimensions: { track_title: "A", primary_artist: "Artist A" },
      metrics: { combined_streams: 100 },
      lastSeenAt: "2026-08-08T09:01:00.000Z",
      trackTitle: "Canonical A",
      releaseTitle: "Release A",
    };
    const rows = await listFilteredTracksByGrowth(
      "org-a",
      1,
      { artistId: "artist-a", releaseId: "release-b" },
      boundary({
        listCompletedRunsWithUploadedFile: async () => [{
          orgId: "org-a",
          artistId: "artist-a",
          runId: "run-new",
          source: "sisense",
          mode: "manual_import",
          status: "completed",
          widgetKey: "tracks-by-growth-rate",
          storageStatus: "uploaded",
          fileId: "file-new",
          fileName: "new.csv",
          sha256: "new-hash",
          fileRowCount: 2,
          requestedDateRange: "2026-08-01 to 2026-08-08",
          requestedAggregation: "Daily",
          startedAt: "2026-08-08T09:00:00.000Z",
          completedAt: "2026-08-08T09:01:00.000Z",
          fileCreatedAt: "2026-08-08T09:00:30.000Z",
          metadata: { counts: { sourceRows: 2, uniqueTracks: 2 } },
        }],
        summarizeMetricRowsForRun: async (input) => ({
          uniqueTrackCount: (input as { releaseId?: string }).releaseId === "release-b" ? 1 : 0,
          cumulativeStreams: (input as { releaseId?: string }).releaseId === "release-b" ? 200 : 0,
        }),
        listMetricRowsForRun: async (input) => (
          (input as { releaseId?: string; limit?: number }).releaseId === "release-b"
            && (input as { limit?: number }).limit === 1
            ? [{
                ...currentRow,
                id: "row-b",
                releaseId: "release-b",
                trackId: "track-b",
                rowKey: "isrc:DKAAA2600002",
                dimensions: {
                  track_title: "B",
                  primary_artist: "Artist A",
                  release_title: "Source Release B",
                },
                metrics: { combined_streams: 200 },
                trackTitle: "Canonical B",
                releaseTitle: "Release B",
              }]
            : [currentRow]
        ),
        listLegacyTrackRows: async () => {
          throw new Error("selected-artist rows must not query legacy storage");
        },
      }) as never,
    );

    expect(rows.map((row) => row.id)).toEqual(["row-b"]);
    expect(rows[0]).toMatchObject({ trackTitle: "B", releaseTitle: "Release B", combinedStreams: 200 });
  });
});
