import { and, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { analytics_import_files, analytics_import_runs, analytics_metric_rows, artists, releases, tracks } from "../db/schema";
import { db } from "../lib/db";
import { LEGACY_UNSCOPED_ANALYTICS_ENABLED } from "../lib/analytics-legacy-policy";
import { mapCanonicalDailySourceRows } from "../lib/analytics-canonical-sources";
import { mapCanonicalArtistPlaylistRows, mapCanonicalArtistShazamRows } from "../lib/analytics-artist-aux";
import { isAnalyticsIngestionStale, listAnalyticsDataQuality, type AnalyticsDataQualityReport } from "./analytics-data-quality";
import {
  buildAnalyticsCommandCenter,
  buildArtist360,
  buildReleaseCockpit,
  normalizeAnalyticsFilter,
  type AnalyticsCommandCenter,
  type AnalyticsCommandFilter,
  type Artist360Result,
  type BuildReleaseCockpitInput,
  type FilterOption,
  type ReleaseCockpit,
} from "./analytics-command-center-core";
import type { CommandDailySourceRow } from "./analytics-command-center-core";
import { SISENSE_TRACK_SOURCE, SISENSE_TRACK_WIDGET } from "./sisense-track-snapshot";

interface AnalyticsScopeFilter {
  artistId?: string | null;
  releaseId?: string | null;
  trackId?: string | null;
}

export interface AnalyticsWidgetSummary {
  widgetKey: string;
  rowCount: number;
  trackCount: number;
  lastSeenAt: Date | string | null;
}

export interface AnalyticsRecentRow {
  id: string;
  widgetKey: string;
  label: string;
  dimensionsPreview: string;
  metricsPreview: string;
  trackTitle: string | null;
  releaseTitle: string | null;
  lastSeenAt: Date | string | null;
}

export interface AnalyticsStreamTotals {
  combinedStreams: number;
  spotifyStreams: number;
  appleStreams: number;
  amazonStreams: number;
  pandoraStreams: number;
}

export interface AnalyticsTrackGrowthRow {
  id: string;
  trackTitle: string;
  primaryArtist: string | null;
  appTrackTitle: string | null;
  releaseTitle: string | null;
  combinedStreams: number;
  spotifyStreams: number;
  appleStreams: number;
  amazonStreams: number;
  pandoraStreams: number;
  streamsGrowth: number | null;
  youtubeViews: number;
  tiktokViews: number;
  combinedViews: number;
  viewsGrowth: number | null;
  lastSeenAt: Date | string | null;
}

export interface DatedTrackSnapshotRunQueryRow {
  orgId: string;
  artistId: string | null;
  runId: string;
  source: string;
  mode: string;
  status: string;
  widgetKey: string;
  storageStatus: string;
  fileId: string;
  fileName: string;
  sha256: string;
  fileRowCount: number | null;
  requestedDateRange: string | null;
  requestedAggregation: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  fileCreatedAt: Date | string | null;
  metadata: Record<string, unknown> | null;
}

export interface DatedTrackSnapshotMetricQueryRow {
  id: string;
  orgId: string;
  source: string;
  widgetKey: string;
  artistId: string | null;
  releaseId: string | null;
  trackId: string | null;
  rowKey: string;
  lastSeenRunId: string | null;
  dimensions: Record<string, string | null>;
  metrics: Record<string, string | number | null>;
  safeCombinedStreams: string | number | null;
  safeSpotifyStreams: string | number | null;
  safeAppleStreams: string | number | null;
  safeAmazonStreams: string | number | null;
  safePandoraStreams: string | number | null;
  safeYoutubeViews: string | number | null;
  safeTiktokViews: string | number | null;
  safeCombinedViews: string | number | null;
  lastSeenAt: Date | string | null;
  trackTitle: string | null;
  releaseTitle: string | null;
}

export interface DatedTrackSnapshotScopedQueries {
  listCompletedRunsWithLatestUploadedFile(input: {
    orgId: string;
    artistId: string;
    limit: number;
    offset: number;
  }): Promise<DatedTrackSnapshotRunQueryRow[]>;
  listMetricRowsForRun(input: {
    orgId: string;
    artistId: string;
    runId: string;
    limit: number;
    offset: number;
    releaseId?: string;
  }): Promise<DatedTrackSnapshotMetricQueryRow[]>;
  summarizeMetricRowsForRun(input: {
    orgId: string;
    artistId: string;
    runId: string;
    releaseId?: string;
  }): Promise<DatedTrackSnapshotMetricSummary>;
  listLegacyTrackRows(): Promise<DatedTrackSnapshotLegacyDisclosure>;
}

export interface DatedTrackSnapshotMetricSummary {
  uniqueTrackCount: number;
  cumulativeStreams: number;
  cumulativeViews: number | null;
}

export interface DatedTrackSnapshotQueryBoundary {
  forTenant<T>(
    orgId: string,
    work: (queries: DatedTrackSnapshotScopedQueries) => Promise<T>,
  ): Promise<T>;
}

export interface DatedTrackSnapshotHistoryEntry {
  runId: string;
  fileId: string;
  fileName: string;
  sha256: string;
  sha256Prefix: string;
  importedAt: Date | null;
  requestedDateRange: string;
  requestedAggregation: string;
  reportingFrom: string | null;
  reportingThrough: string | null;
  sourceRowCount: number | null;
  uniqueTrackCount: number | null;
  matchedCount: number | null;
  unmatchedCount: number | null;
  ambiguousCount: number | null;
  exactDuplicateCount: number | null;
}

export interface DatedTrackSnapshotRow extends Omit<
  AnalyticsTrackGrowthRow,
  | "spotifyStreams"
  | "appleStreams"
  | "amazonStreams"
  | "pandoraStreams"
  | "youtubeViews"
  | "tiktokViews"
  | "combinedViews"
> {
  rowKey: string;
  trackId: string | null;
  releaseId: string | null;
  spotifyStreams: number | null;
  appleStreams: number | null;
  amazonStreams: number | null;
  pandoraStreams: number | null;
  youtubeViews: number | null;
  tiktokViews: number | null;
  combinedViews: number | null;
}

export interface DatedTrackSnapshotLatest extends DatedTrackSnapshotHistoryEntry {
  uniqueTrackCount: number;
  cumulativeStreams: number;
  cumulativeViews: number | null;
  rows: DatedTrackSnapshotRow[];
  rowsPage: DatedTrackSnapshotRowsPage;
}

export interface DatedTrackSnapshotRowsPage {
  limit: number;
  offset: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
}

export interface DatedTrackSnapshotHistoryPage {
  limit: number;
  offset: number;
  returnedCount: number;
  hasMore: boolean;
}

export interface DatedTrackSnapshotReadOptions {
  rows?: { limit?: number; offset?: number };
  history?: { limit?: number; offset?: number };
  releaseId?: string;
}

export type DatedTrackSnapshotLegacyDisclosure =
  | {
      status: "unavailable";
      recordCount: null;
      rows: [];
    }
  | {
      status: "available";
      recordCount: number;
      rows: AnalyticsTrackGrowthRow[];
    };

export interface DatedTrackSnapshotWorkspace {
  latest: DatedTrackSnapshotLatest | null;
  history: DatedTrackSnapshotHistoryEntry[];
  historyPage: DatedTrackSnapshotHistoryPage;
  legacy: DatedTrackSnapshotLegacyDisclosure;
}

const DATED_TRACK_ROWS_DEFAULT_LIMIT = 100;
const DATED_TRACK_ROWS_MAX_LIMIT = 500;
const DATED_TRACK_HISTORY_DEFAULT_LIMIT = 25;
const DATED_TRACK_HISTORY_MAX_LIMIT = 100;

type AnalyticsTransaction = any;

const productionDatedTrackSnapshotBoundary: DatedTrackSnapshotQueryBoundary = {
  async forTenant<T>(
    orgId: string,
    work: (queries: DatedTrackSnapshotScopedQueries) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx: AnalyticsTransaction) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      return work(productionDatedTrackSnapshotQueries(tx));
    });
  },
};

export async function listDatedTrackSnapshotWorkspace(
  orgId: string,
  artistId: string,
  boundary: DatedTrackSnapshotQueryBoundary = productionDatedTrackSnapshotBoundary,
  options: DatedTrackSnapshotReadOptions = {},
): Promise<DatedTrackSnapshotWorkspace> {
  return readDatedTrackSnapshotWorkspace(orgId, artistId, boundary, true, options);
}

async function readDatedTrackSnapshotWorkspace(
  orgId: string,
  artistId: string,
  boundary: DatedTrackSnapshotQueryBoundary,
  includeLegacy: boolean,
  options: DatedTrackSnapshotReadOptions = {},
): Promise<DatedTrackSnapshotWorkspace> {
  return boundary.forTenant(orgId, async (queries) => {
    const rowsPage = normalizeDatedPage(
      options.rows,
      DATED_TRACK_ROWS_DEFAULT_LIMIT,
      DATED_TRACK_ROWS_MAX_LIMIT,
    );
    const historyPage = normalizeDatedPage(
      options.history,
      DATED_TRACK_HISTORY_DEFAULT_LIMIT,
      DATED_TRACK_HISTORY_MAX_LIMIT,
    );
    const candidateRuns = await queries.listCompletedRunsWithLatestUploadedFile({
      orgId,
      artistId,
      limit: historyPage.limit + 1,
      offset: historyPage.offset,
    });
    const eligibleHistory = eligibleDatedTrackRuns(candidateRuns, { orgId, artistId });
    const historyHasMore = eligibleHistory.length > historyPage.limit;
    const history = eligibleHistory
      .slice(0, historyPage.limit)
      .map(historyEntryFromQueryRow);
    const latestCandidates = historyPage.offset === 0
      ? eligibleHistory
      : eligibleDatedTrackRuns(
          await queries.listCompletedRunsWithLatestUploadedFile({
            orgId,
            artistId,
            limit: 1,
            offset: 0,
          }),
          { orgId, artistId },
        );
    const selected = latestCandidates[0]
      ? historyEntryFromQueryRow(latestCandidates[0])
      : null;
    const [legacy, metricSummary, metricRows] = await Promise.all([
      includeLegacy
        ? queries.listLegacyTrackRows()
        : Promise.resolve({ status: "unavailable" as const, recordCount: null, rows: [] as [] }),
      selected
        ? queries.summarizeMetricRowsForRun({
            orgId,
            artistId,
            runId: selected.runId,
            releaseId: options.releaseId,
          })
        : Promise.resolve({ uniqueTrackCount: 0, cumulativeStreams: 0, cumulativeViews: null }),
      selected
        ? queries.listMetricRowsForRun({
            orgId,
            artistId,
            runId: selected.runId,
            limit: rowsPage.limit,
            offset: rowsPage.offset,
            releaseId: options.releaseId,
          })
        : Promise.resolve([]),
    ]);
    const normalizedMetricSummary = isRecord(metricSummary)
      ? {
          uniqueTrackCount: safeNonNegativeInteger(metricSummary.uniqueTrackCount),
          cumulativeStreams: safeNonNegativeInteger(metricSummary.cumulativeStreams),
          cumulativeViews: safeOptionalNonNegativeInteger(metricSummary.cumulativeViews),
        }
      : { uniqueTrackCount: 0, cumulativeStreams: 0, cumulativeViews: null };
    const currentRows = selected
      ? currentDatedTrackRows(metricRows, {
          orgId,
          artistId,
          runId: selected.runId,
          releaseId: options.releaseId,
        })
      : [];

    return {
      latest: selected
        ? {
            ...selected,
            uniqueTrackCount: normalizedMetricSummary.uniqueTrackCount,
            cumulativeStreams: normalizedMetricSummary.cumulativeStreams,
            cumulativeViews: normalizedMetricSummary.cumulativeViews,
            rows: currentRows,
            rowsPage: {
              ...rowsPage,
              returnedCount: currentRows.length,
              totalCount: normalizedMetricSummary.uniqueTrackCount,
              hasMore: rowsPage.offset + currentRows.length < normalizedMetricSummary.uniqueTrackCount,
            },
          }
        : null,
      history,
      historyPage: {
        ...historyPage,
        returnedCount: history.length,
        hasMore: historyHasMore,
      },
      legacy,
    };
  });
}

