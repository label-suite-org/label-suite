import { describe, expect, it } from "vitest";
import { SisenseIngestionLockError, runSisenseIngestionRun, type SisenseIngestionStats } from "./sisense-ingestion-run";

type File = { name: string };
type Prepared = { file: File; rows: number };
type Stats = SisenseIngestionStats;

const stats = (rows: number): Stats => ({ filesDownloaded: 1, rowsImported: rows, rowsInserted: rows, rowsUpdated: 0, rowsUnchanged: 0 });

describe("Sisense Ingestion Run", () => {
  it("uses one lifecycle for acquired files, preserves ordering, and commits only after completion", async () => {
    const events: string[] = [];
    const result = await runSisenseIngestionRun<File, Prepared, { state: string }, Stats>({
      acquireLock: async () => { events.push("lock"); return () => { events.push("unlock"); }; },
      startRun: async () => { events.push("start"); },
      acquire: async () => { events.push("acquire"); return { files: [{ name: "browser.csv" }, { name: "saved.csv" }], completeness: { state: "complete" } }; },
      prepare: async (file) => { events.push(`prepare:${file.name}`); return { file, rows: file.name === "browser.csv" ? 2 : 3 }; },
      beginPublication: async () => { events.push("begin"); },
      publish: async (prepared) => { events.push(`publish:${prepared.file.name}`); return stats(prepared.rows); },
      complete: async ({ stats: completed }) => { events.push(`complete:${completed.rowsImported}`); },
      commitPublication: async () => { events.push("commit"); },
    });

    expect(result.stats.rowsImported).toBe(5);
    expect(events).toEqual([
      "lock", "start", "acquire", "prepare:browser.csv", "prepare:saved.csv", "begin",
      "publish:browser.csv", "publish:saved.csv", "complete:5", "commit", "unlock",
    ]);
  });

  it("rolls back publication and records safe failure after raw staging", async () => {
    const events: string[] = [];
    await expect(runSisenseIngestionRun<File, Prepared, null, Stats>({
      acquireLock: async () => () => { events.push("unlock"); },
      acquire: async () => ({ files: [{ name: "saved.csv" }], completeness: null }),
      prepare: async () => { events.push("prepare"); return { file: { name: "saved.csv" }, rows: 1 }; },
      shouldStopAfterRawStaging: () => true,
      beginPublication: async () => { events.push("begin"); },
      publish: async () => stats(1),
      complete: async () => { events.push("complete"); },
      rollbackPublication: async () => { events.push("rollback"); },
      recordFailure: async ({ error }) => { events.push(error instanceof Error ? error.message : "failure"); },
    })).rejects.toThrow("Test requested failure after raw-file staging.");
    expect(events).toEqual(["prepare", "Test requested failure after raw-file staging.", "unlock"]);
  });

  it("rolls back normalized publication when one file fails", async () => {
    const events: string[] = [];
    await expect(runSisenseIngestionRun<File, Prepared, null, Stats>({
      acquireLock: async () => () => { events.push("unlock"); },
      acquire: async () => ({ files: [{ name: "first.csv" }, { name: "second.csv" }], completeness: null }),
      prepare: async (file) => ({ file, rows: 1 }),
      beginPublication: async () => { events.push("begin"); },
      publish: async (prepared) => {
        events.push(`publish:${prepared.file.name}`);
        if (prepared.file.name === "second.csv") throw new Error("provider row failure");
        return stats(1);
      },
      complete: async () => { events.push("complete"); },
      rollbackPublication: async () => { events.push("rollback"); },
      recordFailure: async ({ error, stats: failedStats }) => { events.push(`${error instanceof Error ? error.message : "failure"}:${failedStats.rowsImported}`); },
    })).rejects.toThrow("provider row failure");
    expect(events).toEqual(["begin", "publish:first.csv", "publish:second.csv", "rollback", "provider row failure:1", "unlock"]);
  });

  it("records incomplete acquisition evidence without preparing or publishing it", async () => {
    const events: string[] = [];
    await expect(runSisenseIngestionRun<File, Prepared, { state: string }, Stats>({
      acquireLock: async () => () => { events.push("unlock"); },
      acquire: async () => ({ files: [{ name: "partial.csv" }], completeness: { state: "partial" } }),
      validateAcquisition: ({ completeness }) => {
        events.push(`validate:${completeness?.state}`);
        throw new Error("incomplete acquisition");
      },
      prepare: async () => { events.push("prepare"); return { file: { name: "partial.csv" }, rows: 1 }; },
      publish: async () => { events.push("publish"); return stats(1); },
      complete: async () => { events.push("complete"); },
      recordFailure: async ({ acquisition }) => { events.push(`failed:${acquisition?.completeness?.state}`); },
    })).rejects.toThrow("incomplete acquisition");
    expect(events).toEqual(["validate:partial", "failed:partial", "unlock"]);
  });

  it("fails closed when the advisory lock cannot be acquired", async () => {
    const events: string[] = [];
    await expect(runSisenseIngestionRun<File, Prepared, null, Stats>({
      acquireLock: async () => null,
      acquire: async () => { events.push("acquire"); return { files: [], completeness: null }; },
      prepare: async () => ({ file: { name: "unused" }, rows: 0 }),
      publish: async () => stats(0),
      complete: async () => undefined,
      recordFailure: async ({ error }) => { events.push(error instanceof SisenseIngestionLockError ? "locked" : "wrong"); },
    })).rejects.toThrow(SisenseIngestionLockError);
    expect(events).toEqual(["locked"]);
  });
});
