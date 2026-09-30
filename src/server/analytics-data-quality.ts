import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { analytics_duplicate_reviews, analytics_import_files, analytics_import_runs, analytics_metric_rows } from "../db/schema";
import { HttpError } from "./errors";
import { logAnalyticsIngestionHealth } from "./observability";
import { ANALYTICS_IMPORT_STALE_AFTER_HOURS } from "../lib/analytics-workspace";

export type AnalyticsDuplicateReason = "same_source_identity" | "same_isrc" | "same_artist_title";
export type AnalyticsDuplicateDisposition = "unreviewed" | "keep_separate" | "link_same_record" | "source_error";
export interface AnalyticsEvidenceRow { id: string; source: string; widgetKey: string; sourceId: string | null; isrc: string | null; artist: string | null; title: string | null; metricGrain: string; }
export interface AnalyticsDuplicateReviewProvenance { disposition: Exclude<AnalyticsDuplicateDisposition, "unreviewed">; reason: string | null; reviewedBy: string; reviewedAt: Date | string; }
export interface AnalyticsDuplicateCandidate { key: string; reason: AnalyticsDuplicateReason; rowIds: string[]; sourceKeys: string[]; isrc: string | null; artist: string | null; title: string | null; disposition: AnalyticsDuplicateDisposition; review?: AnalyticsDuplicateReviewProvenance; }
export type AnalyticsFreshnessBasis = "row_reporting_date" | "snapshot_observed_at" | "unknown";
export type AnalyticsCoverage = "complete" | "partial" | "empty" | "invalid";
export interface AnalyticsIngestionServiceHealth {
  status: "ok" | "degraded" | "unknown";
  freshness: "current" | "stale" | "unknown";
  coverage: AnalyticsCoverage | "unknown";
}
export interface AnalyticsIngestionHealth { lastSuccessfulRunAt: Date | null; sourceObservedAt: Date | null; reportingThrough: Date | null; freshnessBasis: AnalyticsFreshnessBasis; coverage: AnalyticsCoverage; stale: boolean; failedRuns: number; unreviewedDuplicateCandidates: number; degradedReasons: string[]; }
export interface AnalyticsSourceSummary { source: string; widgetKey: string; requestedDateRange: string | null; requestedAggregation: string | null; imported: number; raw: number; linked: number; unmatched: number; lastSeenAt: Date | null; }
export interface AnalyticsRawFileProvenance { id: string; source: string; widgetKey: string; fileName: string; sha256: string; byteSize: number; rowCount: number; requestedDateRange: string | null; requestedAggregation: string | null; storageBucket: string | null; storageKey: string | null; storageStatus: string; storageUploadedAt: Date | null; }
export interface AnalyticsCurrentImportRun { id: string; mode: string; completedAt: Date | null; requestedDateRange: string | null; requestedAggregation: string | null; expectedWidgetKeys: string[]; downloadedWidgetKeys: string[]; observedEmptyWidgets: Array<{ key: string; reason: string }>; skippedWidgets: Array<{ key: string; reason: string }>; rawFiles: AnalyticsRawFileProvenance[]; }
export interface AnalyticsDataQualityReport { health: AnalyticsIngestionHealth; currentRun: AnalyticsCurrentImportRun | null; evidence: { limit: number; returnedRows: number; partial: boolean; version: string; complete: boolean }; sources: AnalyticsSourceSummary[]; candidates: AnalyticsDuplicateCandidate[]; compatibility?: "schema_unavailable"; }

const STALE_AFTER_MS = ANALYTICS_IMPORT_STALE_AFTER_HOURS * 60 * 60 * 1_000;
const EVIDENCE_BATCH_SIZE = 1_000;
const REPEATED_INGESTION_FAILURES = 2;
const DEFAULT_HEALTH_ORG_ID = "true-nature"; // mirrors tenant.TRUE_NATURE_ORG_ID without importing its DB dependency.
export const ANALYTICS_EVIDENCE_RUN_MODES = ["sync", "import"] as const;
const reportingPeriodFields = new Set(["col0", "date", "day", "week", "month", "period", "date_to", "week_end", "month_end", "period_end", "reporting_date", "reporting_day", "reporting_week", "reporting_month", "reporting_period", "reporting_period_end"]);
const evidenceKeys = { sourceId: ["source_id", "sourceid", "id", "track_id", "recording_id"], isrc: ["isrc", "track_isrc", "recording_isrc"], artist: ["primary_artist", "artist", "artist_name", "main_artist"], title: ["track_title", "track", "track_name", "title", "song"] } as const;
const SISENSE_OBSERVED_EMPTY_REASON = "Query returned no matching rows.";
export const analyticsDuplicateReviewSchema = z.object({ candidateKey: z.string().min(1).max(500), evidenceVersion: z.string().length(64), disposition: z.enum(["keep_separate", "link_same_record", "source_error"]), reason: z.string().trim().max(2_000).nullable().optional() });
type EvidenceDbRow = { id: string; source: string; widgetKey: string; dimensions: Record<string, string | null>; rawRow: Record<string, string | null>; requestedAggregation: string; requestedDateRange: string; trackId: string | null; rowHash: string; lastSeenRunId: string | null; lastSeenAt: Date | null };
type RunCompletenessMetadata = { version?: number; expectedWidgetKeys?: unknown; downloadedWidgetKeys?: unknown; observedEmptyWidgets?: unknown; skippedWidgets?: unknown; state?: unknown };
type ReviewDbRow = { candidateKey: string; disposition: string; reason: string | null; reviewedBy: string; reviewedAt: Date | null };