function productionDatedTrackSnapshotQueries(
  tx: AnalyticsTransaction,
): DatedTrackSnapshotScopedQueries {
  return {
    async listCompletedRunsWithLatestUploadedFile({ orgId, artistId, limit, offset }) {
      const result = await tx.execute(sql`
        with "rankedUploadedFiles" as (
          select
            ${analytics_import_runs.org_id} as "orgId",
            ${analytics_import_runs.artist_id} as "artistId",
            ${analytics_import_runs.id} as "runId",
            ${analytics_import_runs.source} as "source",
            ${analytics_import_runs.mode} as "mode",
            ${analytics_import_runs.status} as "status",
            ${analytics_import_files.widget_key} as "widgetKey",
            ${analytics_import_files.storage_status} as "storageStatus",
            ${analytics_import_files.id} as "fileId",
            ${analytics_import_files.file_name} as "fileName",
            ${analytics_import_files.sha256} as "sha256",
            ${analytics_import_files.row_count} as "fileRowCount",
            ${analytics_import_runs.requested_date_range} as "requestedDateRange",
            ${analytics_import_runs.requested_aggregation} as "requestedAggregation",
            ${analytics_import_runs.started_at} as "startedAt",
            ${analytics_import_runs.completed_at} as "completedAt",
            ${analytics_import_files.created_at} as "fileCreatedAt",
            ${analytics_import_runs.metadata} as "metadata",
            row_number() over (
              partition by ${analytics_import_runs.id}
              order by ${analytics_import_files.created_at} desc nulls last, ${analytics_import_files.id} desc
            ) as "fileRank"
          from ${analytics_import_runs}
          inner join ${analytics_import_files} on
            ${analytics_import_files.org_id} = ${orgId}
            and ${analytics_import_files.run_id} = ${analytics_import_runs.id}
            and ${analytics_import_files.artist_id} = ${artistId}
            and ${analytics_import_files.source} = ${SISENSE_TRACK_SOURCE}
            and ${analytics_import_files.widget_key} = ${SISENSE_TRACK_WIDGET}
            and ${analytics_import_files.storage_status} = 'uploaded'
          where ${analytics_import_runs.org_id} = ${orgId}
            and ${analytics_import_runs.artist_id} = ${artistId}
            and ${analytics_import_runs.source} = ${SISENSE_TRACK_SOURCE}
            and ${analytics_import_runs.mode} = 'manual_import'
            and ${analytics_import_runs.status} = 'completed'
        )
        select
          "orgId",
          "artistId",
          "runId",
          "source",
          "mode",
          "status",
          "widgetKey",
          "storageStatus",
          "fileId",
          "fileName",
          "sha256",
          "fileRowCount",
          "requestedDateRange",
          "requestedAggregation",
          "startedAt",
          "completedAt",
          "fileCreatedAt",
          "metadata"
        from "rankedUploadedFiles"
        where "fileRank" = 1
        order by
          "completedAt" desc nulls last,
          "startedAt" desc nulls last,
          "runId" desc,
          "fileCreatedAt" desc nulls last,
          "fileId" desc
        limit ${limit}
        offset ${offset}
      `);
      return result.rows ?? [];
    },

    listMetricRowsForRun({ orgId, artistId, runId, limit, offset, releaseId }) {
      const safeCombinedStreams = safeDatedCombinedStreamsSql();
      const safeSpotifyStreams = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'spotify_streams'`,
        sql`${analytics_metric_rows.metrics}->>'spotify_streams'`,
      );
      const safeAppleStreams = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'apple_streams'`,
        sql`${analytics_metric_rows.metrics}->>'apple_streams'`,
      );
      const safeAmazonStreams = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'amazon_streams'`,
        sql`${analytics_metric_rows.metrics}->>'amazon_streams'`,
      );
      const safePandoraStreams = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'pandora_streams'`,
        sql`${analytics_metric_rows.metrics}->>'pandora_streams'`,
      );
      const safeYoutubeViews = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'youtube_views'`,
        sql`${analytics_metric_rows.metrics}->>'youtube_views'`,
      );
      const safeTiktokViews = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'tiktok_views'`,
        sql`${analytics_metric_rows.metrics}->>'tiktok_views'`,
      );
      const safeCombinedViews = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'combined_views'`,
        sql`${analytics_metric_rows.metrics}->>'combined_views'`,
      );
      return tx
        .select({
          id: analytics_metric_rows.id,
          orgId: analytics_metric_rows.org_id,
          source: analytics_metric_rows.source,
          widgetKey: analytics_metric_rows.widget_key,
          artistId: analytics_metric_rows.artist_id,
          releaseId: tracks.release_id,
          trackId: analytics_metric_rows.track_id,
          rowKey: analytics_metric_rows.row_key,
          lastSeenRunId: analytics_metric_rows.last_seen_run_id,
          dimensions: analytics_metric_rows.dimensions,
          metrics: analytics_metric_rows.metrics,
          safeCombinedStreams: sql<string>`${safeCombinedStreams}::text`,
          safeSpotifyStreams: sql<string | null>`${safeSpotifyStreams}::text`,
          safeAppleStreams: sql<string | null>`${safeAppleStreams}::text`,
          safeAmazonStreams: sql<string | null>`${safeAmazonStreams}::text`,
          safePandoraStreams: sql<string | null>`${safePandoraStreams}::text`,
          safeYoutubeViews: sql<string | null>`${safeYoutubeViews}::text`,
          safeTiktokViews: sql<string | null>`${safeTiktokViews}::text`,
          safeCombinedViews: sql<string | null>`${safeCombinedViews}::text`,
          lastSeenAt: analytics_metric_rows.last_seen_at,
          trackTitle: tracks.title,
          releaseTitle: releases.title,
        })
        .from(analytics_metric_rows)
        .leftJoin(tracks, and(
          eq(analytics_metric_rows.track_id, tracks.id),
          eq(tracks.org_id, orgId),
        ))
        .leftJoin(releases, and(
          eq(tracks.release_id, releases.id),
          eq(releases.org_id, orgId),
        ))
        .where(and(
          eq(analytics_metric_rows.org_id, orgId),
          eq(analytics_metric_rows.artist_id, artistId),
          eq(analytics_metric_rows.source, SISENSE_TRACK_SOURCE),
          eq(analytics_metric_rows.widget_key, SISENSE_TRACK_WIDGET),
          eq(analytics_metric_rows.last_seen_run_id, runId),
          ...(releaseId ? [eq(tracks.release_id, releaseId)] : []),
        ))
        .orderBy(
          desc(safeCombinedStreams),
          sql`${analytics_metric_rows.last_seen_at} desc nulls last`,
          analytics_metric_rows.id,
        )
        .limit(limit)
        .offset(offset);
    },

    async summarizeMetricRowsForRun({ orgId, artistId, runId, releaseId }) {
      const safeCombinedStreams = safeDatedCombinedStreamsSql();
      const safeCombinedViews = safeDatedOptionalCountSql(
        sql`${analytics_metric_rows.metrics}->'combined_views'`,
        sql`${analytics_metric_rows.metrics}->>'combined_views'`,
      );
      const baseQuery = tx
        .select({
          uniqueTrackCount: sql<string>`count(distinct ${analytics_metric_rows.row_key})::text`,
          cumulativeStreams: sql<string>`least(
            coalesce(sum(${safeCombinedStreams}), 0),
            ${Number.MAX_SAFE_INTEGER}
          )::text`,
          cumulativeViews: sql<string | null>`case
            when count(*) = 0 or count(${safeCombinedViews}) <> count(*) then null
            else least(
              coalesce(sum(${safeCombinedViews}), 0),
              ${Number.MAX_SAFE_INTEGER}
            )::text
          end`,
        })
        .from(analytics_metric_rows);
      const scopedQuery = releaseId
        ? baseQuery.leftJoin(tracks, and(
            eq(analytics_metric_rows.track_id, tracks.id),
            eq(tracks.org_id, orgId),
          ))
        : baseQuery;
      const rows = await scopedQuery
        .where(and(
          eq(analytics_metric_rows.org_id, orgId),
          eq(analytics_metric_rows.artist_id, artistId),
          eq(analytics_metric_rows.source, SISENSE_TRACK_SOURCE),
          eq(analytics_metric_rows.widget_key, SISENSE_TRACK_WIDGET),
          eq(analytics_metric_rows.last_seen_run_id, runId),
          ...(releaseId ? [eq(tracks.release_id, releaseId)] : []),
        ));
      return {
        uniqueTrackCount: safeNonNegativeInteger(rows[0]?.uniqueTrackCount),
        cumulativeStreams: safeNonNegativeInteger(rows[0]?.cumulativeStreams),
        cumulativeViews: safeOptionalNonNegativeInteger(rows[0]?.cumulativeViews),
      };
    },

    async listLegacyTrackRows() {
      if (!LEGACY_UNSCOPED_ANALYTICS_ENABLED) {
        return { status: "unavailable" as const, recordCount: null, rows: [] as [] };
      }
      const result = await tx.execute(sql`
        select
          count(*) over()::text as "recordCount",
          track_title as "trackTitle",
          primary_artist as "primaryArtist",
          spotify_streams as "spotifyStreams",
          apple_streams as "appleStreams",
          amazon_streams as "amazonStreams",
          pandora_streams as "pandoraStreams",
          combined_streams as "combinedStreams",
          streams_growth as "streamsGrowth",
          youtube_views as "youtubeViews",
          tiktok_views as "tiktokViews",
          combined_views as "combinedViews",
          views_growth as "viewsGrowth",
          last_seen_at as "lastSeenAt"
        from label_suite.track_totals
        order by combined_streams desc nulls last, track_title, primary_artist
        limit 100
      `);
      const rawRows = (result.rows ?? []) as DatedTrackSnapshotLegacyQueryRow[];
      return {
        status: "available" as const,
        recordCount: safeNonNegativeInteger(rawRows[0]?.recordCount),
        rows: rawRows.map(legacyTrackGrowthRow),
      };
    },
  };
}

function safeDatedCombinedStreamsSql(): SQL<number> {
  const jsonValue = sql`${analytics_metric_rows.metrics}->'combined_streams'`;
  const textValue = sql`${analytics_metric_rows.metrics}->>'combined_streams'`;
  const normalizedDigits = sql`coalesce(
    nullif(regexp_replace(${textValue}, '^0+', ''), ''),
    '0'
  )`;
  return sql<number>`case jsonb_typeof(${jsonValue})
    when 'string' then case
      when ${textValue} ~ '^[0-9]+$' then case
        when length(${normalizedDigits}) < 16
          or (
            length(${normalizedDigits}) = 16
            and ${normalizedDigits} <= '9007199254740991'
          )
          then (${normalizedDigits})::numeric
        else 0
      end
      else 0
    end
    when 'number' then case
      when (${jsonValue})::numeric >= 0
        and trunc((${jsonValue})::numeric) = (${jsonValue})::numeric
        and (${jsonValue})::numeric <= ${Number.MAX_SAFE_INTEGER}
        then (${jsonValue})::numeric
      else 0
    end
    else 0
  end`;
}

function safeDatedOptionalCountSql(jsonValue: SQL, textValue: SQL): SQL<number | null> {
  const normalizedDigits = sql`coalesce(
    nullif(regexp_replace(${textValue}, '^0+', ''), ''),
    '0'
  )`;
  return sql<number | null>`case jsonb_typeof(${jsonValue})
    when 'string' then case
      when ${textValue} ~ '^[0-9]+$' then case
        when length(${normalizedDigits}) < 16
          or (
            length(${normalizedDigits}) = 16
            and ${normalizedDigits} <= '9007199254740991'
          )
          then (${normalizedDigits})::numeric
        else null
      end
      else null
    end
    when 'number' then case
      when (${jsonValue})::numeric >= 0
        and trunc((${jsonValue})::numeric) = (${jsonValue})::numeric
        and (${jsonValue})::numeric <= ${Number.MAX_SAFE_INTEGER}
        then (${jsonValue})::numeric
      else null
    end
    else null
  end`;
}

interface DatedTrackSnapshotLegacyQueryRow {
  recordCount: string | number | null;
  trackTitle: string;
  primaryArtist: string | null;
  spotifyStreams: string | number | null;
  appleStreams: string | number | null;
  amazonStreams: string | number | null;
  pandoraStreams: string | number | null;
  combinedStreams: string | number | null;
  streamsGrowth: string | number | null;
  youtubeViews: string | number | null;
  tiktokViews: string | number | null;
  combinedViews: string | number | null;
  viewsGrowth: string | number | null;
  lastSeenAt: Date | string | null;
}

function legacyTrackGrowthRow(row: DatedTrackSnapshotLegacyQueryRow): AnalyticsTrackGrowthRow {
  return {
    id: `csv-${slugify(row.trackTitle)}-${slugify(row.primaryArtist ?? "unknown")}`,
    trackTitle: row.trackTitle,
    primaryArtist: row.primaryArtist,
    appTrackTitle: null,
    releaseTitle: null,
    combinedStreams: safeCountValue(row.combinedStreams),
    spotifyStreams: safeCountValue(row.spotifyStreams),
    appleStreams: safeCountValue(row.appleStreams),
    amazonStreams: safeCountValue(row.amazonStreams),
    pandoraStreams: safeCountValue(row.pandoraStreams),
    streamsGrowth: safeNullableNumber(row.streamsGrowth),
    youtubeViews: safeCountValue(row.youtubeViews),
    tiktokViews: safeCountValue(row.tiktokViews),
    combinedViews: safeCountValue(row.combinedViews),
    viewsGrowth: safeNullableNumber(row.viewsGrowth),
    lastSeenAt: toDate(row.lastSeenAt),
  };
}

function normalizeDatedPage(
  page: { limit?: number; offset?: number } | undefined,
  defaultLimit: number,
  maximumLimit: number,
): { limit: number; offset: number } {
  const requestedLimit = safeNonNegativeInteger(page?.limit);
  const requestedOffset = safeNonNegativeInteger(page?.offset);
  return {
    limit: Math.min(requestedLimit || defaultLimit, maximumLimit),
    offset: requestedOffset,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableDateValue(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}

function normalizeDatedTrackRunQueryRow(value: unknown): DatedTrackSnapshotRunQueryRow | null {
  if (!isRecord(value)
    || typeof value.orgId !== "string"
    || typeof value.artistId !== "string"
    || typeof value.runId !== "string"
    || typeof value.source !== "string"
    || typeof value.mode !== "string"
    || typeof value.status !== "string"
    || typeof value.widgetKey !== "string"
    || typeof value.storageStatus !== "string"
    || typeof value.fileId !== "string"
    || typeof value.fileName !== "string"
    || typeof value.sha256 !== "string") {
    return null;
  }
  return {
    orgId: value.orgId,
    artistId: value.artistId,
    runId: value.runId,
    source: value.source,
    mode: value.mode,
    status: value.status,
    widgetKey: value.widgetKey,
    storageStatus: value.storageStatus,
    fileId: value.fileId,
    fileName: value.fileName,
    sha256: value.sha256,
    fileRowCount: typeof value.fileRowCount === "number" ? value.fileRowCount : null,
    requestedDateRange: typeof value.requestedDateRange === "string" ? value.requestedDateRange : null,
    requestedAggregation: typeof value.requestedAggregation === "string" ? value.requestedAggregation : null,
    startedAt: nullableDateValue(value.startedAt),
    completedAt: nullableDateValue(value.completedAt),
    fileCreatedAt: nullableDateValue(value.fileCreatedAt),
    metadata: isRecord(value.metadata) ? value.metadata : null,
  };
}

function eligibleDatedTrackRuns(
  rows: readonly unknown[],
  scope: { orgId: string; artistId: string },
): DatedTrackSnapshotRunQueryRow[] {
  return rows
    .map(normalizeDatedTrackRunQueryRow)
    .filter((row): row is DatedTrackSnapshotRunQueryRow => row !== null)
    .filter((row) => (
      row.orgId === scope.orgId
      && row.artistId === scope.artistId
      && row.source === SISENSE_TRACK_SOURCE
      && row.mode === "manual_import"
      && row.status === "completed"
      && row.widgetKey === SISENSE_TRACK_WIDGET
      && row.storageStatus === "uploaded"
    ))
    .sort(compareDatedTrackSnapshotRuns)
    .filter((row, index, candidates) => (
      candidates.findIndex((candidate) => candidate.runId === row.runId) === index
    ));
}

function compareDatedTrackSnapshotRuns(
  left: DatedTrackSnapshotRunQueryRow,
  right: DatedTrackSnapshotRunQueryRow,
): number {
  return compareDateDesc(left.completedAt, right.completedAt)
    || compareDateDesc(left.startedAt, right.startedAt)
    || compareTextDesc(left.runId, right.runId)
    || compareDateDesc(left.fileCreatedAt, right.fileCreatedAt)
    || compareTextDesc(left.fileId, right.fileId);
}

function compareTextDesc(left: string, right: string): number {
  return left === right ? 0 : left < right ? 1 : -1;
}

function compareDateDesc(left: Date | string | null, right: Date | string | null): number {
  return datedTimestamp(right) - datedTimestamp(left);
}

function datedTimestamp(value: Date | string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function historyEntryFromQueryRow(row: DatedTrackSnapshotRunQueryRow): DatedTrackSnapshotHistoryEntry {
  const counts = row.metadata?.counts;
  const countRecord = counts && typeof counts === "object"
    ? counts as Record<string, unknown>
    : {};
  return {
    runId: row.runId,
    fileId: row.fileId,
    fileName: row.fileName,
    sha256: row.sha256,
    sha256Prefix: row.sha256.slice(0, 12),
    importedAt: toDate(row.completedAt ?? row.startedAt),
    requestedDateRange: row.requestedDateRange ?? "",
    requestedAggregation: row.requestedAggregation ?? "",
    reportingFrom: safeReportingDateMetadata(row.metadata, "reporting_from"),
    reportingThrough: safeReportingDateMetadata(row.metadata, "reporting_through"),
    sourceRowCount: safeOptionalNonNegativeInteger(row.fileRowCount),
    uniqueTrackCount: safeOptionalNonNegativeInteger(countRecord.uniqueTracks),
    matchedCount: safeOptionalNonNegativeInteger(countRecord.matched),
    unmatchedCount: safeOptionalNonNegativeInteger(countRecord.unmatched),
    ambiguousCount: safeOptionalNonNegativeInteger(countRecord.ambiguous),
    exactDuplicateCount: safeOptionalNonNegativeInteger(countRecord.exactDuplicates),
  };
}

function safeReportingDateMetadata(
  metadata: Record<string, unknown> | null,
  key: "reporting_from" | "reporting_through",
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeOptionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function currentDatedTrackRows(
  rows: readonly unknown[],
  scope: { orgId: string; artistId: string; runId: string; releaseId?: string },
): DatedTrackSnapshotRow[] {
  const seenRowKeys = new Set<string>();
  return rows
    .map(normalizeDatedTrackMetricQueryRow)
    .filter((row): row is DatedTrackSnapshotMetricQueryRow => row !== null)
    .filter((row) => {
      const inScope = row.orgId === scope.orgId
        && row.artistId === scope.artistId
        && row.source === SISENSE_TRACK_SOURCE
        && row.widgetKey === SISENSE_TRACK_WIDGET
        && row.lastSeenRunId === scope.runId
        && (!scope.releaseId || row.releaseId === scope.releaseId)
        && row.rowKey.length > 0;
      if (!inScope || seenRowKeys.has(row.rowKey)) return false;
      seenRowKeys.add(row.rowKey);
      return true;
    })
    .map((row) => {
      return {
        id: row.id,
        rowKey: row.rowKey,
        trackId: row.trackId,
        releaseId: row.releaseId,
        trackTitle: row.dimensions.track_title ?? row.trackTitle ?? "Untitled track",
        primaryArtist: row.dimensions.primary_artist ?? null,
        appTrackTitle: row.trackTitle,
        releaseTitle: row.releaseTitle ?? row.dimensions.release_title,
        combinedStreams: safeProjectedDatedCount(row.safeCombinedStreams),
        spotifyStreams: safeProjectedOptionalDatedCount(row.safeSpotifyStreams),
        appleStreams: safeProjectedOptionalDatedCount(row.safeAppleStreams),
        amazonStreams: safeProjectedOptionalDatedCount(row.safeAmazonStreams),
        pandoraStreams: safeProjectedOptionalDatedCount(row.safePandoraStreams),
        streamsGrowth: nullableNumberMetric(row.metrics, "streams_growth"),
        youtubeViews: safeProjectedOptionalDatedCount(row.safeYoutubeViews),
        tiktokViews: safeProjectedOptionalDatedCount(row.safeTiktokViews),
        combinedViews: safeProjectedOptionalDatedCount(row.safeCombinedViews),
        viewsGrowth: nullableNumberMetric(row.metrics, "views_growth"),
        lastSeenAt: toDate(row.lastSeenAt),
      };
    })
    .sort((left, right) => (
      right.combinedStreams - left.combinedStreams
      || compareDateDesc(left.lastSeenAt, right.lastSeenAt)
      || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
    ));
}

function normalizeDatedTrackMetricQueryRow(value: unknown): DatedTrackSnapshotMetricQueryRow | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.orgId !== "string"
    || typeof value.source !== "string"
    || typeof value.widgetKey !== "string"
    || typeof value.artistId !== "string"
    || typeof value.rowKey !== "string"
    || typeof value.lastSeenRunId !== "string") {
    return null;
  }
  const dimensions = isRecord(value.dimensions)
    ? Object.fromEntries(Object.entries(value.dimensions).filter(([, item]) => (
        typeof item === "string" || item === null
      ))) as Record<string, string | null>
    : {};
  const metrics = isRecord(value.metrics)
    ? Object.fromEntries(Object.entries(value.metrics).filter(([, item]) => (
        typeof item === "string" || typeof item === "number" || item === null
      ))) as Record<string, string | number | null>
    : {};
  return {
    id: value.id,
    orgId: value.orgId,
    source: value.source,
    widgetKey: value.widgetKey,
    artistId: value.artistId,
    releaseId: typeof value.releaseId === "string" ? value.releaseId : null,
    trackId: typeof value.trackId === "string" ? value.trackId : null,
    rowKey: value.rowKey,
    lastSeenRunId: value.lastSeenRunId,
    dimensions,
    metrics,
    safeCombinedStreams: typeof value.safeCombinedStreams === "string"
      || typeof value.safeCombinedStreams === "number"
      ? value.safeCombinedStreams
      : null,
    safeSpotifyStreams: projectedDatedCountValue(value.safeSpotifyStreams),
    safeAppleStreams: projectedDatedCountValue(value.safeAppleStreams),
    safeAmazonStreams: projectedDatedCountValue(value.safeAmazonStreams),
    safePandoraStreams: projectedDatedCountValue(value.safePandoraStreams),
    safeYoutubeViews: projectedDatedCountValue(value.safeYoutubeViews),
    safeTiktokViews: projectedDatedCountValue(value.safeTiktokViews),
    safeCombinedViews: projectedDatedCountValue(value.safeCombinedViews),
    lastSeenAt: nullableDateValue(value.lastSeenAt),
    trackTitle: typeof value.trackTitle === "string" ? value.trackTitle : null,
    releaseTitle: typeof value.releaseTitle === "string" ? value.releaseTitle : null,
  };
}

function safeProjectedDatedCount(value: string | number | null): number {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  if (typeof value !== "string" || !/^[0-9]+(?:\.0+)?$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function projectedDatedCountValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function safeProjectedOptionalDatedCount(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (!/^[0-9]+(?:\.0+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeCountValue(value: string | number | null | undefined): number {
  const parsed = safeNullableNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeNullableNumber(value: string | number | null | undefined): number | null {
  return nullableNumberMetric({ value: value ?? null }, "value");
}

export interface AnalyticsTrackGrowthRangeSummary {
  rangeLabel: string;
  aggregationLabel: string;
  rowCount: number;
  lastSeenAt: Date | string | null;
  streamTotals: AnalyticsStreamTotals;
}

export interface AnalyticsTracksByGrowthSummary {
  widgetKey: "tracks-by-growth-rate";
  rangeLabel: string | null;
  aggregationLabel: string | null;
  lastSeenAt: Date | string | null;
  streamTotals: AnalyticsStreamTotals;
  availableRanges: AnalyticsTrackGrowthRangeSummary[];
  rows: AnalyticsTrackGrowthRow[];
}

export interface AnalyticsSummaryResult {
  totalRows: number;
  totalWidgets: number;
  totalLinkedTracks: number;
  lastSeenAt: Date | string | null;
  streamTotals: AnalyticsStreamTotals;
  tracksByGrowth: AnalyticsTracksByGrowthSummary | null;
  widgets: AnalyticsWidgetSummary[];
  recentRows: AnalyticsRecentRow[];
}

export async function listAnalyticsSummary(
  orgId: string,
  scope: AnalyticsScopeFilter,
  limit = 16,
): Promise<AnalyticsSummaryResult> {
  const conditions: SQL[] = [eq(analytics_metric_rows.org_id, orgId)];
  if (scope.artistId) conditions.push(eq(analytics_metric_rows.artist_id, scope.artistId));
  if (scope.releaseId) conditions.push(eq(analytics_metric_rows.release_id, scope.releaseId));
  if (scope.trackId) conditions.push(eq(analytics_metric_rows.track_id, scope.trackId));

  if (conditions.length === 1) {
    return emptyAnalyticsSummary();
  }

  const where = and(...conditions);
  const widgetRows = await db
    .select({
      widgetKey: analytics_metric_rows.widget_key,
      rowCount: sql<string>`count(*)`,
      trackCount: sql<string>`count(distinct ${analytics_metric_rows.track_id}) filter (where ${analytics_metric_rows.track_id} is not null)`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
    })
    .from(analytics_metric_rows)
    .where(where)
    .groupBy(analytics_metric_rows.widget_key)
    .orderBy(analytics_metric_rows.widget_key);

  const totalRows = await db
    .select({
      rowCount: sql<string>`count(*)`,
      trackCount: sql<string>`count(distinct ${analytics_metric_rows.track_id}) filter (where ${analytics_metric_rows.track_id} is not null)`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
    })
    .from(analytics_metric_rows)
    .where(where);

  const trackGrowthRangeRows = await db
    .select({
      requestedDateRange: analytics_metric_rows.requested_date_range,
      requestedAggregation: analytics_metric_rows.requested_aggregation,
      rowCount: sql<string>`count(*)`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
      combinedStreams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'combined_streams', '')::numeric), 0)`,
      spotifyStreams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'spotify_streams', '')::numeric), 0)`,
      appleStreams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'apple_streams', '')::numeric), 0)`,
      amazonStreams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'amazon_streams', '')::numeric), 0)`,
      pandoraStreams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'pandora_streams', '')::numeric), 0)`,
    })
    .from(analytics_metric_rows)
    .where(and(where, eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate")))
    .groupBy(analytics_metric_rows.requested_date_range, analytics_metric_rows.requested_aggregation)
    .orderBy(desc(sql<Date>`max(${analytics_metric_rows.last_seen_at})`));

  const trackGrowthRanges = trackGrowthRangeRows.map((row) => ({
    rangeLabel: row.requestedDateRange,
    aggregationLabel: row.requestedAggregation,
    rowCount: Number(row.rowCount),
    lastSeenAt: toDate(row.lastSeenAt),
    streamTotals: {
      combinedStreams: Number(row.combinedStreams ?? 0),
      spotifyStreams: Number(row.spotifyStreams ?? 0),
      appleStreams: Number(row.appleStreams ?? 0),
      amazonStreams: Number(row.amazonStreams ?? 0),
      pandoraStreams: Number(row.pandoraStreams ?? 0),
    },
  }));
  const selectedTrackGrowthRange = pickPrimaryTrackGrowthRange(trackGrowthRanges);

  const trackGrowthRows = selectedTrackGrowthRange
    ? await db
        .select({
          id: analytics_metric_rows.id,
          dimensions: analytics_metric_rows.dimensions,
          metrics: analytics_metric_rows.metrics,
          lastSeenAt: analytics_metric_rows.last_seen_at,
          requestedDateRange: analytics_metric_rows.requested_date_range,
          requestedAggregation: analytics_metric_rows.requested_aggregation,
          trackTitle: tracks.title,
          releaseTitle: releases.title,
        })
        .from(analytics_metric_rows)
        .leftJoin(tracks, and(eq(analytics_metric_rows.track_id, tracks.id), eq(tracks.org_id, orgId)))
        .leftJoin(releases, and(eq(analytics_metric_rows.release_id, releases.id), eq(releases.org_id, orgId)))
        .where(and(
          where,
          eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate"),
          eq(analytics_metric_rows.requested_aggregation, selectedTrackGrowthRange.aggregationLabel),
          eq(analytics_metric_rows.requested_date_range, selectedTrackGrowthRange.rangeLabel),
        ))
        .orderBy(
          desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'combined_streams', '')::numeric`),
          desc(analytics_metric_rows.last_seen_at),
        )
        .limit(10)
    : [];

  const rows = await db
    .select({
      id: analytics_metric_rows.id,
      widgetKey: analytics_metric_rows.widget_key,
      dimensions: analytics_metric_rows.dimensions,
      metrics: analytics_metric_rows.metrics,
      lastSeenAt: analytics_metric_rows.last_seen_at,
      trackTitle: tracks.title,
      releaseTitle: releases.title,
    })
    .from(analytics_metric_rows)
    .leftJoin(tracks, and(eq(analytics_metric_rows.track_id, tracks.id), eq(tracks.org_id, orgId)))
    .leftJoin(releases, and(eq(analytics_metric_rows.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(where)
    .orderBy(desc(analytics_metric_rows.last_seen_at))
    .limit(limit);

  const widgets = widgetRows.map((row) => ({
    widgetKey: row.widgetKey,
    rowCount: Number(row.rowCount),
    trackCount: Number(row.trackCount),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
  const totals = totalRows[0];
  const streamTotals = selectedTrackGrowthRange?.streamTotals ?? emptyStreamTotals();
  const tracksByGrowth = trackGrowthRows.length
    ? {
        widgetKey: "tracks-by-growth-rate" as const,
        rangeLabel: selectedTrackGrowthRange?.rangeLabel ?? firstValue(trackGrowthRows.map((row) => row.requestedDateRange)),
        aggregationLabel: selectedTrackGrowthRange?.aggregationLabel ?? firstValue(trackGrowthRows.map((row) => row.requestedAggregation)),
        lastSeenAt: maxDate(trackGrowthRows.map((row) => toDate(row.lastSeenAt))),
        streamTotals,
        availableRanges: trackGrowthRanges,
        rows: trackGrowthRows.map((row) => ({
          id: row.id,
          trackTitle: row.dimensions.track_title ?? row.trackTitle ?? "Untitled track",
          primaryArtist: row.dimensions.primary_artist ?? null,
          appTrackTitle: row.trackTitle,
          releaseTitle: row.releaseTitle,
          combinedStreams: numberMetric(row.metrics, "combined_streams"),
          spotifyStreams: numberMetric(row.metrics, "spotify_streams"),
          appleStreams: numberMetric(row.metrics, "apple_streams"),
          amazonStreams: numberMetric(row.metrics, "amazon_streams"),
          pandoraStreams: numberMetric(row.metrics, "pandora_streams"),
          streamsGrowth: nullableNumberMetric(row.metrics, "streams_growth"),
          youtubeViews: numberMetric(row.metrics, "youtube_views"),
          tiktokViews: numberMetric(row.metrics, "tiktok_views"),
          combinedViews: numberMetric(row.metrics, "combined_views"),
          viewsGrowth: nullableNumberMetric(row.metrics, "views_growth"),
          lastSeenAt: toDate(row.lastSeenAt),
        })),
      }
    : null;
  const recentRows = rows.map((row) => ({
    id: row.id,
    widgetKey: row.widgetKey,
    label: row.trackTitle ?? row.releaseTitle ?? firstDimensionLabel(row.dimensions) ?? widgetTitle(row.widgetKey),
    dimensionsPreview: previewRecord(row.dimensions, 3),
    metricsPreview: previewRecord(row.metrics, 3),
    trackTitle: row.trackTitle,
    releaseTitle: row.releaseTitle,
    lastSeenAt: toDate(row.lastSeenAt),
  }));

  return {
    totalRows: Number(totals?.rowCount ?? 0),
    totalWidgets: widgets.length,
    totalLinkedTracks: Number(totals?.trackCount ?? 0),
    lastSeenAt: toDate(totals?.lastSeenAt) ?? maxDate(widgets.map((widget) => toDate(widget.lastSeenAt))),
    streamTotals,
    tracksByGrowth,
    widgets,
    recentRows,
  };
}

export function widgetTitle(widgetKey: string): string {
  const titles: Record<string, string> = {
    "tracks-by-growth-rate": "Tracks by Growth",
    "spotify-superfans-active-streams-city": "Spotify Cities",
    "spotify-demographics-passion-indicators": "Spotify Demographics",
    "spotify-streams-source": "Spotify Sources",
    "apple-streams-source": "Apple Sources",
    "spotify-playlist-listings": "Spotify Playlists",
    "shazams-city": "Shazams by City",
    "passion-indicator-benchmarks-genre": "Genre Benchmarks",
  };
  if (titles[widgetKey]) return titles[widgetKey];

  return widgetKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function emptyAnalyticsSummary(): AnalyticsSummaryResult {
  return {
    totalRows: 0,
    totalWidgets: 0,
    totalLinkedTracks: 0,
    lastSeenAt: null,
    streamTotals: emptyStreamTotals(),
    tracksByGrowth: null,
    widgets: [],
    recentRows: [],
  };
}

function emptyStreamTotals(): AnalyticsStreamTotals {
  return {
    combinedStreams: 0,
    spotifyStreams: 0,
    appleStreams: 0,
    amazonStreams: 0,
    pandoraStreams: 0,
  };
}

function pickPrimaryTrackGrowthRange(ranges: AnalyticsTrackGrowthRangeSummary[]): AnalyticsTrackGrowthRangeSummary | null {
  return ranges.find((range) => isRecentDailyRange(range)) ?? ranges[0] ?? null;
}

function isRecentDailyRange(range: AnalyticsTrackGrowthRangeSummary): boolean {
  const rangeLabel = range.rangeLabel.trim().toLowerCase();
  const aggregationLabel = range.aggregationLabel.trim().toLowerCase();
  return aggregationLabel === "daily" && ["1 day", "last day", "24 hours", "yesterday"].includes(rangeLabel);
}

function firstValue(values: Array<string | null>): string | null {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function maxDate(values: Array<Date | null>): Date | null {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstDimensionLabel(dimensions: Record<string, string | null>): string | null {
  for (const key of ["track_title", "primary_artist", "city", "playlist__name", "source", "source_of_stream", "genre"]) {
    const value = dimensions[key];
    if (value) return value;
  }
  return null;
}

function previewRecord(record: Record<string, string | number | null>, limit: number): string {
  const values = Object.entries(record)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, limit)
    .map(([key, value]) => `${humanize(key)}: ${formatValue(value)}`);
  return values.join(" · ");
}

function numberMetric(record: Record<string, string | number | null>, key: string): number {
  return nullableNumberMetric(record, key) ?? 0;
}

function nullableNumberMetric(record: Record<string, string | number | null>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function humanize(value: string): string {
  return value
    .replace(/^_+/, "")
    .replace(/__+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: string | number | null): string {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value ?? "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "row";
}

const OPTIONAL_ANALYTICS_RELATIONS = [
  "daily_source_mix",
  "monthly_source_mix",
  "track_totals",
  "geo_superfans",
  "demographics",
  "top_playlists",
  "shazams_city",
] as const;

// These legacy materialized views predate tenant ownership and cannot be safely
// filtered by org_id. Keep the path disabled for authenticated tenant reads until
// an ownership-backed migration exists; canonical analytics_metric_rows remains active.

function isOptionalAnalyticsRelationMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const err = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const errorCode = err.code ?? err.cause?.code;
  const errorMessage = (err.message ?? err.cause?.message ?? "").toLowerCase();

  return (
    errorCode === "42P01" &&
    OPTIONAL_ANALYTICS_RELATIONS.some((relation) => errorMessage.includes(relation))
  );
}

async function executeOptionalAnalyticsQuery<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  if (!LEGACY_UNSCOPED_ANALYTICS_ENABLED) return [];
  try {
    const result = await db.execute<T>(query);
    return (result.rows ?? []) as T[];
  } catch (error) {
    if (isOptionalAnalyticsRelationMissing(error)) {
      return [];
    }
    throw error;
  }
}

// ─── Standalone /analytics page helpers ───────────────────────────────

export interface AnalyticsTotalsResult {
  totalRows: number;
  totalWidgets: number;
  totalLinkedTracks: number;
  lastSeenAt: Date | null;
  widgets: {
    widgetKey: string;
    rowCount: number;
    trackCount: number;
    lastSeenAt: Date | null;
  }[];
}

export async function listAnalyticsTotals(orgId: string): Promise<AnalyticsTotalsResult> {
  const [widgetRows, csvRows] = await Promise.all([
    db
      .select({
        widgetKey: analytics_metric_rows.widget_key,
        rowCount: sql<string>`count(*)`,
        trackCount: sql<string>`count(distinct ${analytics_metric_rows.track_id}) filter (where ${analytics_metric_rows.track_id} is not null)`,
        lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
      })
      .from(analytics_metric_rows)
      .where(eq(analytics_metric_rows.org_id, orgId))
      .groupBy(analytics_metric_rows.widget_key)
      .orderBy(analytics_metric_rows.widget_key),
    executeOptionalAnalyticsQuery<{
      widgetKey: string;
      rowCount: string;
      trackCount: string;
      lastSeenAt: Date | string | null;
    }>(sql`
      select * from (
        select 'csv-track-totals'::text as "widgetKey", count(*)::text as "rowCount", count(*)::text as "trackCount", max(last_seen_at)::timestamptz as "lastSeenAt" from label_suite.track_totals
        union all select 'csv-daily-source-mix', count(*)::text, '0'::text, max(date)::timestamptz from label_suite.daily_source_mix
        union all select 'csv-geo-superfans', count(*)::text, '0'::text, null::timestamptz from label_suite.geo_superfans
        union all select 'csv-demographics', count(*)::text, '0'::text, max(last_seen_at)::timestamptz from label_suite.demographics
        union all select 'csv-playlists', count(*)::text, '0'::text, max(last_seen_at)::timestamptz from label_suite.top_playlists
        union all select 'csv-shazams-city', count(*)::text, '0'::text, max(last_seen_at)::timestamptz from label_suite.shazams_city
      ) csv
      where "rowCount"::int > 0
      order by "widgetKey"
    `),
  ]);
  const widgets = [
    ...csvRows.map((r) => ({
      widgetKey: r.widgetKey,
      rowCount: Number(r.rowCount),
      trackCount: Number(r.trackCount),
      lastSeenAt: toDate(r.lastSeenAt),
    })),
    ...widgetRows.map((r) => ({
      widgetKey: r.widgetKey,
      rowCount: Number(r.rowCount),
      trackCount: Number(r.trackCount),
      lastSeenAt: toDate(r.lastSeenAt),
    })),
  ];

  return {
    totalRows: widgets.reduce((sum, row) => sum + row.rowCount, 0),
    totalWidgets: widgets.length,
    totalLinkedTracks: widgets.reduce((sum, row) => sum + row.trackCount, 0),
    lastSeenAt: maxDate(widgets.map((row) => row.lastSeenAt)),
    widgets,
  };
}

export async function listAnalyticsCommandCenter(
  orgId: string,
  filter?: AnalyticsCommandFilter,
): Promise<AnalyticsCommandCenter> {
  const availableArtists = await listCommandCenterArtists(orgId);
  const availableReleases = await listCommandCenterReleases(orgId, filter?.artistId);
  const effectiveFilter = normalizeAnalyticsFilter(filter, availableReleases.map((release) => release.id));

  const platformFilter = effectiveFilter?.platforms?.length
    ? sql`and platform = ANY(${effectiveFilter.platforms})`
    : sql``;

  const legacyDailySources = await executeOptionalAnalyticsQuery<{
    date: string | Date;
    platform: string | null;
    source: string | null;
    streams: string | number | null;
  }>(sql`
    select date, platform, source, streams
    from label_suite.daily_source_mix
    where 1=1 ${platformFilter}
    order by date, platform, source
  `);
  const dailySources = legacyDailySources.length
    ? legacyDailySources
    : await listCanonicalDailySources(orgId, effectiveFilter);

  const [
    totals,
    tracksByGrowth,
    cities,
    playlists,
    shazams,
    runHistory,
  ] = await Promise.all([
    listAnalyticsTotals(orgId),
    listFilteredTracksByGrowth(orgId, 100, effectiveFilter),
    listAnalyticsCities(orgId, 100),
    listAnalyticsWidgetRows(orgId, "spotify-playlist-listings", 100),
    listAnalyticsWidgetRows(orgId, "shazams-city", 50),
    listAnalyticsRunHistory(orgId, 30),
  ]);

  return buildAnalyticsCommandCenter({
    dailySources,
    tracks: tracksByGrowth,
    cities,
    playlists,
    shazams,
    widgets: totals.widgets,
    runHistory,
    totalRows: totals.totalRows,
    totalWidgets: totals.totalWidgets,
    totalLinkedTracks: totals.totalLinkedTracks,
    lastSeenAt: totals.lastSeenAt,
    filter: effectiveFilter,
    availableArtists,
    availableReleases,
  });
}

async function listCanonicalDailySources(
  orgId: string,
  filter?: AnalyticsCommandFilter,
): Promise<CommandDailySourceRow[]> {
  const dayExpr = sql<string>`coalesce(
    ${analytics_metric_rows.dimensions}->>'_col0',
    ${analytics_metric_rows.dimensions}->>'date',
    ${analytics_metric_rows.dimensions}->>'day')`;
  const sourceExpr = sql<string | null>`coalesce(
    ${analytics_metric_rows.dimensions}->>'source',
    ${analytics_metric_rows.dimensions}->>'source_of_stream')`;
  const conditions: SQL[] = [
    eq(analytics_metric_rows.org_id, orgId),
    inArray(analytics_metric_rows.widget_key, ["spotify-streams-source", "apple-streams-source"]),
    sql`${dayExpr} is not null`,
    sql`nullif(${analytics_metric_rows.metrics}->>'streams', '') is not null`,
  ];
  if (filter?.artistId) conditions.push(eq(analytics_metric_rows.artist_id, filter.artistId));
  if (filter?.releaseId) conditions.push(eq(analytics_metric_rows.release_id, filter.releaseId));
  if (filter?.platforms?.length) {
    const platformWidgets = filter.platforms.map((platform) => platform === "apple" ? "apple-streams-source" : "spotify-streams-source");
    conditions.push(inArray(analytics_metric_rows.widget_key, platformWidgets));
  }

  const rows = await db
    .select({
      date: dayExpr,
      widgetKey: analytics_metric_rows.widget_key,
      source: sourceExpr,
      streams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
    })
    .from(analytics_metric_rows)
    .where(and(...conditions))
    .groupBy(dayExpr, analytics_metric_rows.widget_key, sourceExpr)
    .orderBy(dayExpr, analytics_metric_rows.widget_key, sourceExpr);
  return mapCanonicalDailySourceRows(rows);
}

export async function listFilteredTracksByGrowth(
  orgId: string,
  limit: number,
  filter?: AnalyticsCommandFilter,
  datedBoundary: DatedTrackSnapshotQueryBoundary = productionDatedTrackSnapshotBoundary,
): Promise<AnalyticsTrackGrowthRow[]> {
  if (filter?.artistId) {
    const workspace = await readDatedTrackSnapshotWorkspace(
      orgId,
      filter.artistId,
      datedBoundary,
      false,
      {
        rows: { limit, offset: 0 },
        history: { limit: 1, offset: 0 },
        releaseId: filter.releaseId,
      },
    );
    return (workspace.latest?.rows ?? [])
      .filter((row) => !filter.releaseId || row.releaseId === filter.releaseId)
      .slice(0, limit)
      .map((row) => ({
        ...row,
        spotifyStreams: row.spotifyStreams ?? 0,
        appleStreams: row.appleStreams ?? 0,
        amazonStreams: row.amazonStreams ?? 0,
        pandoraStreams: row.pandoraStreams ?? 0,
        youtubeViews: row.youtubeViews ?? 0,
        tiktokViews: row.tiktokViews ?? 0,
        combinedViews: row.combinedViews ?? 0,
      }));
  }

  if (!filter?.artistId && !filter?.releaseId) {
    return listAnalyticsTracksByGrowth(orgId, limit);
  }

  let whereSQL = sql``;
  if (filter.artistId) {
    whereSQL = sql`${whereSQL} and primary_artist = (select name from label_suite.artists where id = ${filter.artistId})`;
  }
  if (filter.releaseId) {
    whereSQL = sql`${whereSQL} and track_title in (select t.title from label_suite.tracks t join label_suite.releases r on t.release_id = r.id where r.id = ${filter.releaseId})`;
  }

  const csvRows = await executeOptionalAnalyticsQuery<{
    trackTitle: string;
    primaryArtist: string | null;
    spotifyStreams: string | number | null;
    appleStreams: string | number | null;
    amazonStreams: string | number | null;
    pandoraStreams: string | number | null;
    combinedStreams: string | number | null;
    streamsGrowth: string | number | null;
    youtubeViews: string | number | null;
    tiktokViews: string | number | null;
    combinedViews: string | number | null;
    viewsGrowth: string | number | null;
    lastSeenAt: Date | string | null;
  }>(sql`
    select
      track_title as "trackTitle",
      primary_artist as "primaryArtist",
      spotify_streams as "spotifyStreams",
      apple_streams as "appleStreams",
      amazon_streams as "amazonStreams",
      pandora_streams as "pandoraStreams",
      combined_streams as "combinedStreams",
      streams_growth as "streamsGrowth",
      youtube_views as "youtubeViews",
      tiktok_views as "tiktokViews",
      combined_views as "combinedViews",
      views_growth as "viewsGrowth",
      last_seen_at as "lastSeenAt"
    from label_suite.track_totals
    where 1=1 ${whereSQL}
    order by combined_streams desc nulls last
    limit ${limit}
  `);
  if (csvRows.length) return csvRows.map((row) => ({
    id: `csv-${slugify(row.trackTitle)}-${slugify(row.primaryArtist ?? "unknown")}`,
    trackTitle: row.trackTitle,
    primaryArtist: row.primaryArtist,
    appTrackTitle: null,
    releaseTitle: null,
    combinedStreams: Number(row.combinedStreams ?? 0),
    spotifyStreams: Number(row.spotifyStreams ?? 0),
    appleStreams: Number(row.appleStreams ?? 0),
    amazonStreams: Number(row.amazonStreams ?? 0),
    pandoraStreams: Number(row.pandoraStreams ?? 0),
    streamsGrowth: row.streamsGrowth === null ? null : Number(row.streamsGrowth),
    youtubeViews: Number(row.youtubeViews ?? 0),
    tiktokViews: Number(row.tiktokViews ?? 0),
    combinedViews: Number(row.combinedViews ?? 0),
    viewsGrowth: row.viewsGrowth === null ? null : Number(row.viewsGrowth),
    lastSeenAt: toDate(row.lastSeenAt),
  }));

  const rows = await db
    .select({
      id: analytics_metric_rows.id,
      dimensions: analytics_metric_rows.dimensions,
      metrics: analytics_metric_rows.metrics,
      lastSeenAt: analytics_metric_rows.last_seen_at,
      trackTitle: tracks.title,
      releaseTitle: releases.title,
    })
    .from(analytics_metric_rows)
    .leftJoin(tracks, and(eq(analytics_metric_rows.track_id, tracks.id), eq(tracks.org_id, orgId)))
    .leftJoin(releases, and(eq(analytics_metric_rows.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate"),
      ...(filter.artistId ? [sql`${analytics_metric_rows.dimensions}->>'primary_artist' = (select name from label_suite.artists where id = ${filter.artistId} and org_id = ${orgId})`] : []),
      ...(filter.releaseId ? [eq(analytics_metric_rows.release_id, filter.releaseId)] : []),
    ))
    .orderBy(desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'combined_streams', '')::numeric`), desc(analytics_metric_rows.last_seen_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    trackTitle: row.dimensions.track_title ?? row.trackTitle ?? "Untitled track",
    primaryArtist: row.dimensions.primary_artist ?? null,
    appTrackTitle: row.trackTitle,
    releaseTitle: row.releaseTitle,
    combinedStreams: numberMetric(row.metrics, "combined_streams"),
    spotifyStreams: numberMetric(row.metrics, "spotify_streams"),
    appleStreams: numberMetric(row.metrics, "apple_streams"),
    amazonStreams: numberMetric(row.metrics, "amazon_streams"),
    pandoraStreams: numberMetric(row.metrics, "pandora_streams"),
    streamsGrowth: nullableNumberMetric(row.metrics, "streams_growth"),
    youtubeViews: numberMetric(row.metrics, "youtube_views"),
    tiktokViews: numberMetric(row.metrics, "tiktok_views"),
    combinedViews: numberMetric(row.metrics, "combined_views"),
    viewsGrowth: nullableNumberMetric(row.metrics, "views_growth"),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
}

export async function listCommandCenterArtists(orgId: string): Promise<FilterOption[]> {
  const rows = await db
    .select({ id: artists.id, name: artists.name })
    .from(artists)
    .where(eq(artists.org_id, orgId))
    .orderBy(artists.name);

  return rows.map((row) => ({ id: row.id, label: row.name }));
}

export async function listCommandCenterReleases(orgId: string, artistId?: string): Promise<FilterOption[]> {
  const rows = await db
    .select({ id: releases.id, title: releases.title })
    .from(releases)
    .where(artistId ? and(eq(releases.org_id, orgId), eq(releases.artist_id, artistId)) : eq(releases.org_id, orgId))
    .orderBy(releases.title);

  return rows.map((row) => ({ id: row.id, label: row.title }));
}

export async function listAnalyticsTracksByGrowth(
  orgId: string,
  limit = 50,
): Promise<AnalyticsTrackGrowthRow[]> {
  const csvRows = await executeOptionalAnalyticsQuery<{
    trackTitle: string;
    primaryArtist: string | null;
    spotifyStreams: string | number | null;
    appleStreams: string | number | null;
    amazonStreams: string | number | null;
    pandoraStreams: string | number | null;
    combinedStreams: string | number | null;
    streamsGrowth: string | number | null;
    youtubeViews: string | number | null;
    tiktokViews: string | number | null;
    combinedViews: string | number | null;
    viewsGrowth: string | number | null;
    lastSeenAt: Date | string | null;
  }>(sql`
    select
      track_title as "trackTitle",
      primary_artist as "primaryArtist",
      spotify_streams as "spotifyStreams",
      apple_streams as "appleStreams",
      amazon_streams as "amazonStreams",
      pandora_streams as "pandoraStreams",
      combined_streams as "combinedStreams",
      streams_growth as "streamsGrowth",
      youtube_views as "youtubeViews",
      tiktok_views as "tiktokViews",
      combined_views as "combinedViews",
      views_growth as "viewsGrowth",
      last_seen_at as "lastSeenAt"
    from label_suite.track_totals
    order by combined_streams desc nulls last
    limit ${limit}
  `);

  if (csvRows.length) {
    return csvRows.map((row) => ({
      id: `csv-${slugify(row.trackTitle)}-${slugify(row.primaryArtist ?? "unknown")}`,
      trackTitle: row.trackTitle,
      primaryArtist: row.primaryArtist,
      appTrackTitle: null,
      releaseTitle: null,
      combinedStreams: Number(row.combinedStreams ?? 0),
      spotifyStreams: Number(row.spotifyStreams ?? 0),
      appleStreams: Number(row.appleStreams ?? 0),
      amazonStreams: Number(row.amazonStreams ?? 0),
      pandoraStreams: Number(row.pandoraStreams ?? 0),
      streamsGrowth: row.streamsGrowth === null ? null : Number(row.streamsGrowth),
      youtubeViews: Number(row.youtubeViews ?? 0),
      tiktokViews: Number(row.tiktokViews ?? 0),
      combinedViews: Number(row.combinedViews ?? 0),
      viewsGrowth: row.viewsGrowth === null ? null : Number(row.viewsGrowth),
      lastSeenAt: toDate(row.lastSeenAt),
    }));
  }

  const rangeRows = await db
    .select({
      requestedDateRange: analytics_metric_rows.requested_date_range,
      requestedAggregation: analytics_metric_rows.requested_aggregation,
      rowCount: sql<string>`count(*)`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
    })
    .from(analytics_metric_rows)
    .where(
      and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate"),
      ),
    )
    .groupBy(analytics_metric_rows.requested_date_range, analytics_metric_rows.requested_aggregation)
    .orderBy(desc(sql<Date>`max(${analytics_metric_rows.last_seen_at})`));

  const ranges: AnalyticsTrackGrowthRangeSummary[] = rangeRows.map((row) => ({
    rangeLabel: row.requestedDateRange,
    aggregationLabel: row.requestedAggregation,
    rowCount: Number(row.rowCount),
    lastSeenAt: toDate(row.lastSeenAt),
    streamTotals: { combinedStreams: 0, spotifyStreams: 0, appleStreams: 0, amazonStreams: 0, pandoraStreams: 0 },
  }));
  const primary = pickPrimaryTrackGrowthRange(ranges) ?? ranges[0];
  if (!primary) return [];

  const rows = await db
    .select({
      id: analytics_metric_rows.id,
      dimensions: analytics_metric_rows.dimensions,
      metrics: analytics_metric_rows.metrics,
      lastSeenAt: analytics_metric_rows.last_seen_at,
      trackTitle: tracks.title,
      releaseTitle: releases.title,
    })
    .from(analytics_metric_rows)
    .leftJoin(tracks, and(eq(analytics_metric_rows.track_id, tracks.id), eq(tracks.org_id, orgId)))
    .leftJoin(releases, and(eq(analytics_metric_rows.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(
      and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate"),
        eq(analytics_metric_rows.requested_aggregation, primary.aggregationLabel),
        eq(analytics_metric_rows.requested_date_range, primary.rangeLabel),
      ),
    )
    .orderBy(
      desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'combined_streams', '')::numeric`),
      desc(analytics_metric_rows.last_seen_at),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    trackTitle: row.dimensions.track_title ?? row.trackTitle ?? "Untitled track",
    primaryArtist: row.dimensions.primary_artist ?? null,
    appTrackTitle: row.trackTitle,
    releaseTitle: row.releaseTitle,
    combinedStreams: numberMetric(row.metrics, "combined_streams"),
    spotifyStreams: numberMetric(row.metrics, "spotify_streams"),
    appleStreams: numberMetric(row.metrics, "apple_streams"),
    amazonStreams: numberMetric(row.metrics, "amazon_streams"),
    pandoraStreams: numberMetric(row.metrics, "pandora_streams"),
    streamsGrowth: nullableNumberMetric(row.metrics, "streams_growth"),
    youtubeViews: numberMetric(row.metrics, "youtube_views"),
    tiktokViews: numberMetric(row.metrics, "tiktok_views"),
    combinedViews: numberMetric(row.metrics, "combined_views"),
    viewsGrowth: nullableNumberMetric(row.metrics, "views_growth"),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
}

export interface AnalyticsCityRow {
  city: string;
  streams: number;
  listeners: number | null;
  trackCount: number;
  lastSeenAt: Date | null;
}

export async function listAnalyticsCities(
  orgId: string,
  limit = 50,
): Promise<AnalyticsCityRow[]> {
  const csvRows = await executeOptionalAnalyticsQuery<{
    city: string;
    country: string | null;
    streams: string | number | null;
    superfans: string | number | null;
  }>(sql`
    select city, country, streams, superfans
    from label_suite.geo_superfans
    order by streams desc nulls last
    limit ${limit}
  `);
  if (csvRows.length) {
    return csvRows.map((row) => ({
      city: row.country ? `${row.city}, ${row.country}` : row.city,
      streams: Number(row.streams ?? 0),
      listeners: Number(row.superfans ?? 0) || null,
      trackCount: 0,
      lastSeenAt: null,
    }));
  }

  const rows = await db
    .select({
      city: sql<string>`${analytics_metric_rows.dimensions}->>'city'`,
      streams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
      listeners: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'listeners', '')::numeric), 0)`,
      trackCount: sql<string>`count(distinct ${analytics_metric_rows.track_id})`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
    })
    .from(analytics_metric_rows)
    .where(
      and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "spotify-superfans-active-streams-city"),
      ),
    )
    .groupBy(sql`${analytics_metric_rows.dimensions}->>'city'`)
    .orderBy(desc(sql<number>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`))
    .limit(limit);

  return rows.map((row) => ({
    city: row.city ?? "Unknown",
    streams: Number(row.streams ?? 0),
    listeners: Number(row.listeners ?? 0) || null,
    trackCount: Number(row.trackCount ?? 0),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
}

export interface AnalyticsSourceRow {
  source: string;
  streams: number;
  platform: "spotify" | "apple";
  trackCount: number;
  lastSeenAt: Date | null;
}

export async function listAnalyticsStreamSources(
  orgId: string,
): Promise<{ spotify: AnalyticsSourceRow[]; apple: AnalyticsSourceRow[] }> {
  const csvRows = await executeOptionalAnalyticsQuery<{
    source: string;
    platform: "spotify" | "apple";
    streams: string | number;
  }>(sql`
    select source, platform, streams
    from label_suite.monthly_source_mix
    order by platform, streams desc
  `);

  if (csvRows.length) {
    const rows = csvRows.map((row) => ({
      source: row.source ?? "Unknown",
      streams: Number(row.streams ?? 0),
      platform: row.platform,
      trackCount: 0,
      lastSeenAt: null,
    }));
    return {
      spotify: rows.filter((row) => row.platform === "spotify"),
      apple: rows.filter((row) => row.platform === "apple"),
    };
  }

  async function fetchSources(
    widgetKey: string,
    platform: "spotify" | "apple",
  ): Promise<AnalyticsSourceRow[]> {
    const rows = await db
      .select({
        source: sql<string>`coalesce(${analytics_metric_rows.dimensions}->>'source', ${analytics_metric_rows.dimensions}->>'source_of_stream', 'Unknown')`,
        streams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
        trackCount: sql<string>`count(distinct ${analytics_metric_rows.track_id})`,
        lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
      })
      .from(analytics_metric_rows)
      .where(
        and(
          eq(analytics_metric_rows.org_id, orgId),
          eq(analytics_metric_rows.widget_key, widgetKey),
        ),
      )
      .groupBy(
        sql`coalesce(${analytics_metric_rows.dimensions}->>'source', ${analytics_metric_rows.dimensions}->>'source_of_stream', 'Unknown')`,
      )
      .orderBy(desc(sql<number>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`));

    return rows.map((row) => ({
      source: row.source ?? "Unknown",
      streams: Number(row.streams ?? 0),
      platform,
      trackCount: Number(row.trackCount ?? 0),
      lastSeenAt: toDate(row.lastSeenAt),
    }));
  }

  const [spotify, apple] = await Promise.all([
    fetchSources("spotify-streams-source", "spotify"),
    fetchSources("apple-streams-source", "apple"),
  ]);

  return { spotify, apple };
}

