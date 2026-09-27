import { beforeEach, describe, expect, it, vi } from "vitest";
import { analytics_import_runs, analytics_metric_rows } from "../db/schema";

const database = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("../lib/db", () => ({
  db: { transaction: database.transaction },
}));

import { getAnalyticsIngestionServiceHealth } from "./analytics-data-quality";

describe("public analytics health probe", () => {
  const now = new Date("2026-08-01T12:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANALYTICS_HEALTH_ORG_ID;
  });

  it("uses only bounded analytics import-run queries and a deterministic latest-run order", async () => {
    const probe = installProbe({ run: completedRun() });

    await expect(getAnalyticsIngestionServiceHealth(now)).resolves.toEqual({ status: "ok", freshness: "current", coverage: "complete" });
    expect(probe.select).toHaveBeenCalledTimes(2);
    expect(probe.selectedFields).toEqual([
      ["completedAt", "metadata", "mode", "rowsImported"].sort(),
      ["total"],
    ]);
    expect(probe.fromTables).toEqual([analytics_import_runs, analytics_import_runs]);
    expect(probe.fromTables).not.toContain(analytics_metric_rows);
    expect(probe.orderByArguments).toHaveLength(1);
    expect(probe.orderByArguments[0]).toHaveLength(2);
  });

  it.each([
    { name: "no completed run", input: {}, expected: { status: "degraded", freshness: "unknown", coverage: "empty" } },
    { name: "partial coverage", input: { run: completedRun({ metadata: partialMetadata() }) }, expected: { status: "degraded", freshness: "unknown", coverage: "partial" } },
    { name: "empty coverage", input: { run: completedRun({ metadata: emptyMetadata(), rowsImported: 0 }) }, expected: { status: "degraded", freshness: "unknown", coverage: "empty" } },
    { name: "invalid coverage metadata", input: { run: completedRun({ metadata: {} }) }, expected: { status: "degraded", freshness: "unknown", coverage: "invalid" } },
    { name: "a stale complete sync", input: { run: completedRun({ completedAt: new Date(now.getTime() - (49 * 60 * 60 * 1_000)) }) }, expected: { status: "degraded", freshness: "stale", coverage: "complete" } },
    { name: "an import replay without source freshness", input: { run: completedRun({ mode: "import" }) }, expected: { status: "degraded", freshness: "unknown", coverage: "complete" } },
    { name: "one failure after a current complete sync", input: { run: completedRun(), failedRuns: 1 }, expected: { status: "ok", freshness: "current", coverage: "complete" } },
    { name: "repeated failures after a current complete sync", input: { run: completedRun(), failedRuns: 2 }, expected: { status: "degraded", freshness: "current", coverage: "complete" } },
    { name: "a malformed completion time", input: { run: completedRun({ completedAt: "not-a-timestamp" }) }, expected: { status: "unknown", freshness: "unknown", coverage: "unknown" } },
    { name: "a failed bounded aggregate query", input: { run: completedRun(), failAggregate: true }, expected: { status: "unknown", freshness: "unknown", coverage: "unknown" } },
  ])("returns deterministic enums for $name", async ({ input, expected }) => {
    installProbe(input);
    await expect(getAnalyticsIngestionServiceHealth(now)).resolves.toEqual(expected);
  });
});

type CompletedRun = {
  mode: string;
  completedAt: Date | string;
  metadata: unknown;
  rowsImported: number;
};

function completedRun(input: Partial<CompletedRun> = {}): CompletedRun {
  return {
    mode: "sync",
    completedAt: new Date("2026-08-01T12:00:00Z"),
    metadata: completeMetadata(),
    rowsImported: 4,
    ...input,
  };
}

function completeMetadata() {
  return { completeness: { version: 1, state: "complete", expectedWidgetKeys: ["streams"], downloadedWidgetKeys: ["streams"], skippedWidgets: [] } };
}

function partialMetadata() {
  return { completeness: { version: 1, state: "partial", expectedWidgetKeys: ["streams", "sales"], downloadedWidgetKeys: ["streams"], skippedWidgets: [{ key: "sales", reason: "No rows" }] } };
}

function emptyMetadata() {
  return { completeness: { version: 1, state: "empty", expectedWidgetKeys: ["streams"], downloadedWidgetKeys: [], skippedWidgets: [{ key: "streams", reason: "No rows" }] } };
}

function installProbe(input: { run?: CompletedRun; failedRuns?: number; failAggregate?: boolean }) {
  const fromTables: unknown[] = [];
  const orderByArguments: unknown[][] = [];
  const select = vi.fn()
    .mockImplementationOnce(() => query(input.run ? [input.run] : [], fromTables, orderByArguments))
    .mockImplementationOnce(() => input.failAggregate
      ? rejectedQuery(new Error("aggregate unavailable"), fromTables, orderByArguments)
      : query([{ total: input.failedRuns ?? 0 }], fromTables, orderByArguments));
  const tx = { execute: vi.fn().mockResolvedValue(undefined), select };
  database.transaction.mockImplementation(async (callback) => callback(tx));
  return {
    select,
    fromTables,
    orderByArguments,
    get selectedFields() {
      return select.mock.calls.map(([fields]) => Object.keys(fields).sort());
    },
  };
}

function query(result: unknown[], fromTables: unknown[], orderByArguments: unknown[][]) {
  const chain: any = {
    from: (table: unknown) => {
      fromTables.push(table);
      return chain;
    },
    where: () => chain,
    orderBy: (...fields: unknown[]) => {
      orderByArguments.push(fields);
      return chain;
    },
    limit: async () => result,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function rejectedQuery(error: Error, fromTables: unknown[], orderByArguments: unknown[][]) {
  const chain: any = {
    from: (table: unknown) => {
      fromTables.push(table);
      return chain;
    },
    where: () => chain,
    orderBy: (...fields: unknown[]) => {
      orderByArguments.push(fields);
      return chain;
    },
    limit: async () => Promise.reject(error),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.reject(error).then(resolve, reject),
  };
  return chain;
}