/** Finds candidates only; it never merges, deletes, or otherwise mutates imported evidence. */
export function findAnalyticsDuplicateCandidates(rows: readonly AnalyticsEvidenceRow[]): AnalyticsDuplicateCandidate[] {
  const candidates: AnalyticsDuplicateCandidate[] = [];
  const rules: Array<{ reason: AnalyticsDuplicateReason; parts: (row: AnalyticsEvidenceRow) => readonly string[] | null }> = [
    { reason: "same_source_identity", parts: (row) => { const sourceId = clean(row.sourceId); return sourceId ? [row.source, row.widgetKey, row.metricGrain, sourceId] : null; } },
    { reason: "same_isrc", parts: (row) => { const isrc = normaliseIsrc(row.isrc); return isrc ? [row.metricGrain, isrc] : null; } },
    { reason: "same_artist_title", parts: (row) => { const artist = normalise(row.artist); const title = normalise(row.title); return artist && title ? [row.metricGrain, artist, title] : null; } },
  ];
  for (const rule of rules) {
    const groups = new Map<string, { parts: readonly string[]; rows: AnalyticsEvidenceRow[] }>();
    for (const row of rows) {
      const parts = rule.parts(row); if (!parts) continue;
      const groupKey = JSON.stringify(parts);
      const group = groups.get(groupKey) ?? { parts, rows: [] };
      group.rows.push(row);
      groups.set(groupKey, group);
    }
    for (const group of [...groups.values()].sort((a, b) => JSON.stringify(a.parts).localeCompare(JSON.stringify(b.parts)))) {
      if (group.rows.length < 2) continue;
      const ordered = group.rows.slice().sort((a, b) => a.id.localeCompare(b.id));
      candidates.push({ key: duplicateCandidateKey(rule.reason, group.parts), reason: rule.reason, rowIds: ordered.map((row) => row.id), sourceKeys: ordered.map((row) => `${row.source}:${row.widgetKey}:${row.sourceId ?? row.id}`), isrc: normaliseIsrc(ordered[0].isrc), artist: clean(ordered[0].artist), title: clean(ordered[0].title), disposition: "unreviewed" });
    }
  }
  return candidates;
}

export async function listAnalyticsDataQuality(orgId: string, now = new Date()): Promise<AnalyticsDataQualityReport> {
  const { db } = await import("../lib/db");
  const report = await db.transaction(async (tx) => {
    // A full duplicate review must read one database snapshot; a publisher may
    // replace its latest-run marker while this report is paging evidence.
    await setCurrentOrg(tx, orgId);
    return queryAnalyticsDataQuality(tx, orgId, now);
  }, { isolationLevel: "repeatable read" });
  logAnalyticsIngestionHealth({ orgId, stale: report.health.stale, failedRuns: report.health.failedRuns, unreviewedDuplicateCandidates: report.health.unreviewedDuplicateCandidates, lastSuccessfulRunAt: report.health.lastSuccessfulRunAt, sourceObservedAt: report.health.sourceObservedAt, reportingThrough: report.health.reportingThrough, freshnessBasis: report.health.freshnessBasis, coverage: report.health.coverage });
  return report;
}

/**
 * The importer holds the matching transaction-scoped advisory lock on a
 * dedicated pool client for its whole write. Review uses the same xact-scoped
 * lock, so a validated candidate cannot be orphaned by a concurrent import
 * before its disposition is committed.
 */