export interface AnalyticsWidgetRow {
  id: string;
  label: string;
  dimensions: Record<string, string | null>;
  metrics: Record<string, number | null>;
  lastSeenAt: Date | null;
}

export async function listAnalyticsWidgetRows(
  orgId: string,
  widgetKey: string,
  limit = 100,
): Promise<AnalyticsWidgetRow[]> {
  if (widgetKey === "spotify-demographics-passion-indicators") {
    const rows = await executeOptionalAnalyticsQuery<{
      gender: string | null;
      ageGroup: string | null;
      streams: string | number | null;
      activeStreamRate: string | number | null;
      averageCompletionRate: string | number | null;
      averageStreamsPerUser: string | number | null;
      lastSeenAt: Date | string | null;
    }>(sql`
      select gender, age_group as "ageGroup", streams,
        active_stream_rate as "activeStreamRate",
        average_completion_rate as "averageCompletionRate",
        average_streams_per_user as "averageStreamsPerUser",
        last_seen_at as "lastSeenAt"
      from label_suite.demographics
      order by streams desc
      limit ${limit}
    `);
    if (rows.length) {
      return rows.map((row, i) => ({
        id: `csv-demographics-${i}`,
        label: [row.gender, row.ageGroup].filter(Boolean).join(" · ") || `Row ${i + 1}`,
        dimensions: { gender: row.gender, age: row.ageGroup },
        metrics: {
          streams: Number(row.streams ?? 0),
          active_stream_rate: row.activeStreamRate === null ? null : Number(row.activeStreamRate),
          average_completion_rate: row.averageCompletionRate === null ? null : Number(row.averageCompletionRate),
          average_streams_per_user: row.averageStreamsPerUser === null ? null : Number(row.averageStreamsPerUser),
        },
        lastSeenAt: toDate(row.lastSeenAt),
      }));
    }
  }

  if (widgetKey === "spotify-playlist-listings") {
    const rows = await executeOptionalAnalyticsQuery<{
      playlistName: string | null;
      playlistSourceUri: string | null;
      playlistOwnerId: string | null;
      latestPosition: string | number | null;
      streams: string | number | null;
      averageCompletionRate: string | number | null;
      averageStreamsPerUser: string | number | null;
      lastSeenAt: Date | string | null;
    }>(sql`
      select playlist_name as "playlistName", playlist_source_uri as "playlistSourceUri",
        playlist_owner_id as "playlistOwnerId", latest_position as "latestPosition", streams,
        average_completion_rate as "averageCompletionRate",
        average_streams_per_user as "averageStreamsPerUser",
        last_seen_at as "lastSeenAt"
      from label_suite.top_playlists
      order by streams desc
      limit ${limit}
    `);
    if (rows.length) {
      return rows.map((row, i) => ({
        id: `csv-playlist-${i}`,
        label: row.playlistName ?? `Playlist ${i + 1}`,
        dimensions: {
          playlist__name: row.playlistName,
          playlist__source_uri: row.playlistSourceUri,
          playlist__owner_id: row.playlistOwnerId,
        },
        metrics: {
          latest_position: row.latestPosition === null ? null : Number(row.latestPosition),
          streams: Number(row.streams ?? 0),
          average_completion_rate: row.averageCompletionRate === null ? null : Number(row.averageCompletionRate),
          average_streams_per_user: row.averageStreamsPerUser === null ? null : Number(row.averageStreamsPerUser),
        },
        lastSeenAt: toDate(row.lastSeenAt),
      }));
    }
  }

  if (widgetKey === "shazams-city") {
    const rows = await executeOptionalAnalyticsQuery<{
      city: string;
      state: string | null;
      country: string | null;
      shazams: string | number | null;
      lastSeenAt: Date | string | null;
    }>(sql`
      select city, state, country, shazams, last_seen_at as "lastSeenAt"
      from label_suite.shazams_city
      order by shazams desc
      limit ${limit}
    `);
    if (rows.length) {
      return rows.map((row, i) => ({
        id: `csv-shazam-${i}`,
        label: [row.city, row.state, row.country].filter(Boolean).join(", "),
        dimensions: { city: row.city, state: row.state, country: row.country },
        metrics: { shazams: Number(row.shazams ?? 0) },
        lastSeenAt: toDate(row.lastSeenAt),
      }));
    }
  }

  const rows = await db
    .select({
      id: analytics_metric_rows.id,
      dimensions: analytics_metric_rows.dimensions,
      metrics: analytics_metric_rows.metrics,
      lastSeenAt: analytics_metric_rows.last_seen_at,
    })
    .from(analytics_metric_rows)
    .where(
      and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, widgetKey),
      ),
    )
    .orderBy(desc(analytics_metric_rows.last_seen_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    label: firstDimensionLabel(row.dimensions) ?? row.id.slice(0, 8),
    dimensions: row.dimensions as Record<string, string | null>,
    metrics: Object.fromEntries(
      Object.entries(row.metrics as Record<string, string | number | null>).map(([k]) => [
        k,
        nullableNumberMetric(row.metrics as Record<string, string | number | null>, k),
      ]),
    ),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
}

export interface AnalyticsRunRow {
  id: string;
  source: string;
  status: string;
  mode: string;
  rowsImported: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  filesDownloaded: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  scope: string | null;
}

export async function listAnalyticsRunHistory(
  orgId: string,
  limit = 50,
): Promise<AnalyticsRunRow[]> {
  const rows = await db
    .select({
      id: analytics_import_runs.id,
      source: analytics_import_runs.source,
      status: analytics_import_runs.status,
      mode: analytics_import_runs.mode,
      rowsImported: analytics_import_runs.rows_imported,
      rowsInserted: analytics_import_runs.rows_inserted,
      rowsUpdated: analytics_import_runs.rows_updated,
      rowsUnchanged: analytics_import_runs.rows_unchanged,
      filesDownloaded: analytics_import_runs.files_downloaded,
      startedAt: analytics_import_runs.started_at,
      completedAt: analytics_import_runs.completed_at,
      error: analytics_import_runs.error,
      scopeLabel: sql<string>`case
        when ${analytics_import_runs.artist_id} is not null then 'artist'
        when ${analytics_import_runs.release_id} is not null then 'release'
        when ${analytics_import_runs.track_id} is not null then 'track'
        else 'org-wide'
      end`,
    })
    .from(analytics_import_runs)
    .where(eq(analytics_import_runs.org_id, orgId))
    .orderBy(desc(analytics_import_runs.started_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    mode: row.mode,
    rowsImported: row.rowsImported ?? 0,
    rowsInserted: row.rowsInserted ?? 0,
    rowsUpdated: row.rowsUpdated ?? 0,
    rowsUnchanged: row.rowsUnchanged ?? 0,
    filesDownloaded: row.filesDownloaded ?? 0,
    startedAt: toDate(row.startedAt),
    completedAt: toDate(row.completedAt),
    error: row.error,
    scope: row.scopeLabel ?? null,
  }));
}

