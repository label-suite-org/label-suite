/**
 * The shared, evidence-preserving lifecycle for an Analytics Source Import.
 *
 * Source adapters keep parsing, identity, normalized-row persistence, and
 * public result/error mapping. This module owns the ordering that must stay
 * identical across adapters: tenant/source lock, duplicate check, private
 * archive, run/file evidence, completion, and safe failed evidence.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { analytics_import_files, analytics_import_runs, artists } from "../db/schema";

export type AnalyticsSourceImportFailurePhase =
  | "tenant verification"
  | "duplicate check"
  | "run creation"
  | "private archive"
  | "file provenance"
  | "metric persistence"
  | "run completion";

export interface AnalyticsSourceImportArchive {
  bucket: string;
  key: string;
}

type RunEvidence = Pick<typeof analytics_import_runs.$inferInsert,
  "artist_id" | "requested_date_range" | "requested_aggregation" | "metadata">;
type FileEvidence = Pick<typeof analytics_import_files.$inferInsert,
  "artist_id" | "widget_key" | "widget_title" | "requested_date_range" |
  "requested_aggregation" | "file_name" | "sha256" | "byte_size" | "row_count" | "headers">;
type Counts = { inserted: number; updated: number; unchanged: number };

/** Source code supplies evidence values, never implementations of persistence phases. */
export async function runAnalyticsSourceImport<TInput, TContext, TTransaction, TDuplicate, TResult>(
  dependencies: {
    database: AnalyticsSourceImportDatabaseProvider;
    source: string;
    lock: "try" | "wait";
    lockError?: () => Error;
    transaction: (tx: any, orgId: string, observedAt: Date) => TTransaction;
    assertArchiveReady?: () => void;
    now: () => Date;
    randomId: () => string;
    getOrgId: (input: TInput) => string;
    verifyTenant: (tx: TTransaction, input: TInput) => Promise<TContext>;
    findSuccessfulDuplicate: (tx: TTransaction, context: TContext) => Promise<TDuplicate | null>;
    duplicateResult: (tx: TTransaction, duplicate: TDuplicate) => TResult | Promise<TResult>;
    runEvidence: (context: TContext, observedAt: Date) => RunEvidence;
    fileEvidence: (context: TContext) => FileEvidence;
    archive: (input: TInput, context: TContext) => Promise<AnalyticsSourceImportArchive>;
    persistRows: (tx: TTransaction, context: TContext, runId: string) => Promise<Counts>;
    importedResult: (context: TContext, runId: string, counts: Counts, observedAt: Date) => TResult;
    failureEvidence: (input: TInput, context: TContext | null, phase: AnalyticsSourceImportFailurePhase, observedAt: Date) => {
      run: RunEvidence;
      file: FileEvidence | null;
      error: string;
    };
    shouldRecordFailure?: (error: unknown) => boolean;
    initialFailurePhase?: AnalyticsSourceImportFailurePhase;
    mapError?: (error: unknown, phase: AnalyticsSourceImportFailurePhase) => never;
  },
  input: TInput,
): Promise<TResult> {
  const orgId = dependencies.getOrgId(input);
  const source = dependencies.source;
  let phase: AnalyticsSourceImportFailurePhase = dependencies.initialFailurePhase ?? "private archive";
  let context: TContext | null = null;
  let archivedFile: AnalyticsSourceImportArchive | null = null;
  const fileValues = (evidence: FileEvidence, runId: string, fileId: string, archive: AnalyticsSourceImportArchive, observedAt: Date) => ({
    ...evidence, id: fileId, org_id: orgId, run_id: runId, source,
    storage_bucket: archive.bucket, storage_key: archive.key,
    storage_status: "uploaded", storage_uploaded_at: observedAt, created_at: observedAt,
  });
  try {
    dependencies.assertArchiveReady?.();
    const observedAt = dependencies.now();
    return await withAnalyticsSourceTransaction(dependencies.database, orgId, source, dependencies.lock, async (rawTx) => {
      const tx = dependencies.transaction(rawTx, orgId, observedAt);
      phase = "tenant verification";
      context = await dependencies.verifyTenant(tx, input);
      phase = "duplicate check";
      const duplicate = await dependencies.findSuccessfulDuplicate(tx, context);
      if (duplicate) return dependencies.duplicateResult(tx, duplicate);
      const runId = `air_${dependencies.randomId()}`;
      const fileId = `aif_${dependencies.randomId()}`;
      phase = "run creation";
      await rawTx.insert(analytics_import_runs).values({
        ...dependencies.runEvidence(context, observedAt), id: runId, org_id: orgId,
        source, mode: "manual_import", status: "running", started_at: observedAt,
      });
      phase = "private archive";
      archivedFile = await dependencies.archive(input, context);
      phase = "file provenance";
      await rawTx.insert(analytics_import_files).values(fileValues(dependencies.fileEvidence(context), runId, fileId, archivedFile, observedAt));
      phase = "metric persistence";
      const counts = await dependencies.persistRows(tx, context, runId);
      phase = "run completion";
      await rawTx.update(analytics_import_runs).set({
        status: "completed", completed_at: observedAt, files_downloaded: 1,
        rows_imported: counts.inserted + counts.updated + counts.unchanged,
        rows_inserted: counts.inserted, rows_updated: counts.updated, rows_unchanged: counts.unchanged, error: null,
      }).where(and(eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.id, runId)));
      return dependencies.importedResult(context, runId, counts, dependencies.now());
    }, dependencies.lockError);
  } catch (error) {
    if (dependencies.shouldRecordFailure?.(error) ?? true) {
      try {
        const runId = `air_${dependencies.randomId()}`;
        const fileId = `aif_${dependencies.randomId()}`;
        await withAnalyticsSourceTransaction(dependencies.database, orgId, source, "wait", async (tx) => {
          const observedAt = dependencies.now();
          const evidence = dependencies.failureEvidence(input, context, phase, observedAt);
          await tx.insert(analytics_import_runs).values({
            ...evidence.run, id: runId, org_id: orgId, source, mode: "manual_import", status: "failed",
            started_at: observedAt, completed_at: observedAt, files_downloaded: archivedFile ? 1 : 0,
            rows_imported: 0, rows_inserted: 0, rows_updated: 0, rows_unchanged: 0, error: evidence.error.slice(0, 500),
          });
          if (archivedFile && evidence.file) {
            await tx.insert(analytics_import_files).values(fileValues(evidence.file, runId, fileId, archivedFile, observedAt));
          }
        });
      } catch {
        // Failed evidence is best-effort and must never replace the import error.
      }
    }
    if (dependencies.mapError) throw dependencies.mapError(error, phase);
    throw error;
  }
}