async function lockAnalyticsEvidence(tx: any, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`label-suite:${orgId}:sisense`}))`);
}

async function setCurrentOrg(tx: any, orgId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
}

async function queryAnalyticsDataQuality(tx: any, orgId: string, now: Date): Promise<AnalyticsDataQualityReport> {
  const [latestRun] = await tx.select({ id: analytics_import_runs.id, mode: analytics_import_runs.mode, completedAt: analytics_import_runs.completed_at, requestedDateRange: analytics_import_runs.requested_date_range, requestedAggregation: analytics_import_runs.requested_aggregation, metadata: analytics_import_runs.metadata })
    .from(analytics_import_runs)
    .where(and(eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.source, "sisense"), eq(analytics_import_runs.status, "completed"), inArray(analytics_import_runs.mode, ANALYTICS_EVIDENCE_RUN_MODES)))
    .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.id)).limit(1);

  const evidenceWhere = latestRun
    ? and(eq(analytics_metric_rows.org_id, orgId), eq(analytics_metric_rows.source, "sisense"), eq(analytics_metric_rows.last_seen_run_id, latestRun.id))
    : and(eq(analytics_metric_rows.org_id, orgId), eq(analytics_metric_rows.source, "sisense"), sql`false`);
  const [totals, sourceTotals, files, runs, reviews] = await Promise.all([
    tx.select({ total: sql<number>`count(*)` }).from(analytics_metric_rows).where(evidenceWhere),
    tx.select({ source: analytics_metric_rows.source, widgetKey: analytics_metric_rows.widget_key, requestedDateRange: analytics_metric_rows.requested_date_range, requestedAggregation: analytics_metric_rows.requested_aggregation, raw: sql<number>`count(*)`, linked: sql<number>`count(*) filter (where ${analytics_metric_rows.track_id} is not null)`, unmatched: sql<number>`count(*) filter (where ${analytics_metric_rows.track_id} is null)`, lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})` }).from(analytics_metric_rows).where(evidenceWhere).groupBy(analytics_metric_rows.source, analytics_metric_rows.widget_key, analytics_metric_rows.requested_date_range, analytics_metric_rows.requested_aggregation),
    latestRun ? tx.select({ id: analytics_import_files.id, source: analytics_import_files.source, widgetKey: analytics_import_files.widget_key, fileName: analytics_import_files.file_name, sha256: analytics_import_files.sha256, byteSize: analytics_import_files.byte_size, rowCount: analytics_import_files.row_count, requestedDateRange: analytics_import_files.requested_date_range, requestedAggregation: analytics_import_files.requested_aggregation, storageBucket: analytics_import_files.storage_bucket, storageKey: analytics_import_files.storage_key, storageStatus: analytics_import_files.storage_status, storageUploadedAt: analytics_import_files.storage_uploaded_at }).from(analytics_import_files).where(and(eq(analytics_import_files.org_id, orgId), eq(analytics_import_files.source, "sisense"), eq(analytics_import_files.run_id, latestRun.id))) : Promise.resolve([]),
    tx.select({ status: analytics_import_runs.status, completedAt: analytics_import_runs.completed_at }).from(analytics_import_runs).where(and(eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.source, "sisense"), inArray(analytics_import_runs.mode, ANALYTICS_EVIDENCE_RUN_MODES))),
    tx.select({ candidateKey: analytics_duplicate_reviews.candidate_key, disposition: analytics_duplicate_reviews.disposition, reason: analytics_duplicate_reviews.reason, reviewedBy: analytics_duplicate_reviews.reviewed_by, reviewedAt: analytics_duplicate_reviews.reviewed_at }).from(analytics_duplicate_reviews).where(eq(analytics_duplicate_reviews.org_id, orgId)),
  ]) as [Array<{ total: number | string }>, Array<{ source: string; widgetKey: string; requestedDateRange: string | null; requestedAggregation: string | null; raw: number | string; linked: number | string; unmatched: number | string; lastSeenAt: Date | string | null }>, Array<{ id: string; source: string; widgetKey: string; fileName: string; sha256: string; byteSize: number | null; rowCount: number | null; requestedDateRange: string | null; requestedAggregation: string | null; storageBucket: string | null; storageKey: string | null; storageStatus: string; storageUploadedAt: Date | string | null }>, Array<{ status: string; completedAt: Date | string | null }>, ReviewDbRow[]];
  const rows: EvidenceDbRow[] = [];
  let cursor: string | null = null;
  let reachedTerminalBatch = false;
  while (latestRun) {
    const batch = await tx.select({ id: analytics_metric_rows.id, source: analytics_metric_rows.source, widgetKey: analytics_metric_rows.widget_key, dimensions: analytics_metric_rows.dimensions, rawRow: analytics_metric_rows.raw_row, requestedAggregation: analytics_metric_rows.requested_aggregation, requestedDateRange: analytics_metric_rows.requested_date_range, trackId: analytics_metric_rows.track_id, rowHash: analytics_metric_rows.row_hash, lastSeenRunId: analytics_metric_rows.last_seen_run_id, lastSeenAt: analytics_metric_rows.last_seen_at })
      .from(analytics_metric_rows).where(cursor ? and(evidenceWhere, gt(analytics_metric_rows.id, cursor)) : evidenceWhere).orderBy(asc(analytics_metric_rows.id)).limit(EVIDENCE_BATCH_SIZE) as EvidenceDbRow[];
    rows.push(...batch);
    if (batch.length < EVIDENCE_BATCH_SIZE) { reachedTerminalBatch = true; break; }
    cursor = batch[batch.length - 1]!.id;
  }
  const candidates = findAnalyticsDuplicateCandidates(rows.map((row) => evidenceFromMetricRow(row)));
  const reviewByKey = new Map(reviews.map((review) => [review.candidateKey, review]));
  for (const candidate of candidates) {
    const review = reviewByKey.get(candidate.key);
    if (review && isDisposition(review.disposition)) { candidate.disposition = review.disposition; candidate.review = { disposition: review.disposition, reason: review.reason, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt ?? now }; }
  }
  const sourceMap = new Map<string, AnalyticsSourceSummary>();
  for (const row of sourceTotals) sourceMap.set(sourceSummaryKey(row), { source: row.source, widgetKey: row.widgetKey, requestedDateRange: row.requestedDateRange, requestedAggregation: row.requestedAggregation, imported: 0, raw: Number(row.raw), linked: Number(row.linked), unmatched: Number(row.unmatched), lastSeenAt: dateOrNull(row.lastSeenAt) });
  addImportedFileCounts(sourceMap, files);
  const lastSuccessfulRunAt = dateOrNull(latestRun?.completedAt);
  const reportingThrough = deriveReportingThrough(rows);
  const total = Number(totals[0]?.total ?? 0);
  const evidenceComplete = isAnalyticsEvidenceComplete({ hasLatestRun: Boolean(latestRun), exactTotal: total, processedRows: rows.length, reachedTerminalBatch });
  const parsedCompleteness = parseAnalyticsRunCompleteness(latestRun?.metadata, total);
  const completeness = evidenceComplete ? parsedCompleteness : { ...parsedCompleteness, coverage: latestRun ? "invalid" as const : "empty" as const };
  const freshness = resolveAnalyticsFreshness({ mode: latestRun?.mode ?? "unknown", completedAt: lastSuccessfulRunAt, reportingThrough, coverage: completeness.coverage, totalRows: total, now });
  const version = createHash("sha256").update(JSON.stringify({ runId: latestRun?.id ?? null, total, fileHashes: files.map((file) => [file.id, file.sha256]).sort(), rows: rows.map((row) => [row.id, row.rowHash]) })).digest("hex");
  const failedRuns = countAnalyticsIngestionFailuresSinceLastSuccess(runs, lastSuccessfulRunAt);
  const stale = freshness.stale || failedRuns >= REPEATED_INGESTION_FAILURES;
  const currentRun = latestRun ? { id: latestRun.id, mode: latestRun.mode, completedAt: dateOrNull(latestRun.completedAt), requestedDateRange: latestRun.requestedDateRange, requestedAggregation: latestRun.requestedAggregation, expectedWidgetKeys: completeness.expectedWidgetKeys, downloadedWidgetKeys: completeness.downloadedWidgetKeys, observedEmptyWidgets: completeness.observedEmptyWidgets, skippedWidgets: completeness.skippedWidgets, rawFiles: files.map((file) => ({ ...file, byteSize: Number(file.byteSize ?? 0), rowCount: Number(file.rowCount ?? 0), storageUploadedAt: dateOrNull(file.storageUploadedAt) })).sort((a, b) => a.fileName.localeCompare(b.fileName)) } : null;
  const reviewableCandidates = evidenceComplete ? candidates : [];
  const report = { health: { lastSuccessfulRunAt, sourceObservedAt: freshness.sourceObservedAt, reportingThrough, freshnessBasis: freshness.freshnessBasis, coverage: completeness.coverage, stale, failedRuns, unreviewedDuplicateCandidates: reviewableCandidates.filter((candidate) => candidate.disposition === "unreviewed").length, degradedReasons: analyticsDegradedReasons({ ...freshness, failedRuns }) }, currentRun, evidence: { limit: EVIDENCE_BATCH_SIZE, returnedRows: rows.length, partial: Boolean(latestRun) && !evidenceComplete, complete: evidenceComplete, version }, sources: [...sourceMap.values()].sort((a, b) => a.source.localeCompare(b.source) || a.widgetKey.localeCompare(b.widgetKey) || (a.requestedAggregation ?? "").localeCompare(b.requestedAggregation ?? "") || (a.requestedDateRange ?? "").localeCompare(b.requestedDateRange ?? "")), candidates: reviewableCandidates };
  return report;
}