export function formatAnalyticsDate(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatAnalyticsLongDate(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "Waiting for import";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAnalyticsNumber(value: number): string {
  return value.toLocaleString();
}

export function formatAnalyticsPercent(value: number | null): string {
  if (value === null) return "—";
  return (value * 100).toFixed(1) + "%";
}

export function analyticsGrowthClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value < 0) return "text-red-600 dark:text-red-400";
  if (value > 0) return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

// ─── Today Hub decision cards ─────────────────────────────────────────

export interface TodayHubCard {
  /** Machine-readable key for targeting (e.g. "overnight-mover", "attention-decline"). */
  key: string;
  /** Display title (1 line). */
  title: string;
  /** 1-2 supporting data points shown below the title. */
  detail: string;
  /** Optional metric badge (e.g. "+12%"). */
  metric: string | null;
  /** Color tone: "good" = green, "watch" = amber, "neutral" = blue. */
  tone: "good" | "watch" | "neutral";
  /** Link target (relative URL or null if no action). */
  linkUrl: string | null;
  /** Link label shown on the card. */
  linkLabel: string | null;
}

export interface TodayHubData {
  cards: TodayHubCard[];
  dataHealth: {
    lastSeenAt: string | null;
    totalRows: number;
    totalWidgets: number;
    evidencePartial: boolean;
  };
}

const ANALYTICS_INGESTION_SCHEMA_IDENTIFIERS = [
  "analytics_duplicate_reviews",
  "storage_status",
  "storage_uploaded_at",
  "storage_error",
] as const;

/**
 * Keeps the dashboard usable while the required migration is being applied.
 * This deliberately recognizes only the two new ingestion-schema failure modes.
 */
export async function loadTodayAnalyticsDataQuality(
  orgId: string,
  load: (id: string) => Promise<AnalyticsDataQualityReport> = listAnalyticsDataQuality,
): Promise<AnalyticsDataQualityReport> {
  try {
    return await load(orgId);
  } catch (error) {
    if (!isAnalyticsIngestionSchemaUnavailable(error)) throw error;
    return unavailableAnalyticsDataQualityReport();
  }
}

export function unavailableAnalyticsDataQualityReport(): AnalyticsDataQualityReport {
  return {
    health: {
      lastSuccessfulRunAt: null,
      sourceObservedAt: null,
      reportingThrough: null,
      freshnessBasis: "unknown",
      coverage: "invalid",
      stale: true,
      failedRuns: 0,
      unreviewedDuplicateCandidates: 0,
      degradedReasons: ["invalid_evidence"],
    },
    currentRun: null,
    evidence: { limit: 0, returnedRows: 0, partial: false, complete: false, version: "0".repeat(64) },
    sources: [],
    candidates: [],
    compatibility: "schema_unavailable",
  };
}

export function isAnalyticsIngestionSchemaUnavailable(error: unknown): boolean {
  const details = databaseErrorDetails(error);
  if (!details) return false;
  const message = details.message.toLowerCase();
  const mentionsIngestionSchema = ANALYTICS_INGESTION_SCHEMA_IDENTIFIERS.some((identifier) => message.includes(identifier));
  return mentionsIngestionSchema && (details.code === "42P01" || details.code === "42703");
}

function databaseErrorDetails(error: unknown): { code: string | null; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  const code = typeof value.code === "string" ? value.code : null;
  const message = typeof value.message === "string" ? value.message : "";
  if (code) return { code, message };
  return value.cause === error ? null : databaseErrorDetails(value.cause);
}

export async function listTodayHub(orgId: string): Promise<TodayHubData> {
  const [command, ingestion] = await Promise.all([listAnalyticsCommandCenter(orgId), loadTodayAnalyticsDataQuality(orgId)]);
  return buildTodayHub(command, ingestion);
}

export function buildTodayHub(command: AnalyticsCommandCenter, ingestion: AnalyticsDataQualityReport): TodayHubData {
  const period = command.periods.find((p) => p.key === "30d") ?? command.periods[0];
  const cards: TodayHubCard[] = [];

  // 1. "What changed overnight?" — momentum + top mover
  const momentumInsight = period.insights.find((i) => i.label === "Momentum");
  const moverInsight = period.insights.find((i) => i.label === "Catalogue mover");

  if (momentumInsight) {
    cards.push({
      key: "overnight-change",
      title: momentumInsight.title,
      detail: momentumInsight.detail,
      metric: momentumInsight.metric,
      tone: momentumInsight.tone,
      linkUrl: "/analytics",
      linkLabel: "Open analytics",
    });
  }

  if (moverInsight && command.catalog.topMover) {
    cards.push({
      key: "overnight-mover",
      title: `Top mover: ${moverInsight.title}`,
      detail: command.catalog.topMover.primaryArtist
        ? `${command.catalog.topMover.primaryArtist} · ${formatCompact(command.catalog.topMover.combinedStreams)} streams`
        : `${formatCompact(command.catalog.topMover.combinedStreams)} cumulative streams`,
      metric: moverInsight.metric,
      tone: moverInsight.tone,
      linkUrl: "/analytics",
      linkLabel: "Open track",
    });
  }

  // 2. "Attention needed" — declining tracks (-15%+)
  const decliningTracks = command.catalog.topTracks
    .filter((t) => t.streamsGrowth !== null && t.streamsGrowth < -0.15)
    .slice(0, 2);
  for (const track of decliningTracks) {
    cards.push({
      key: `attention-decline-${track.id.slice(0, 8)}`,
      title: `⬇ ${track.trackTitle}`,
      detail: `${track.primaryArtist ?? "Unknown artist"} · ${formatCompact(track.combinedStreams)} streams`,
      metric: track.streamsGrowth !== null ? signedPercent(track.streamsGrowth) : null,
      tone: "watch",
      linkUrl: "/analytics",
      linkLabel: "Investigate",
    });
  }

  // 3. "Opportunity" — growing tracks (+15%+)
  const growingTracks = command.catalog.topTracks
    .filter((t) => t.streamsGrowth !== null && t.streamsGrowth > 0.15)
    .sort((a, b) => (b.streamsGrowth ?? 0) - (a.streamsGrowth ?? 0))
    .slice(0, 2);
  for (const track of growingTracks) {
    cards.push({
      key: `opportunity-growth-${track.id.slice(0, 8)}`,
      title: `↗ ${track.trackTitle}`,
      detail: `${track.primaryArtist ?? "Unknown artist"} · ${formatCompact(track.combinedStreams)} streams`,
      metric: track.streamsGrowth !== null ? signedPercent(track.streamsGrowth) : null,
      tone: "good",
      linkUrl: "/analytics",
      linkLabel: "Use momentum",
    });
  }

  // 4. "Opportunity" — top cities
  const topCity = command.markets.topCity;
  if (topCity) {
    cards.push({
      key: "opportunity-market",
      title: `📍 Top market: ${topCity.city}`,
      detail: `${formatCompact(topCity.streams)} streams${topCity.listeners ? ` · ${formatCompact(topCity.listeners)} superfans` : ""}`,
      metric: null,
      tone: "neutral",
      linkUrl: "/analytics",
      linkLabel: "View markets",
    });
  }

  const hasImportHistory = command.dataHealth.totalRows > 0 || ingestion.currentRun !== null;
  if (ingestion.compatibility === "schema_unavailable" || ingestion.health.failedRuns > 0
    || ingestion.health.unreviewedDuplicateCandidates > 0
    || (hasImportHistory && (ingestion.evidence.partial || ingestion.health.stale))) {
    const detail = ingestion.compatibility === "schema_unavailable"
      ? "Analytics Data Health is unavailable until the ingestion schema migration is applied."
      : ingestion.health.failedRuns > 0
      ? `${ingestion.health.failedRuns} import run(s) failed. Review the import details before trying again.`
      : ingestion.evidence.partial
      ? "Sisense evidence is truncated; do not treat today’s analytics signals as complete."
      : ingestion.health.stale
      ? "Sisense evidence is stale or has no recent successful import."
      : `${ingestion.health.failedRuns} failed run(s) and ${ingestion.health.unreviewedDuplicateCandidates} duplicate candidate(s) need review.`;
    cards.push({
      key: "analytics-data-health",
      title: "Analytics data health needs attention",
      detail,
      metric: ingestion.health.unreviewedDuplicateCandidates ? String(ingestion.health.unreviewedDuplicateCandidates) : null,
      tone: "watch",
      linkUrl: "/analytics?section=data-health#analytics-data-health",
      linkLabel: "Open data health",
    });
  }

  // 5. Data freshness badge is handled in the component via dataHealth

  return {
    cards,
    dataHealth: {
      lastSeenAt: command.dataHealth.lastSeenAt,
      totalRows: command.dataHealth.totalRows,
      totalWidgets: command.dataHealth.totalWidgets,
      evidencePartial: ingestion.evidence.partial,
    },
  };
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

// ─── Per-release / per-artist Sisense sections ────────────────────────
// Release rows are matched via ISRC: the release's track ISRCs map to every
// app track sharing the recording, plus any metric row carrying an ISRC
// dimension. Artist rows are matched via the sync's artist link or, for
// unlinked rows, the artist-name dimensions the sync itself matches on.

const SISENSE_STREAM_SOURCE_WIDGETS = ["spotify-streams-source", "apple-streams-source"];
const SISENSE_CITY_WIDGET = "spotify-superfans-active-streams-city";
const SISENSE_DEMOGRAPHICS_WIDGET = "spotify-demographics-passion-indicators";

export interface SisenseDateWindow {
  from: string | null;
  to: string | null;
}

export interface SisenseWeeklyStreamsPoint {
  weekStart: string;
  spotifyStreams: number | null;
  appleStreams: number | null;
}

export interface SisenseCrossPlatformDailyPoint {
  date: string;
  spotifyStreams: number | null;
  appleStreams: number | null;
}

export interface SisenseDailyMetricPoint {
  date: string;
  value: number;
}

export interface SisenseCountryShareRow {
  country: string;
  streams: number;
  sharePct: number;
}

export interface SisenseSourceShareRow {
  source: string;
  streams: number;
  sharePct: number;
}

export interface SisenseCitySuperfansRow {
  city: string;
  country: string | null;
  superfans: number;
  streams: number;
}

export interface SisenseDemographicsCell {
  gender: string;
  streams: number | null;
  activeStreamRate: number | null;
  completionRate: number | null;
}

export interface SisenseDemographicsRow {
  age: string;
  cells: SisenseDemographicsCell[];
}

export interface ReleaseSisenseSection {
  weeklyStreams: { points: SisenseWeeklyStreamsPoint[]; window: SisenseDateWindow } | null;
  topCountries: { rows: SisenseCountryShareRow[]; totalStreams: number; asOf: string | null } | null;
  sourceMix: {
    spotify: SisenseSourceShareRow[];
    apple: SisenseSourceShareRow[];
    spotifyWindow: SisenseDateWindow;
    appleWindow: SisenseDateWindow;
  } | null;
  superfanReach: { superfans: number; cityCount: number; asOf: string | null } | null;
}

export interface ArtistSisenseSection {
  followersDaily: { points: SisenseDailyMetricPoint[]; window: SisenseDateWindow } | null;
  monthlyListenersDaily: { points: SisenseDailyMetricPoint[]; window: SisenseDateWindow } | null;
  superfansByCity: { rows: SisenseCitySuperfansRow[]; asOf: string | null } | null;
  demographics: { genders: string[]; rows: SisenseDemographicsRow[]; asOf: string | null } | null;
  crossPlatformStreams: {
    points: SisenseCrossPlatformDailyPoint[];
    spotifyTotal: number;
    appleTotal: number;
    window: SisenseDateWindow;
  } | null;
}

export async function getReleaseSisenseSection(
  orgId: string,
  releaseId: string,
): Promise<ReleaseSisenseSection | null> {
  const match = await buildReleaseSisenseMatch(orgId, releaseId);
  const [datedStreams, cityRows, sourceRows] = await Promise.all([
    fetchSisenseDatedStreams(orgId, match, 84),
    fetchSisenseCityRows(orgId, match),
    fetchSisenseSourceMix(orgId, match),
  ]);

  const weeklyStreams = datedStreams.length
    ? { points: toWeeklyPoints(datedStreams), window: dateWindowOf(datedStreams.map((row) => row.day)) }
    : null;

  const cityAsOf = isoDateOrNull(maxDate(cityRows.map((row) => row.lastSeenAt)));
  const countriesTotal = cityRows.reduce((sum, row) => sum + row.streams, 0);
  const byCountry = new Map<string, number>();
  for (const row of cityRows) {
    const key = row.country?.trim() || "Unknown";
    byCountry.set(key, (byCountry.get(key) ?? 0) + row.streams);
  }
  const topCountries = countriesTotal > 0
    ? {
        rows: [...byCountry.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([country, streams]) => ({
            country,
            streams,
            sharePct: (streams / countriesTotal) * 100,
          })),
        totalStreams: countriesTotal,
        asOf: cityAsOf,
      }
    : null;

  const totalSuperfans = cityRows.reduce((sum, row) => sum + row.superfans, 0);
  const superfanReach = totalSuperfans > 0
    ? {
        superfans: totalSuperfans,
        cityCount: cityRows.filter((row) => row.superfans > 0).length,
        asOf: cityAsOf,
      }
    : null;

  const sourceMix = sourceRows.length ? buildSourceMix(sourceRows) : null;

  if (!weeklyStreams && !topCountries && !superfanReach && !sourceMix) return null;
  return { weeklyStreams, topCountries, sourceMix, superfanReach };
}

export async function getArtistSisenseSection(
  orgId: string,
  artistId: string,
): Promise<ArtistSisenseSection | null> {
  const artistRows = await db
    .select({ name: artists.name })
    .from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
    .limit(1);
  if (!artistRows.length) return null;

  const match = buildArtistSisenseMatch(artistId, artistRows[0].name);
  const [followersPoints, listenerPoints, cityRows, demographicRows, datedStreams] = await Promise.all([
    fetchSisenseDatedMetric(orgId, match, ["followers", "follower_count", "total_followers", "spotify_followers"], 365),
    fetchSisenseDatedMetric(orgId, match, ["monthly_listeners", "monthly_active_listeners", "listeners", "mal"], 365),
    fetchSisenseCityRows(orgId, match),
    fetchSisenseDemographicsRows(orgId, match),
    fetchSisenseDatedStreams(orgId, match, 365),
  ]);

  const followersDaily = followersPoints.length
    ? { points: followersPoints, window: dateWindowOf(followersPoints.map((point) => point.date)) }
    : null;
  const monthlyListenersDaily = listenerPoints.length
    ? { points: listenerPoints, window: dateWindowOf(listenerPoints.map((point) => point.date)) }
    : null;

  const cityAsOf = isoDateOrNull(maxDate(cityRows.map((row) => row.lastSeenAt)));
  const superfanCityRows = cityRows
    .filter((row) => row.superfans > 0)
    .sort((a, b) => b.superfans - a.superfans)
    .slice(0, 10)
    .map(({ city, country, superfans, streams }) => ({ city, country, superfans, streams }));
  const superfansByCity = superfanCityRows.length ? { rows: superfanCityRows, asOf: cityAsOf } : null;

  const demographics = buildSisenseDemographics(demographicRows);
  const crossPlatformStreams = datedStreams.length ? buildCrossPlatformDaily(datedStreams) : null;

  if (!followersDaily && !monthlyListenersDaily && !superfansByCity && !demographics && !crossPlatformStreams) {
    return null;
  }
  return { followersDaily, monthlyListenersDaily, superfansByCity, demographics, crossPlatformStreams };
}

async function buildReleaseSisenseMatch(orgId: string, releaseId: string): Promise<SQL> {
  const releaseTracks = await db
    .select({ isrc: tracks.isrc })
    .from(tracks)
    .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, releaseId)));
  const isrcs = [...new Set(
    releaseTracks
      .map((row) => normalizeIsrc(row.isrc))
      .filter((value): value is string => Boolean(value)),
  )];

  const conditions: SQL[] = [eq(analytics_metric_rows.release_id, releaseId)];
  if (isrcs.length) {
    const isrcList = sql.join(isrcs.map((isrc) => sql`${isrc}`), sql`, `);
    const sameRecordingTracks = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(
        eq(tracks.org_id, orgId),
        sql`upper(regexp_replace(coalesce(${tracks.isrc}, ''), '[^a-zA-Z0-9]', '', 'g')) in (${isrcList})`,
      ));
    if (sameRecordingTracks.length) {
      conditions.push(inArray(analytics_metric_rows.track_id, sameRecordingTracks.map((row) => row.id)));
    }
    conditions.push(sql`upper(regexp_replace(coalesce(
      ${analytics_metric_rows.dimensions}->>'isrc',
      ${analytics_metric_rows.dimensions}->>'track_isrc',
      ${analytics_metric_rows.raw_row}->>'isrc',
      ''), '[^a-zA-Z0-9]', '', 'g')) in (${isrcList})`);
  }
  return or(...conditions)!;
}

