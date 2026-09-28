// Temporary Sisense lifecycle, removed when its database ownership moves to the shared operation.
import type { AnalyticsSourceImportArchive, AnalyticsSourceImportFailurePhase } from "./analytics-source-import";

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