/** Public health receives only service-wide readiness enums, never organization data. */
export async function getAnalyticsIngestionServiceHealth(now = new Date()): Promise<AnalyticsIngestionServiceHealth> {
  const orgId = process.env.ANALYTICS_HEALTH_ORG_ID?.trim() || DEFAULT_HEALTH_ORG_ID;
  try {
    const { db } = await import("../lib/db");
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      const [run] = await tx.select({ mode: analytics_import_runs.mode, completedAt: analytics_import_runs.completed_at, metadata: analytics_import_runs.metadata, rowsImported: analytics_import_runs.rows_imported })
        .from(analytics_import_runs)
        .where(and(eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.source, "sisense"), eq(analytics_import_runs.status, "completed"), inArray(analytics_import_runs.mode, ANALYTICS_EVIDENCE_RUN_MODES)))
        .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.id)).limit(1);
      if (!run) return evaluateAnalyticsIngestionServiceHealth({ lastSuccessfulRunAt: null, totalRows: 0, reportingThrough: null, sourceObservedAt: null, freshnessBasis: "unknown", coverage: "empty", failedRuns: 0 }, now);
      const completedAt = dateOrNull(run.completedAt);
      if (!completedAt) return unknownAnalyticsIngestionServiceHealth();
      const [failed] = await tx.select({ total: sql<number>`count(*)` })
        .from(analytics_import_runs)
        .where(and(
          eq(analytics_import_runs.org_id, orgId),
          eq(analytics_import_runs.source, "sisense"),
          eq(analytics_import_runs.status, "failed"),
          inArray(analytics_import_runs.mode, ANALYTICS_EVIDENCE_RUN_MODES),
          gt(analytics_import_runs.completed_at, completedAt),
        ));
      const failedRuns = Number(failed?.total ?? 0);
      const totalRows = Number(run.rowsImported ?? 0);
      const coverage = parseAnalyticsRunCompleteness(run.metadata, totalRows).coverage;
      // The importer records source dates once; health must not scan metric rows
      // or mistake a recent download of old data for current source evidence.
      const metadata = run.metadata && typeof run.metadata === "object" ? run.metadata as Record<string, unknown> : {};
      const source = z.object({ version: z.literal(1), reportingThrough: z.string().datetime({ offset: true }).nullable() }).safeParse(metadata.sourceFreshness);
      if (!source.success) {
        return { status: "degraded", freshness: "unknown", coverage };
      }
      const reportingThrough = dateOrNull(source.data.reportingThrough);
      const freshness = resolveAnalyticsFreshness({ mode: run.mode, completedAt, reportingThrough, coverage, totalRows, now });
      return evaluateAnalyticsIngestionServiceHealth({ ...freshness, lastSuccessfulRunAt: completedAt, failedRuns }, now);
    });
  } catch {
    return unknownAnalyticsIngestionServiceHealth();
  }
}