function buildArtistSisenseMatch(artistId: string, artistName: string | null): SQL {
  const byId = eq(analytics_metric_rows.artist_id, artistId);
  const name = artistName?.trim().toLowerCase();
  if (!name) return byId;
  return or(
    byId,
    and(
      isNull(analytics_metric_rows.artist_id),
      sql`lower(coalesce(
        ${analytics_metric_rows.dimensions}->>'primary_artist',
        ${analytics_metric_rows.dimensions}->>'artist',
        ${analytics_metric_rows.dimensions}->>'artist_name',
        ${analytics_metric_rows.dimensions}->>'main_artist')) = ${name}`,
    ),
  )!;
}

interface SisenseDatedPlatformRow {
  platform: "spotify" | "apple";
  day: string;
  streams: number;
}

function sisenseDayInWindow(dayExpr: SQL, sinceDays: number): SQL {
  // CASE guards the ::date cast — Postgres gives no evaluation-order guarantee
  // between a regex predicate and the cast, so casting must stay conditional.
  return sql`(case when ${dayExpr} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (${dayExpr})::date end) >= current_date - ${sinceDays}::int`;
}

async function fetchSisenseDatedStreams(
  orgId: string,
  match: SQL,
  sinceDays: number,
): Promise<SisenseDatedPlatformRow[]> {
  const dayExpr = sql<string>`${analytics_metric_rows.dimensions}->>'_col0'`;
  const rows = await db
    .select({
      widgetKey: analytics_metric_rows.widget_key,
      day: dayExpr,
      streams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
    })
    .from(analytics_metric_rows)
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      inArray(analytics_metric_rows.widget_key, SISENSE_STREAM_SOURCE_WIDGETS),
      sisenseDayInWindow(dayExpr, sinceDays),
      match,
    ))
    .groupBy(analytics_metric_rows.widget_key, dayExpr)
    .orderBy(dayExpr);

  return rows.map((row) => ({
    platform: row.widgetKey === "apple-streams-source" ? "apple" as const : "spotify" as const,
    day: row.day,
    streams: Number(row.streams ?? 0),
  }));
}