export interface AnalyticsSourceImportDatabase {
  transaction<T>(work: (tx: any) => Promise<T>): Promise<T>;
}

/** Latest successful evidence is read under the source's existing lock policy. */
export async function listLatestAnalyticsSourceImports(
  database: AnalyticsSourceImportDatabaseProvider,
  orgId: string,
  source: string,
  widget: string,
  lock: "none" | "wait",
  manualOnly: boolean,
) {
  return withAnalyticsSourceTransaction(database, orgId, source, lock, async (tx) => {
    const rows = await tx.select({
      artistId: artists.id, artistName: artists.name, runId: analytics_import_runs.id,
      fileName: analytics_import_files.file_name, sha256: analytics_import_files.sha256,
      rowCount: analytics_import_files.row_count, completedAt: analytics_import_runs.completed_at,
      startedAt: analytics_import_runs.started_at, metadata: analytics_import_runs.metadata,
      requestedDateRange: analytics_import_runs.requested_date_range,
      aggregation: analytics_import_runs.requested_aggregation,
    }).from(analytics_import_runs)
      .innerJoin(analytics_import_files, and(
        eq(analytics_import_files.org_id, orgId), eq(analytics_import_files.run_id, analytics_import_runs.id),
        eq(analytics_import_files.source, source), eq(analytics_import_files.widget_key, widget),
        eq(analytics_import_files.storage_status, "uploaded"),
      ))
      .innerJoin(artists, and(eq(artists.org_id, orgId), eq(artists.id, analytics_import_runs.artist_id)))
      .where(and(
        eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.source, source),
        eq(analytics_import_runs.status, "completed"),
        manualOnly ? eq(analytics_import_runs.mode, "manual_import") : undefined,
      ))
      .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.started_at));
    const seen = new Set<string>();
    return rows.filter((row: { artistId: string }) => {
      if (!row.artistId || seen.has(row.artistId)) return false;
      seen.add(row.artistId);
      return true;
    });
  });
}

type AnalyticsSourceImportDatabaseProvider = () => Promise<AnalyticsSourceImportDatabase>;
type AnalyticsSourceImportLock = "none" | "try" | "wait";

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}

/** Keep the tenant/source transaction and advisory-lock invariant in one place. */
export async function withAnalyticsSourceTransaction<T>(
  databaseProvider: AnalyticsSourceImportDatabaseProvider,
  orgId: string,
  source: string,
  lock: AnalyticsSourceImportLock,
  work: (tx: any) => Promise<T>,
  lockError?: () => Error,
): Promise<T> {
  const database = await databaseProvider();
  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    const lockKey = `label-suite:${orgId}:${source}`;
    if (lock === "try") {
      const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked`);
      if (resultRows(result)[0]?.locked !== true) {
        throw lockError?.() ?? new Error(`Analytics source import is already running for ${orgId}`);
      }
    } else if (lock === "wait") {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    }
    return work(tx);
  });
}