/** Compatibility wrapper for callers that only need the historical binary status. */
export async function getAnalyticsIngestionServiceStatus(now = new Date()): Promise<"ok" | "degraded"> {
  const health = await getAnalyticsIngestionServiceHealth(now);
  return health.status === "ok" ? "ok" : "degraded";
}

/** Injectable service decision seam for health tests and alternate query adapters. */
export function evaluateAnalyticsIngestionServiceStatus(
  probe: { lastSuccessfulRunAt: Date | null; totalRows: number; reportingThrough: Date | null; sourceObservedAt?: Date | null; freshnessBasis?: AnalyticsFreshnessBasis; coverage?: AnalyticsCoverage; failedRuns: number },
  now = new Date(),
): "ok" | "degraded" {
  const freshness = resolveAnalyticsFreshness({ mode: probe.freshnessBasis === "snapshot_observed_at" ? "sync" : "import", completedAt: probe.lastSuccessfulRunAt, reportingThrough: probe.reportingThrough, sourceObservedAt: probe.sourceObservedAt ?? null, coverage: probe.coverage ?? "complete", totalRows: probe.totalRows, now, freshnessBasis: probe.freshnessBasis });
  if (probe.totalRows === 0 || probe.failedRuns >= REPEATED_INGESTION_FAILURES || freshness.stale || (probe.coverage ?? "complete") !== "complete") return "degraded";
  return "ok";
}

export function evaluateAnalyticsIngestionServiceHealth(
  probe: { lastSuccessfulRunAt: Date | null; totalRows: number; reportingThrough: Date | null; sourceObservedAt?: Date | null; freshnessBasis?: AnalyticsFreshnessBasis; coverage?: AnalyticsCoverage; failedRuns: number },
  now = new Date(),
): AnalyticsIngestionServiceHealth {
  const coverage = probe.coverage ?? "complete";
  const freshness = resolveAnalyticsFreshness({ mode: probe.freshnessBasis === "snapshot_observed_at" ? "sync" : "import", completedAt: probe.lastSuccessfulRunAt, reportingThrough: probe.reportingThrough, sourceObservedAt: probe.sourceObservedAt ?? null, coverage, totalRows: probe.totalRows, now, freshnessBasis: probe.freshnessBasis });
  return {
    status: evaluateAnalyticsIngestionServiceStatus(probe, now),
    freshness: freshness.freshnessBasis === "unknown" ? "unknown" : freshness.stale ? "stale" : "current",
    coverage,
  };
}

export function unknownAnalyticsIngestionServiceHealth(): AnalyticsIngestionServiceHealth {
  return { status: "unknown", freshness: "unknown", coverage: "unknown" };
}

export async function getAnalyticsIngestionServiceStatusFromProbe(
  loadProbe: () => Promise<{ lastSuccessfulRunAt: Date | null; totalRows: number; reportingThrough: Date | null; sourceObservedAt?: Date | null; freshnessBasis?: AnalyticsFreshnessBasis; coverage?: AnalyticsCoverage; failedRuns: number }>,
  now = new Date(),
): Promise<"ok" | "degraded"> {
  try { return evaluateAnalyticsIngestionServiceStatus(await loadProbe(), now); } catch { return "degraded"; }
}

export async function getAnalyticsIngestionServiceHealthFromProbe(
  loadProbe: () => Promise<{ lastSuccessfulRunAt: Date | null; totalRows: number; reportingThrough: Date | null; sourceObservedAt?: Date | null; freshnessBasis?: AnalyticsFreshnessBasis; coverage?: AnalyticsCoverage; failedRuns: number }>,
  now = new Date(),
): Promise<AnalyticsIngestionServiceHealth> {
  try { return evaluateAnalyticsIngestionServiceHealth(await loadProbe(), now); } catch { return unknownAnalyticsIngestionServiceHealth(); }
}

