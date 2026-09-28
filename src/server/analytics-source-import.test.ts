import { describe, expect, it } from "vitest";
import { runAnalyticsSourceImport } from "./analytics-source-import-legacy";

type Input = { orgId: string };
type Context = { artistId: string };
type Transaction = { name: string };
type Counts = { inserted: number; updated: number; unchanged: number };
type Result = { kind: "duplicate" | "imported"; runId?: string; counts?: Counts };
type Failure = { phase: string; archived: string | null; runId: string; fileId: string };

function setup(options: { duplicate?: boolean; persistError?: Error } = {}) {
  const events: string[] = [];
  const failed: Failure[] = [];
  let id = 0;
  const dependencies = {
    store: {
      withLockedTransaction: async <T>(_orgId: string, work: (tx: Transaction) => Promise<T>) => work({ name: "transaction" }),
      recordFailedRun: async (input: Failure) => { failed.push(input); },
    },
    now: () => new Date("2026-08-16T12:00:00Z"),
    randomId: () => `id-${++id}`,
    getOrgId: (input: Input) => input.orgId,
    verifyTenant: async () => { events.push("tenant"); return { artistId: "artist-a" }; },
    findSuccessfulDuplicate: async () => { events.push("duplicate"); return options.duplicate ? { runId: "air-old" } : null; },
    duplicateResult: (_tx: Transaction, duplicate: { runId: string }): Result => ({ kind: "duplicate", runId: duplicate.runId }),
    createRun: async () => { events.push("run"); },
    archive: async () => { events.push("archive"); return { bucket: "private", key: "archive.csv" }; },
    recordFile: async () => { events.push("file"); },
    persistRows: async () => {
      events.push("persist");
      if (options.persistError) throw options.persistError;
      return { inserted: 1, updated: 0, unchanged: 0 };
    },
    completeRun: async () => { events.push("complete"); },
    importedResult: (_context: Context, runId: string, counts: Counts): Result => ({ kind: "imported", runId, counts }),
    buildFailureEvidence: ({ archivedFile, phase, runId, fileId }: { archivedFile: { bucket: string; key: string } | null; phase: string; runId: string; fileId: string }): Failure => ({
      phase,
      archived: archivedFile?.key ?? null,
      runId,
      fileId,
    }),
  };
  return { dependencies, events, failed };
}

describe("runAnalyticsSourceImport", () => {
  it("owns the ordered success lifecycle", async () => {
    const { dependencies, events } = setup();

    await expect(runAnalyticsSourceImport(dependencies, { orgId: "org-a" })).resolves.toMatchObject({
      kind: "imported",
      runId: "air_id-1",
      counts: { inserted: 1 },
    });
    expect(events).toEqual(["tenant", "duplicate", "run", "archive", "file", "persist", "complete"]);
  });

  it("checks duplicates before creating a run or archiving source evidence", async () => {
    const { dependencies, events } = setup({ duplicate: true });

    await expect(runAnalyticsSourceImport(dependencies, { orgId: "org-a" })).resolves.toEqual({
      kind: "duplicate",
      runId: "air-old",
    });
    expect(events).toEqual(["tenant", "duplicate"]);
  });

  it("records safe phase evidence while preserving the original persistence error", async () => {
    const error = new Error("private database detail");
    const { dependencies, failed } = setup({ persistError: error });

    await expect(runAnalyticsSourceImport(dependencies, { orgId: "org-a" })).rejects.toBe(error);
    expect(failed).toEqual([{
      phase: "metric persistence",
      archived: "archive.csv",
      runId: "air_id-3",
      fileId: "aif_id-4",
    }]);
  });
});