async function fetchSisenseDatedMetric(
  orgId: string,
  match: SQL,
  metricKeys: string[],
  sinceDays: number,
): Promise<SisenseDailyMetricPoint[]> {
  const valueExpr = sql`coalesce(${sql.join(
    metricKeys.map((key) => sql`nullif(${analytics_metric_rows.metrics}->>${key}, '')::numeric`),
    sql`, `,
  )})`;
  const dayExpr = sql<string>`coalesce(
    ${analytics_metric_rows.dimensions}->>'_col0',
    ${analytics_metric_rows.dimensions}->>'date',
    ${analytics_metric_rows.dimensions}->>'day')`;
  const rows = await db
    .select({
      day: dayExpr,
      // Level metrics (followers, listeners): max per day so segmented rows can't inflate the value.
      value: sql<string>`max(${valueExpr})`,
    })
    .from(analytics_metric_rows)
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      sisenseDayInWindow(dayExpr, sinceDays),
      sql`${valueExpr} is not null`,
      match,
    ))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  return rows
    .filter((row) => row.value !== null)
    .map((row) => ({ date: row.day, value: Number(row.value) }));
}

interface SisenseCityAggregateRow {
  city: string;
  country: string | null;
  streams: number;
  superfans: number;
  lastSeenAt: Date | null;
}