/** Source dates are evidence; ingestion timestamps only tell us when we observed them. */
export function deriveReportingThrough(rows: ReadonlyArray<{ dimensions: Record<string, string | null>; rawRow: Record<string, string | null>; lastSeenAt?: Date | string | null }>): Date | null {
  const dates = rows.flatMap((row) => Object.entries({ ...row.dimensions, ...row.rawRow })
    .filter(([key]) => reportingPeriodFields.has(key.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase()))
    .map(([, value]) => parseSourceDate(value))
    .filter((value): value is Date => value !== null));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export function isAnalyticsIngestionStale(input: { lastSuccessfulRunAt: Date | null; reportingThrough: Date | null; now: Date }): boolean {
  if (!input.lastSuccessfulRunAt) return true;
  if (input.now.getTime() - input.lastSuccessfulRunAt.getTime() > STALE_AFTER_MS) return true;
  if (!input.reportingThrough) return true;
  return input.now.getTime() - input.reportingThrough.getTime() > STALE_AFTER_MS;
}

/** Freshness is source truth when a reporting dimension exists, otherwise a complete live scrape is an observation. */
export function resolveAnalyticsFreshness(input: {
  mode: string;
  completedAt: Date | null;
  reportingThrough: Date | null;
  sourceObservedAt?: Date | null;
  freshnessBasis?: AnalyticsFreshnessBasis;
  coverage: AnalyticsCoverage;
  totalRows: number;
  now?: Date;
}): { reportingThrough: Date | null; sourceObservedAt: Date | null; freshnessBasis: AnalyticsFreshnessBasis; coverage: AnalyticsCoverage; totalRows: number; stale: boolean } {
  const now = input.now ?? new Date();
  const canObserveSnapshot = input.mode === "sync" && input.coverage === "complete" && input.totalRows > 0 && input.completedAt !== null && !Number.isNaN(input.completedAt.getTime());
  const basis = input.reportingThrough
    ? "row_reporting_date"
    : input.freshnessBasis === "snapshot_observed_at" && canObserveSnapshot
      ? "snapshot_observed_at"
      : input.freshnessBasis === "row_reporting_date" ? "unknown"
        : canObserveSnapshot ? "snapshot_observed_at" : "unknown";
  const sourceObservedAt = basis === "snapshot_observed_at" ? (input.sourceObservedAt ?? input.completedAt) : null;
  const effective = basis === "row_reporting_date" ? input.reportingThrough : sourceObservedAt;
  const stale = input.totalRows === 0 || input.coverage !== "complete" || !effective || now.getTime() - effective.getTime() > STALE_AFTER_MS;
  return { reportingThrough: input.reportingThrough, sourceObservedAt, freshnessBasis: basis, coverage: input.coverage, totalRows: input.totalRows, stale };
}

function analyticsDegradedReasons(input: { reportingThrough: Date | null; sourceObservedAt: Date | null; freshnessBasis: AnalyticsFreshnessBasis; coverage: AnalyticsCoverage; totalRows: number; stale: boolean; failedRuns: number }): string[] {
  const reasons: string[] = [];
  if (input.coverage === "partial") reasons.push("missing_widgets");
  if (input.coverage === "empty") reasons.push("empty_feed");
  if (input.coverage === "invalid") reasons.push("invalid_evidence");
  if (input.freshnessBasis === "unknown") reasons.push("unknown_source_time");
  if (input.freshnessBasis === "row_reporting_date" && input.stale) reasons.push("stale_reporting_date");
  if (input.freshnessBasis === "snapshot_observed_at" && input.stale) reasons.push("stale_capture");
  if (input.failedRuns >= REPEATED_INGESTION_FAILURES) reasons.push("repeated_failures");
  return reasons;
}

export function isAnalyticsEvidenceComplete(input: { hasLatestRun: boolean; exactTotal: number; processedRows: number; reachedTerminalBatch: boolean }): boolean {
  return input.hasLatestRun && input.exactTotal >= 0 && input.processedRows === input.exactTotal && input.reachedTerminalBatch;
}

export function parseAnalyticsRunCompleteness(metadata: unknown, totalRows: number): { coverage: AnalyticsCoverage; expectedWidgetKeys: string[]; downloadedWidgetKeys: string[]; observedEmptyWidgets: Array<{ key: string; reason: string }>; skippedWidgets: Array<{ key: string; reason: string }> } {
  const value = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).completeness as RunCompletenessMetadata | undefined : undefined;
  if (!value || !isCompletenessState(value.state)) return invalidCompleteness();
  const expectedWidgetKeys = strictStringArray(value.expectedWidgetKeys);
  const downloadedWidgetKeys = strictStringArray(value.downloadedWidgetKeys);
  const skippedWidgets = strictSkippedWidgets(value.skippedWidgets);
  if (!expectedWidgetKeys || !downloadedWidgetKeys || !skippedWidgets || expectedWidgetKeys.length === 0) return invalidCompleteness();
  const expected = new Set(expectedWidgetKeys);
  const downloaded = new Set(downloadedWidgetKeys);
  const skipped = new Set(skippedWidgets.map((widget) => widget.key));
  if (value.version === 1) {
    const keysAreExpected = [...downloaded, ...skipped].every((key) => expected.has(key));
    const exactCoverage = expected.size === downloaded.size + skipped.size && [...expected].every((key) => downloaded.has(key) || skipped.has(key));
    if (!keysAreExpected || !exactCoverage) return invalidCompleteness();
    if (value.state === "complete") {
      return skipped.size === 0 && downloaded.size === expected.size && totalRows > 0
        ? { coverage: "complete", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets: [], skippedWidgets }
        : totalRows === 0 && skipped.size === 0 && downloaded.size === expected.size
          ? { coverage: "empty", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets: [], skippedWidgets }
          : invalidCompleteness();
    }
    if (value.state === "partial") return downloaded.size > 0 && skipped.size > 0
      ? { coverage: "partial", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets: [], skippedWidgets }
      : invalidCompleteness();
    return downloaded.size === 0 && skipped.size === expected.size && totalRows === 0
      ? { coverage: "empty", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets: [], skippedWidgets }
      : invalidCompleteness();
  }
  if (value.version !== 2) return invalidCompleteness();
  const observedEmptyWidgets = strictObservedEmptyWidgets(value.observedEmptyWidgets);
  if (!observedEmptyWidgets) return invalidCompleteness();
  const observedEmpty = new Set(observedEmptyWidgets.map((widget) => widget.key));
  const allKeys = [...downloaded, ...observedEmpty, ...skipped];
  const keysAreExpected = allKeys.every((key) => expected.has(key));
  const exactCoverage = expected.size === allKeys.length && [...expected].every((key) => downloaded.has(key) || observedEmpty.has(key) || skipped.has(key));
  if (!keysAreExpected || !exactCoverage) return invalidCompleteness();
  if (value.state === "complete") {
    return skipped.size === 0 && downloaded.size > 0 && totalRows > 0
      ? { coverage: "complete", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets, skippedWidgets }
      : invalidCompleteness();
  }
  if (value.state === "partial") return skipped.size > 0 && downloaded.size + observedEmpty.size > 0
    ? { coverage: "partial", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets, skippedWidgets }
    : invalidCompleteness();
  return downloaded.size === 0 && skipped.size === 0 && observedEmpty.size === expected.size && totalRows === 0
    ? { coverage: "empty", expectedWidgetKeys, downloadedWidgetKeys, observedEmptyWidgets, skippedWidgets }
    : invalidCompleteness();
}

