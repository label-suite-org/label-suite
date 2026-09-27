import { getRequestId } from "./request-context";

export const PERFORMANCE_BUDGET_MS = Object.freeze({
  apiRead: 500,
  apiMutation: 750,
  ssr: 1_000,
  jobHeartbeat: 60_000,
});

export type LogSeverity = "debug" | "info" | "warn" | "error";

export interface StructuredLogEvent {
  severity: LogSeverity;
  event: string;
  requestId?: string;
  jobId?: string;
  route?: string;
  jobType?: string;
  operation?: string;
  orgId?: string;
  durationMs?: number;
  outcome?: string;
  status?: number;
  errorClass?: string;
  [key: string]: unknown;
}

/** Emit a compact ingestion-health record without serializing raw analytics evidence. */
export function logAnalyticsIngestionHealth(input: {
  orgId: string;
  stale: boolean;
  failedRuns: number;
  unreviewedDuplicateCandidates: number;
  lastSuccessfulRunAt: Date | null;
  sourceObservedAt: Date | null;
  reportingThrough: Date | null;
  freshnessBasis: "row_reporting_date" | "snapshot_observed_at" | "unknown";
  coverage: "complete" | "partial" | "empty" | "invalid";
}): void {
  logEvent({
    severity: input.stale || input.failedRuns > 0 ? "warn" : "info",
    event: "analytics.ingestion_health",
    orgId: input.orgId,
    outcome: input.stale ? "stale" : "current",
    stale: input.stale,
    failedRuns: input.failedRuns,
    unreviewedDuplicateCandidates: input.unreviewedDuplicateCandidates,
    lastSuccessfulRunAt: input.lastSuccessfulRunAt?.toISOString() ?? null,
    sourceObservedAt: input.sourceObservedAt?.toISOString() ?? null,
    reportingThrough: input.reportingThrough?.toISOString() ?? null,
    freshnessBasis: input.freshnessBasis,
    coverage: input.coverage,
  });
}

export function logEvent(event: StructuredLogEvent): void {
  const record = {
    timestamp: new Date().toISOString(),
    ...event,
    ...(event.requestId ? {} : getRequestId() ? { requestId: getRequestId() } : {}),
  };
  const serialized = JSON.stringify(record);
  if (event.severity === "error") console.error(serialized);
  else if (event.severity === "warn") console.warn(serialized);
  else console.log(serialized);
}

export async function observeOperation<T>(
  operation: string,
  orgId: string,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await work();
    logEvent({
      severity: "info",
      event: "query.completed",
      operation,
      orgId,
      durationMs: elapsed(startedAt),
      outcome: "succeeded",
    });
    return result;
  } catch (error) {
    logEvent({
      severity: "error",
      event: "query.completed",
      operation,
      orgId,
      durationMs: elapsed(startedAt),
      outcome: "failed",
      errorClass: errorClass(error),
    });
    throw error;
  }
}

export function requestPerformanceBudget(path: string, method: string): number {
  if (!path.startsWith("/api/")) return PERFORMANCE_BUDGET_MS.ssr;
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
    ? PERFORMANCE_BUDGET_MS.apiRead
    : PERFORMANCE_BUDGET_MS.apiMutation;
}

export function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return "UnknownError";
}