async function fetchSisenseCityRows(orgId: string, match: SQL): Promise<SisenseCityAggregateRow[]> {
  const cityExpr = sql<string>`coalesce(${analytics_metric_rows.dimensions}->>'city', 'Unknown')`;
  const countryExpr = sql<string | null>`${analytics_metric_rows.dimensions}->>'country'`;
  const rows = await db
    .select({
      city: cityExpr,
      country: countryExpr,
      // max, not sum: duplicate scope-copies of the same city row must not double-count.
      streams: sql<string>`coalesce(max(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
      superfans: sql<string>`coalesce(max(nullif(${analytics_metric_rows.metrics}->>'superfans', '')::numeric), 0)`,
      lastSeenAt: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
    })
    .from(analytics_metric_rows)
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      eq(analytics_metric_rows.widget_key, SISENSE_CITY_WIDGET),
      match,
    ))
    .groupBy(cityExpr, countryExpr);

  return rows.map((row) => ({
    city: row.city ?? "Unknown",
    country: row.country,
    streams: Number(row.streams ?? 0),
    superfans: Number(row.superfans ?? 0),
    lastSeenAt: toDate(row.lastSeenAt),
  }));
}

interface SisenseSourceAggregateRow {
  platform: "spotify" | "apple";
  source: string;
  streams: number;
  minDay: string | null;
  maxDay: string | null;
}

async function fetchSisenseSourceMix(orgId: string, match: SQL): Promise<SisenseSourceAggregateRow[]> {
  const sourceExpr = sql<string>`coalesce(
    ${analytics_metric_rows.dimensions}->>'source',
    ${analytics_metric_rows.dimensions}->>'source_of_stream',
    'Unknown')`;
  const validDay = sql`${analytics_metric_rows.dimensions}->>'_col0' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;
  const rows = await db
    .select({
      widgetKey: analytics_metric_rows.widget_key,
      source: sourceExpr,
      streams: sql<string>`coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0)`,
      minDay: sql<string | null>`min(${analytics_metric_rows.dimensions}->>'_col0') filter (where ${validDay})`,
      maxDay: sql<string | null>`max(${analytics_metric_rows.dimensions}->>'_col0') filter (where ${validDay})`,
    })
    .from(analytics_metric_rows)
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      inArray(analytics_metric_rows.widget_key, SISENSE_STREAM_SOURCE_WIDGETS),
      match,
    ))
    .groupBy(analytics_metric_rows.widget_key, sourceExpr);

  return rows.map((row) => ({
    platform: row.widgetKey === "apple-streams-source" ? "apple" as const : "spotify" as const,
    source: row.source ?? "Unknown",
    streams: Number(row.streams ?? 0),
    minDay: row.minDay,
    maxDay: row.maxDay,
  }));
}

interface SisenseDemographicsSourceRow {
  gender: string;
  age: string;
  streams: number | null;
  activeStreamRate: number | null;
  completionRate: number | null;
  lastSeenAt: Date | null;
}

async function fetchSisenseDemographicsRows(orgId: string, match: SQL): Promise<SisenseDemographicsSourceRow[]> {
  const rows = await db
    .select({
      gender: sql<string | null>`${analytics_metric_rows.dimensions}->>'gender'`,
      age: sql<string | null>`coalesce(${analytics_metric_rows.dimensions}->>'age', ${analytics_metric_rows.dimensions}->>'age_group')`,
      metrics: analytics_metric_rows.metrics,
      lastSeenAt: analytics_metric_rows.last_seen_at,
    })
    .from(analytics_metric_rows)
    .where(and(
      eq(analytics_metric_rows.org_id, orgId),
      eq(analytics_metric_rows.widget_key, SISENSE_DEMOGRAPHICS_WIDGET),
      match,
    ));

  return rows.map((row) => {
    const metrics = row.metrics as Record<string, string | number | null>;
    return {
      gender: row.gender?.trim() || "unknown",
      age: row.age?.trim() || "unknown",
      streams: nullableNumberMetric(metrics, "streams"),
      activeStreamRate: nullableNumberMetric(metrics, "active_stream_rate"),
      completionRate: nullableNumberMetric(metrics, "average_completion_rate"),
      lastSeenAt: toDate(row.lastSeenAt),
    };
  });
}

function buildSisenseDemographics(rows: SisenseDemographicsSourceRow[]): ArtistSisenseSection["demographics"] {
  if (!rows.length) return null;

  const latest = new Map<string, SisenseDemographicsSourceRow>();
  for (const row of rows) {
    const key = `${row.gender}|${row.age}`;
    const existing = latest.get(key);
    if (!existing || (row.lastSeenAt?.getTime() ?? 0) > (existing.lastSeenAt?.getTime() ?? 0)) {
      latest.set(key, row);
    }
  }
  const deduped = [...latest.values()];

  const genders = [...new Set(deduped.map((row) => row.gender))]
    .sort((a, b) => sisenseGenderRank(a) - sisenseGenderRank(b) || a.localeCompare(b));
  const ages = [...new Set(deduped.map((row) => row.age))]
    .sort((a, b) => sisenseAgeRank(a) - sisenseAgeRank(b) || a.localeCompare(b));

  return {
    genders,
    rows: ages.map((age) => ({
      age,
      cells: genders.map((gender) => {
        const cell = deduped.find((row) => row.gender === gender && row.age === age);
        return {
          gender,
          streams: cell?.streams ?? null,
          activeStreamRate: cell?.activeStreamRate ?? null,
          completionRate: cell?.completionRate ?? null,
        };
      }),
    })),
    asOf: isoDateOrNull(maxDate(deduped.map((row) => row.lastSeenAt))),
  };
}