function invalidCompleteness(): { coverage: "invalid"; expectedWidgetKeys: string[]; downloadedWidgetKeys: string[]; observedEmptyWidgets: Array<{ key: string; reason: string }>; skippedWidgets: Array<{ key: string; reason: string }> } { return { coverage: "invalid", expectedWidgetKeys: [], downloadedWidgetKeys: [], observedEmptyWidgets: [], skippedWidgets: [] }; }
function isCompletenessState(value: unknown): value is "complete" | "partial" | "empty" { return value === "complete" || value === "partial" || value === "empty"; }
function strictStringArray(value: unknown): string[] | null { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null; const values = value.map((item) => item.trim()); return new Set(values).size === values.length ? values.sort() : null; }
function strictSkippedWidgets(value: unknown): Array<{ key: string; reason: string }> | null { if (!Array.isArray(value)) return null; const widgets = value.map((item) => item && typeof item === "object" ? { key: (item as Record<string, unknown>).key, reason: (item as Record<string, unknown>).reason } : null); if (widgets.some((widget) => !widget || typeof widget.key !== "string" || !widget.key.trim() || typeof widget.reason !== "string" || !widget.reason.trim())) return null; const result = widgets as Array<{ key: string; reason: string }>; return new Set(result.map((widget) => widget.key)).size === result.length ? result.sort((a, b) => a.key.localeCompare(b.key)) : null; }
function strictObservedEmptyWidgets(value: unknown): Array<{ key: string; reason: string }> | null { const widgets = strictSkippedWidgets(value); return widgets && widgets.every((widget) => widget.reason === SISENSE_OBSERVED_EMPTY_REASON) ? widgets : null; }

/** Failures before the latest completion are historical; only the active failure streak needs intervention. */
export function countAnalyticsIngestionFailuresSinceLastSuccess(
  runs: ReadonlyArray<{ status: string; completedAt: Date | string | null }>,
  lastSuccessfulRunAt: Date | null,
): number {
  return runs.filter((run) => run.status === "failed" && (!lastSuccessfulRunAt || (dateOrNull(run.completedAt)?.getTime() ?? -Infinity) > lastSuccessfulRunAt.getTime())).length;
}

export function isAnalyticsEvidenceRunMode(mode: string): mode is (typeof ANALYTICS_EVIDENCE_RUN_MODES)[number] {
  return (ANALYTICS_EVIDENCE_RUN_MODES as readonly string[]).includes(mode);
}

