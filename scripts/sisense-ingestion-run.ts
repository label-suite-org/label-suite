/**
 * The lifecycle seam for one Sisense ingestion attempt.
 *
 * Browser and saved-file acquisition are deliberately adapters: both return
 * the same downloaded-file evidence and completeness before this module takes
 * over raw staging, normalized publication, completion, and failure evidence.
 */

export type SisenseIngestionRunStatus = "completed" | "partial" | "empty" | "failed";

export type SisenseIngestionAcquisition<TFile, TCompleteness> = {
  files: TFile[];
  completeness: TCompleteness | null;
};

export type SisenseIngestionStats = {
  filesDownloaded: number;
  rowsImported: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
};

export type SisenseIngestionRunAdapter<TFile, TPrepared, TCompleteness, TStats extends SisenseIngestionStats> = {
  /** Acquire a lock for the complete attempt. Return a release callback. */
  acquireLock: () => Promise<(() => Promise<void> | void) | null>;
  startRun?: () => Promise<void>;
  acquire: () => Promise<SisenseIngestionAcquisition<TFile, TCompleteness>>;
  validateAcquisition?: (acquisition: SisenseIngestionAcquisition<TFile, TCompleteness>) => Promise<void> | void;
  /** Stage raw provenance and normalize, before publication begins. */
  prepare: (file: TFile) => Promise<TPrepared>;
  beginPublication?: () => Promise<void>;
  publish: (prepared: TPrepared) => Promise<TStats>;
  complete: (input: { status: "completed"; acquisition: SisenseIngestionAcquisition<TFile, TCompleteness>; stats: TStats }) => Promise<void>;
  recordFailure?: (input: { error: unknown; acquisition: SisenseIngestionAcquisition<TFile, TCompleteness> | null; stats: TStats }) => Promise<void>;
  commitPublication?: () => Promise<void>;
  rollbackPublication?: () => Promise<void>;
  shouldStopAfterRawStaging?: () => boolean;
};

export class SisenseIngestionLockError extends Error {
  constructor() {
    super("Another Sisense sync is already running.");
    this.name = "SisenseIngestionLockError";
  }
}

export async function runSisenseIngestionRun<
  TFile,
  TPrepared,
  TCompleteness,
  TStats extends SisenseIngestionStats,
>(adapter: SisenseIngestionRunAdapter<TFile, TPrepared, TCompleteness, TStats>): Promise<{
  acquisition: SisenseIngestionAcquisition<TFile, TCompleteness>;
  stats: TStats;
}> {
  let releaseLock: (() => Promise<void> | void) | null = null;
  let acquisition: SisenseIngestionAcquisition<TFile, TCompleteness> | null = null;
  let publicationStarted = false;
  let stats = emptyStats() as TStats;

  try {
    releaseLock = await adapter.acquireLock();
    if (!releaseLock) throw new SisenseIngestionLockError();

    await adapter.startRun?.();
    acquisition = await adapter.acquire();
    await adapter.validateAcquisition?.(acquisition);
    const prepared = [] as TPrepared[];
    for (const file of acquisition.files) prepared.push(await adapter.prepare(file));
    if (adapter.shouldStopAfterRawStaging?.()) {
      throw new Error("Test requested failure after raw-file staging.");
    }

    if (adapter.beginPublication) {
      await adapter.beginPublication();
      publicationStarted = true;
    }
    for (const item of prepared) stats = addStats(stats, await adapter.publish(item)) as TStats;
    await adapter.complete({ status: "completed", acquisition, stats });
    if (publicationStarted) await adapter.commitPublication?.();
    return { acquisition, stats };
  } catch (error) {
    if (publicationStarted) await adapter.rollbackPublication?.().catch(() => undefined);
    await adapter.recordFailure?.({ error, acquisition, stats }).catch(() => undefined);
    throw error;
  } finally {
    await releaseLock?.();
  }
}

function emptyStats(): SisenseIngestionStats {
  return { filesDownloaded: 0, rowsImported: 0, rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 0 };
}

function addStats(left: SisenseIngestionStats, right: SisenseIngestionStats): SisenseIngestionStats {
  return {
    filesDownloaded: left.filesDownloaded + right.filesDownloaded,
    rowsImported: left.rowsImported + right.rowsImported,
    rowsInserted: left.rowsInserted + right.rowsInserted,
    rowsUpdated: left.rowsUpdated + right.rowsUpdated,
    rowsUnchanged: left.rowsUnchanged + right.rowsUnchanged,
  };
}