function buildSourceMix(rows: SisenseSourceAggregateRow[]): NonNullable<ReleaseSisenseSection["sourceMix"]> {
  function forPlatform(platform: "spotify" | "apple") {
    const platformRows = rows.filter((row) => row.platform === platform);
    const total = platformRows.reduce((sum, row) => sum + row.streams, 0);
    const days = platformRows
      .flatMap((row) => [row.minDay, row.maxDay])
      .filter((value): value is string => Boolean(value));
    return {
      rows: platformRows
        .sort((a, b) => b.streams - a.streams)
        .map((row) => ({
          source: row.source,
          streams: row.streams,
          sharePct: total > 0 ? (row.streams / total) * 100 : 0,
        })),
      window: dateWindowOf(days),
    };
  }

  const spotify = forPlatform("spotify");
  const apple = forPlatform("apple");
  return {
    spotify: spotify.rows,
    apple: apple.rows,
    spotifyWindow: spotify.window,
    appleWindow: apple.window,
  };
}

function buildCrossPlatformDaily(rows: SisenseDatedPlatformRow[]): NonNullable<ArtistSisenseSection["crossPlatformStreams"]> {
  const byDay = new Map<string, { spotify: number | null; apple: number | null }>();
  let spotifyTotal = 0;
  let appleTotal = 0;
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { spotify: null, apple: null };
    entry[row.platform] = (entry[row.platform] ?? 0) + row.streams;
    byDay.set(row.day, entry);
    if (row.platform === "spotify") spotifyTotal += row.streams;
    else appleTotal += row.streams;
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, spotifyStreams: value.spotify, appleStreams: value.apple }));
  return { points, spotifyTotal, appleTotal, window: dateWindowOf(rows.map((row) => row.day)) };
}

function toWeeklyPoints(rows: SisenseDatedPlatformRow[]): SisenseWeeklyStreamsPoint[] {
  const weeks = new Map<string, { spotify: number | null; apple: number | null }>();
  for (const row of rows) {
    const weekStart = isoWeekStart(row.day);
    const entry = weeks.get(weekStart) ?? { spotify: null, apple: null };
    entry[row.platform] = (entry[row.platform] ?? 0) + row.streams;
    weeks.set(weekStart, entry);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, value]) => ({
      weekStart,
      spotifyStreams: value.spotify,
      appleStreams: value.apple,
    }));
}

function isoWeekStart(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function dateWindowOf(days: string[]): SisenseDateWindow {
  if (!days.length) return { from: null, to: null };
  const sorted = [...days].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

function isoDateOrNull(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function normalizeIsrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.length ? cleaned : null;
}

// ─── Artist 360 cross-release aggregation ──────────────────────────────

export async function listArtist360(
  orgId: string,
  artistId: string,
): Promise<Artist360Result | null> {
  const [artistRows, releaseRows] = await Promise.all([
    db
      .select({ name: artists.name })
      .from(artists)
      .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
      .limit(1),
    db
      .select({
        id: releases.id,
        title: releases.title,
        format: releases.format,
        releaseDate: sql<string | null>`${releases.release_date}`,
      })
      .from(releases)
      .where(and(eq(releases.org_id, orgId), eq(releases.artist_id, artistId)))
      .orderBy(releases.title),
  ]);

  if (!artistRows.length) return null;
  const artistName = artistRows[0].name;
  const match = buildArtistSisenseMatch(artistId, artistName);

  // Fetch daily streams, sources, cities, and per-release streams in parallel
  const [dailyResult, sourceResult, cityResult, releaseStreamResult] = await Promise.all([
    db.execute<{ day: string; streams: string }>(sql`
      select
        coalesce(
          amr.dimensions->>'_col0',
          amr.dimensions->>'date',
          amr.dimensions->>'day'
        ) as day,
        coalesce(sum(nullif(amr.metrics->>'streams', '')::numeric), 0) as streams
      from analytics_metric_rows amr
      where amr.org_id = ${orgId}
        and amr.widget_key in ('spotify-streams-source', 'apple-streams-source')
        and ${match}
        and coalesce(
          amr.dimensions->>'_col0',
          amr.dimensions->>'date',
          amr.dimensions->>'day'
        ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      group by 1
      order by 1
    `),
    db.execute<{ platform: string; source: string; streams: string }>(sql`
      select
        case
          when amr.widget_key = 'apple-streams-source' then 'apple'
          else 'spotify'
        end as platform,
        coalesce(
          amr.dimensions->>'source',
          amr.dimensions->>'source_of_stream',
          'Unknown'
        ) as source,
        coalesce(sum(nullif(amr.metrics->>'streams', '')::numeric), 0) as streams
      from analytics_metric_rows amr
      where amr.org_id = ${orgId}
        and amr.widget_key in ('spotify-streams-source', 'apple-streams-source')
        and ${match}
      group by 1, 2
      order by 3 desc
    `),
    db.execute<{ city: string; country: string | null; streams: string; superfans: string }>(sql`
      select
        coalesce(amr.dimensions->>'city', 'Unknown') as city,
        amr.dimensions->>'country' as country,
        coalesce(max(nullif(amr.metrics->>'streams', '')::numeric), 0) as streams,
        coalesce(max(nullif(amr.metrics->>'superfans', '')::numeric), 0) as superfans
      from analytics_metric_rows amr
      where amr.org_id = ${orgId}
        and amr.widget_key = 'spotify-superfans-active-streams-city'
        and ${match}
      group by amr.dimensions->>'city', amr.dimensions->>'country'
      order by 3 desc
      limit 10
    `),
    db.execute<{ releaseId: string; streams: string; previousStreams: string | null }>(sql`
      with release_streams as (
        select
          amr.release_id as "releaseId",
          coalesce(sum(nullif(amr.metrics->>'streams', '')::numeric), 0) as streams
        from analytics_metric_rows amr
        where amr.org_id = ${orgId}
          and amr.widget_key in ('spotify-streams-source', 'apple-streams-source')
          and amr.release_id is not null
          and ${match}
        group by amr.release_id
      )
      select
        rs."releaseId",
        rs.streams,
        null::numeric as "previousStreams"
      from release_streams rs
      order by rs.streams desc
    `),
  ]);

  const [playlistResult, shazamResult] = await Promise.all([
    db
      .select({ dimensions: analytics_metric_rows.dimensions, metrics: analytics_metric_rows.metrics })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "spotify-playlist-listings"),
        match,
      ))
      .orderBy(desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric`))
      .limit(12),
    db
      .select({ dimensions: analytics_metric_rows.dimensions, metrics: analytics_metric_rows.metrics })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "shazams-city"),
        match,
      ))
      .orderBy(desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'shazams', '')::numeric`))
      .limit(8),
  ]);

  // Release stream map for quick lookup
  const releaseStreams = new Map<string, number>();
  for (const row of (releaseStreamResult.rows ?? [])) {
    releaseStreams.set(row.releaseId, Number(row.streams ?? 0));
  }

  // Count tracks per release
  const trackCounts = await db
    .select({
      releaseId: tracks.release_id,
      trackCount: sql<string>`count(*)`,
    })
    .from(tracks)
    .where(
      and(
        eq(tracks.org_id, orgId),
        inArray(
          tracks.release_id,
          releaseRows.map((r) => r.id),
        ),
      ),
    )
    .groupBy(tracks.release_id);

  const trackCountMap = new Map<string, number>();
  for (const row of trackCounts) {
    if (row.releaseId) {
      trackCountMap.set(row.releaseId, Number(row.trackCount ?? 0));
    }
  }

  return buildArtist360({
    artistId,
    artistName,
    releases: releaseRows.map((r) => {
      const rs = releaseStreams.get(r.id) ?? 0;
      const ps = null; // TODO: implement period comparison
      return {
        id: r.id,
        title: r.title,
        format: r.format,
        releaseDate: r.releaseDate,
        trackCount: trackCountMap.get(r.id) ?? 0,
        streams: rs,
        changePct: ps !== null && ps > 0 ? (rs - ps) / ps : null,
      };
    }),
    dailyRows: (dailyResult.rows ?? []).map((row) => ({
      date: row.day,
      streams: Number(row.streams ?? 0),
    })),
    sourceRows: (sourceResult.rows ?? []).map((row) => ({
      source: row.source ?? "Unknown",
      platform: row.platform,
      streams: Number(row.streams ?? 0),
    })),
    cityRows: (cityResult.rows ?? []).map((row) => ({
      city: row.city ?? "Unknown",
      country: row.country,
      streams: Number(row.streams ?? 0),
      superfans: Number(row.superfans ?? 0),
    })),
    playlistRows: mapCanonicalArtistPlaylistRows(playlistResult as unknown as Parameters<typeof mapCanonicalArtistPlaylistRows>[0]),
    shazamRows: mapCanonicalArtistShazamRows(shazamResult as unknown as Parameters<typeof mapCanonicalArtistShazamRows>[0]),
  });
}

function sisenseGenderRank(gender: string): number {
  if (gender === "female") return 0;
  if (gender === "male") return 1;
  if (gender === "unknown") return 3;
  return 2;
}

function sisenseAgeRank(age: string): number {
  const parsed = Number.parseInt(age, 10);
  return Number.isFinite(parsed) ? parsed : 999;
}

// ─── Release Cockpit ───────────────────────────────────────────────────

export async function listReleaseCockpit(
  orgId: string,
  releaseId: string,
): Promise<ReleaseCockpit | null> {
  const [releaseRow] = await db
    .select({
      id: releases.id,
      title: releases.title,
      artistName: artists.name,
      format: releases.format,
      releaseDate: releases.release_date,
    })
    .from(releases)
    .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)))
    .limit(1);

  if (!releaseRow) return null;

  const trackRows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      position: tracks.position,
    })
    .from(tracks)
    .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, releaseId)))
    .orderBy(tracks.position);

  const match = await buildReleaseSisenseMatch(orgId, releaseId);

  const [dailySourceResult, trackGrowthRows, cityRows, playlistRows, shazamRows] = await Promise.all([
    db.execute<{
      date: string | Date;
      platform: string | null;
      source: string | null;
      streams: string | number | null;
    }>(sql`
      select
        ${analytics_metric_rows.dimensions}->>'_col0' as date,
        case
          when ${analytics_metric_rows.widget_key} = 'apple-streams-source' then 'apple'
          else 'spotify'
        end as platform,
        coalesce(
          ${analytics_metric_rows.dimensions}->>'source',
          ${analytics_metric_rows.dimensions}->>'source_of_stream',
          'Unknown'
        ) as source,
        coalesce(sum(nullif(${analytics_metric_rows.metrics}->>'streams', '')::numeric), 0) as streams
      from ${analytics_metric_rows}
      where ${analytics_metric_rows.org_id} = ${orgId}
        and ${analytics_metric_rows.widget_key} in ('spotify-streams-source', 'apple-streams-source')
        and ${analytics_metric_rows.dimensions}->>'_col0' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and ${match}
      group by
        ${analytics_metric_rows.widget_key},
        ${analytics_metric_rows.dimensions}->>'_col0',
        coalesce(
          ${analytics_metric_rows.dimensions}->>'source',
          ${analytics_metric_rows.dimensions}->>'source_of_stream',
          'Unknown'
        )
      order by date, platform, source
    `),
    db
      .select({
        dimensions: analytics_metric_rows.dimensions,
        metrics: analytics_metric_rows.metrics,
      })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "tracks-by-growth-rate"),
        match,
      ))
      .orderBy(desc(sql<number>`nullif(${analytics_metric_rows.metrics}->>'combined_streams', '')::numeric`))
      .limit(50),
    db
      .select({
        dimensions: analytics_metric_rows.dimensions,
        metrics: analytics_metric_rows.metrics,
      })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "spotify-superfans-active-streams-city"),
        match,
      ))
      .limit(30),
    db
      .select({
        dimensions: analytics_metric_rows.dimensions,
        metrics: analytics_metric_rows.metrics,
      })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "spotify-playlist-listings"),
        match,
      ))
      .limit(30),
    db
      .select({
        dimensions: analytics_metric_rows.dimensions,
        metrics: analytics_metric_rows.metrics,
      })
      .from(analytics_metric_rows)
      .where(and(
        eq(analytics_metric_rows.org_id, orgId),
        eq(analytics_metric_rows.widget_key, "shazams-city"),
        match,
      ))
      .limit(30),
  ]);

  const input: BuildReleaseCockpitInput = {
    releaseId: releaseRow.id,
    releaseTitle: releaseRow.title,
    artistName: releaseRow.artistName,
    format: releaseRow.format,
    releaseDate: releaseRow.releaseDate,
    trackCount: trackRows.length,
    dailySources: (dailySourceResult.rows ?? []) as any[],
    tracks: trackRows.map((t) => {
      const growthRow = trackGrowthRows.find(
        (r) => String(r.dimensions.track_title ?? "").trim().toLowerCase() === t.title.trim().toLowerCase(),
      );
      return {
        id: t.id,
        trackTitle: t.title,
        position: t.position,
        combinedStreams: growthRow ? numberMetric(growthRow.metrics as any, "combined_streams") : 0,
        spotifyStreams: growthRow ? numberMetric(growthRow.metrics as any, "spotify_streams") : 0,
        appleStreams: growthRow ? numberMetric(growthRow.metrics as any, "apple_streams") : 0,
        streamsGrowth: growthRow ? nullableNumberMetric(growthRow.metrics as any, "streams_growth") : null,
        combinedViews: growthRow ? numberMetric(growthRow.metrics as any, "combined_views") : 0,
      };
    }),
    cities: cityRows.map((row) => ({
      city: (row.dimensions.city ?? "Unknown") as string,
      country: (row.dimensions.country ?? null) as string | null,
      streams: Number(numberMetric(row.metrics as any, "streams")),
      superfans: 0,
    })),
    playlists: playlistRows.map((row) => ({
      playlistName: (row.dimensions.playlist__name ?? row.dimensions.playlist_name ?? "Unknown playlist") as string,
      ownerId: (row.dimensions.playlist__owner_id ?? row.dimensions.playlist_owner_id ?? null) as string | null,
      streams: numberMetric(row.metrics as any, "streams"),
      latestPosition: nullableNumberMetric(row.metrics as any, "latest_position"),
    })),
    shazams: shazamRows.map((row) => ({
      city: (row.dimensions.city ?? "Unknown") as string,
      trackTitle: (row.dimensions.track_title ?? "Unknown") as string,
      shazams: numberMetric(row.metrics as any, "shazams"),
    })),
  };

  const cockpit = buildReleaseCockpit(input);
  const quality = await loadTodayAnalyticsDataQuality(orgId).catch(error => {
    console.error("Release analytics quality unavailable", { errorType: error instanceof Error ? error.name : "Unknown" });
    return unavailableAnalyticsDataQualityReport();
  });
  const reportingThrough = cockpit.dataWindow.to ? new Date(cockpit.dataWindow.to) : null;
  cockpit.dataQuality = quality.health.coverage === "empty" ? "empty"
    : quality.health.coverage === "invalid" ? "unknown"
    : !quality.evidence.complete || quality.evidence.partial || quality.health.coverage !== "complete" ? "partial"
    : quality.health.degradedReasons.includes("repeated_failures") ? "failed"
    : !reportingThrough || quality.health.freshnessBasis === "unknown" ? "unknown"
    : quality.health.stale || isAnalyticsIngestionStale({ lastSuccessfulRunAt: quality.health.lastSuccessfulRunAt, reportingThrough, now: new Date() }) ? "stale"
    : "current";
  return cockpit;
}