export function addImportedFileCounts(
  sources: Map<string, AnalyticsSourceSummary>,
  files: ReadonlyArray<{ source: string; widgetKey: string; requestedDateRange?: string | null; requestedAggregation?: string | null; rowCount: number | null }>,
): AnalyticsSourceSummary[] {
  for (const file of files) {
    const key = sourceSummaryKey(file);
    const source = sources.get(key) ?? { source: file.source, widgetKey: file.widgetKey, requestedDateRange: file.requestedDateRange ?? null, requestedAggregation: file.requestedAggregation ?? null, imported: 0, raw: 0, linked: 0, unmatched: 0, lastSeenAt: null };
    source.imported += file.rowCount ?? 0;
    sources.set(key, source);
  }
  return [...sources.values()].sort((a, b) => a.source.localeCompare(b.source) || a.widgetKey.localeCompare(b.widgetKey) || (a.requestedAggregation ?? "").localeCompare(b.requestedAggregation ?? "") || (a.requestedDateRange ?? "").localeCompare(b.requestedDateRange ?? ""));
}

export async function saveAnalyticsDuplicateReview(input: z.infer<typeof analyticsDuplicateReviewSchema> & { orgId: string; reviewedBy: string }): Promise<void> {
  const { db } = await import("../lib/db");
  await db.transaction(async (tx) => {
    await setCurrentOrg(tx, input.orgId);
    await lockAnalyticsEvidence(tx, input.orgId);
    const current = await queryAnalyticsDataQuality(tx, input.orgId, new Date());
    assertAnalyticsDuplicateReviewCurrent(current, input);
    await tx.insert(analytics_duplicate_reviews).values({ id: `adr_${randomUUID()}`, org_id: input.orgId, candidate_key: input.candidateKey, disposition: input.disposition, reason: input.reason ?? null, reviewed_by: input.reviewedBy, reviewed_at: new Date() }).onConflictDoUpdate({ target: [analytics_duplicate_reviews.org_id, analytics_duplicate_reviews.candidate_key], set: { disposition: input.disposition, reason: input.reason ?? null, reviewed_by: input.reviewedBy, reviewed_at: new Date() } });
  });
}

export function isAnalyticsEvidencePartial(_total: number): boolean {
  return false;
}

/** Shared API/service rejection contract: no review survives changed or absent evidence. */
export function assertAnalyticsDuplicateReviewCurrent(
  current: Pick<AnalyticsDataQualityReport, "evidence" | "candidates">,
  input: Pick<z.infer<typeof analyticsDuplicateReviewSchema>, "candidateKey" | "evidenceVersion">,
): void {
  if (!current.evidence.complete) throw new HttpError("Duplicate review is unavailable until complete evidence is available", 409);
  if (current.evidence.version !== input.evidenceVersion) throw new HttpError("Analytics evidence changed; refresh before reviewing", 409);
  if (!current.candidates.some((candidate) => candidate.key === input.candidateKey)) throw new HttpError("Duplicate candidate is no longer present for this workspace", 409);
}

function evidenceFromMetricRow(row: { id: string; source: string; widgetKey: string; dimensions: Record<string, string | null>; rawRow: Record<string, string | null>; requestedAggregation: string; requestedDateRange: string }): AnalyticsEvidenceRow { const values = { ...row.dimensions, ...row.rawRow }; return { id: row.id, source: row.source, widgetKey: row.widgetKey, sourceId: valueFor(values, evidenceKeys.sourceId), isrc: valueFor(values, evidenceKeys.isrc), artist: valueFor(values, evidenceKeys.artist), title: valueFor(values, evidenceKeys.title), metricGrain: `${row.widgetKey}:${row.requestedAggregation}:${row.requestedDateRange}` }; }
function sourceSummaryKey(input: { source: string; widgetKey: string; requestedDateRange?: string | null; requestedAggregation?: string | null }): string { return `${input.source}:${input.widgetKey}:${input.requestedAggregation ?? ""}:${input.requestedDateRange ?? ""}`; }
function valueFor(values: Record<string, string | null>, names: readonly string[]): string | null { for (const [key, value] of Object.entries(values)) if (names.includes(key.toLowerCase().replace(/[^a-z0-9]+/g, "_"))) return clean(value); return null; }
function clean(value: string | null | undefined): string | null { const trimmed = value?.trim(); return trimmed || null; }
function normalise(value: string | null | undefined): string | null { const cleaned = clean(value); return cleaned ? cleaned.toLocaleLowerCase() : null; }
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const ISRC_SENTINELS = new Set(["-", "n/a", "na", "none", "null", "unknown", "not available", "tbd"]);
function normaliseIsrc(value: string | null | undefined): string | null { const original = clean(value); if (!original || ISRC_SENTINELS.has(original.toLowerCase())) return null; const compact = original.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(); return ISRC_PATTERN.test(compact) ? compact : null; }
function duplicateCandidateKey(reason: AnalyticsDuplicateReason, parts: readonly string[]): string { return `${reason}:${createHash("sha256").update(JSON.stringify([reason, ...parts])).digest("hex")}`; }
function dateOrNull(value: Date | string | null | undefined): Date | null { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function parseSourceDate(value: string | null): Date | null { if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null; return dateOrNull(value.slice(0, 10)); }
function isDisposition(value: string): value is Exclude<AnalyticsDuplicateDisposition, "unreviewed"> { return value === "keep_separate" || value === "link_same_record" || value === "source_error"; }
