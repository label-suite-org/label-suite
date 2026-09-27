/**
 * The shared, evidence-preserving lifecycle for an Analytics Source Import.
 *
 * Source adapters keep parsing, identity, normalized-row persistence, and
 * public result/error mapping. This module owns the ordering that must stay
 * identical across adapters: tenant/source lock, duplicate check, private
 * archive, run/file evidence, completion, and safe failed evidence.
 */

import { sql } from "drizzle-orm";

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

export interface AnalyticsSourceImportDatabase {
  transaction<T>(work: (tx: any) => Promise<T>): Promise<T>;
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

export interface AnalyticsSourceImportFailureContext<TInput, TContext> {
  input: TInput;
  context: TContext | null;
  archivedFile: AnalyticsSourceImportArchive | null;
  phase: AnalyticsSourceImportFailurePhase;
  runId: string;
  fileId: string;
}

export interface AnalyticsSourceImportLifecycleDependencies<
  TInput,
  TContext,
  TTransaction,
  TDuplicate,
  TCounts extends Record<string, number>,
  TResult,
  TFailure,
> {
  store: {
    withLockedTransaction<T>(orgId: string, work: (tx: TTransaction) => Promise<T>): Promise<T>;
    recordFailedRun(input: TFailure): Promise<void>;
  };
  assertArchiveReady?: () => void;
  now: () => Date;
  randomId: () => string;
  getOrgId: (input: TInput) => string;
  verifyTenant: (tx: TTransaction, input: TInput) => Promise<TContext>;
  findSuccessfulDuplicate: (tx: TTransaction, context: TContext) => Promise<TDuplicate | null>;
  duplicateResult: (tx: TTransaction, duplicate: TDuplicate) => TResult | Promise<TResult>;
  createRun: (tx: TTransaction, context: TContext, runId: string) => Promise<void>;
  archive: (input: TInput, context: TContext) => Promise<AnalyticsSourceImportArchive>;
  recordFile: (
    tx: TTransaction,
    context: TContext,
    runId: string,
    fileId: string,
    archivedFile: AnalyticsSourceImportArchive,
  ) => Promise<void>;
  persistRows: (tx: TTransaction, context: TContext, runId: string) => Promise<TCounts>;
  completeRun: (tx: TTransaction, runId: string, counts: TCounts) => Promise<void>;
  importedResult: (context: TContext, runId: string, counts: TCounts, observedAt: Date) => TResult;
  buildFailureEvidence: (input: AnalyticsSourceImportFailureContext<TInput, TContext>) => TFailure;
  shouldRecordFailure?: (error: unknown) => boolean;
  initialFailurePhase?: AnalyticsSourceImportFailurePhase;
  mapError?: (error: unknown, phase: AnalyticsSourceImportFailurePhase) => never;
}

/** Run one source adapter through the shared Analytics Source Import lifecycle. */
export async function runAnalyticsSourceImport<
  TInput,
  TContext,
  TTransaction,
  TDuplicate,
  TCounts extends Record<string, number>,
  TResult,
  TFailure,
>(
  dependencies: AnalyticsSourceImportLifecycleDependencies<
    TInput,
    TContext,
    TTransaction,
    TDuplicate,
    TCounts,
    TResult,
    TFailure
  >,
  input: TInput,
): Promise<TResult> {
  const orgId = dependencies.getOrgId(input);
  let failurePhase: AnalyticsSourceImportFailurePhase = dependencies.initialFailurePhase ?? "private archive";
  let context: TContext | null = null;
  let archivedFile: AnalyticsSourceImportArchive | null = null;

  try {
    dependencies.assertArchiveReady?.();
    return await dependencies.store.withLockedTransaction(orgId, async (tx) => {
      failurePhase = "tenant verification";
      context = await dependencies.verifyTenant(tx, input);

      failurePhase = "duplicate check";
      const duplicate = await dependencies.findSuccessfulDuplicate(tx, context);
      if (duplicate) return dependencies.duplicateResult(tx, duplicate);

      const runId = `air_${dependencies.randomId()}`;
      const fileId = `aif_${dependencies.randomId()}`;
      failurePhase = "run creation";
      await dependencies.createRun(tx, context, runId);

      failurePhase = "private archive";
      archivedFile = await dependencies.archive(input, context);

      failurePhase = "file provenance";
      await dependencies.recordFile(tx, context, runId, fileId, archivedFile);

      failurePhase = "metric persistence";
      const counts = await dependencies.persistRows(tx, context, runId);

      failurePhase = "run completion";
      await dependencies.completeRun(tx, runId, counts);

      return dependencies.importedResult(context, runId, counts, dependencies.now());
    });
  } catch (error) {
    if (dependencies.shouldRecordFailure?.(error) ?? true) {
      try {
        await dependencies.store.recordFailedRun(dependencies.buildFailureEvidence({
          input,
          context,
          archivedFile,
          phase: failurePhase,
          runId: `air_${dependencies.randomId()}`,
          fileId: `aif_${dependencies.randomId()}`,
        }));
      } catch {
        // Failed evidence is best-effort and must never replace the import error.
      }
    }
    if (dependencies.mapError) throw dependencies.mapError(error, failurePhase);
    throw error;
  }
}
