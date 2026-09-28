import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  analytics_import_files,
  analytics_import_runs,
  analytics_metric_changes,
  analytics_metric_rows,
  artists,
} from "../db/schema";
import { HttpError, NotFoundError } from "./errors";
import {
  runAnalyticsSourceImport,
  listLatestAnalyticsSourceImports,
  type AnalyticsSourceImportDatabase,
} from "./analytics-source-import";
import {
  parseSpotifyAudienceTimeline,
  SPOTIFY_AUDIENCE_AGGREGATION,
  SPOTIFY_AUDIENCE_RANGE,
  SPOTIFY_AUDIENCE_SOURCE,
  SPOTIFY_AUDIENCE_WIDGET,
  type SpotifyAudienceRow,
} from "./spotify-audience-timeline";

export interface SpotifyImportInput {
  orgId: string;
  artistId: string;
  expectedSha256: string;
  bytes: Uint8Array;
  fileName: string;
}

export interface LatestSpotifyAudienceImport {
  artistId: string;
  artistName: string;
  runId: string;
  fileName: string;
  sha256: string;
  rowCount: number;
  importedAt: string;
  reportingThrough: string;
}

export type SpotifyImportResult =
  | { kind: "duplicate"; runId: string; reportingThrough: string; latest: LatestSpotifyAudienceImport }
  | { kind: "imported"; runId: string; inserted: number; updated: number; unchanged: number; reportingThrough: string; latest: LatestSpotifyAudienceImport };

export interface SpotifySourceArchive {
  (input: { orgId: string; artistId: string; sha256: string; bytes: Uint8Array }): Promise<{ bucket: string; key: string }>;
}

export interface SpotifyAnalyticsImportDependencies {
  database: SpotifyAnalyticsDatabaseProvider;
  archive: SpotifySourceArchive;
  assertArchiveReady?: () => void;
  now: () => Date;
  randomId: () => string;
}

type DrizzleTransaction = any;
type SpotifyAnalyticsDatabaseProvider = () => Promise<AnalyticsSourceImportDatabase>;

function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function persistedRowKey(artistId: string, date: string): string {
  return `artist:${artistId}:date:${date}`;
}

function safeArtistStorageSegment(artistId: string): string {
  const original = artistId.trim();
  const sanitized = original.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "artist";
  return sanitized === original ? sanitized : `${sanitized}-${hashIdentity(original).slice(0, 12)}`;
}

export function spotifyAudienceArchiveKey(artistId: string, sha256: string): string {
  return `analytics/spotify-for-artists/${safeArtistStorageSegment(artistId)}/audience-timeline/${sha256}.csv`;
}

export function resolveSpotifyPrivateAnalyticsBucket(environment: Record<string, string | undefined>): string {
  const bucket = environment.R2_ANALYTICS_PRIVATE_BUCKET?.trim();
  if (!bucket) throw new Error("R2_ANALYTICS_PRIVATE_BUCKET is required for private Spotify analytics archives");
  if (bucket === environment.R2_BUCKET?.trim()) {
    throw new Error("R2_ANALYTICS_PRIVATE_BUCKET must be distinct from R2_BUCKET");
  }
  return bucket;
}

function importedAt(value: Date | null | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

function reportingThrough(metadata: Record<string, unknown> | null): string {
  return typeof metadata?.reporting_through === "string" ? metadata.reporting_through : "";
}

function latestFromRow(row: {
  artistId: string;
  artistName: string;
  runId: string;
  fileName: string;
  sha256: string;
  rowCount: number | null;
  completedAt: Date | null;
  startedAt: Date | null;
  metadata: Record<string, unknown> | null;
}): LatestSpotifyAudienceImport {
  return {
    artistId: row.artistId,
    artistName: row.artistName,
    runId: row.runId,
    fileName: row.fileName,
    sha256: row.sha256,
    rowCount: row.rowCount ?? 0,
    importedAt: importedAt(row.completedAt ?? row.startedAt),
    reportingThrough: reportingThrough(row.metadata),
  };
}

function latestSelection(tx: DrizzleTransaction, orgId: string) {
  return tx.select({
    artistId: analytics_import_runs.artist_id,
    artistName: artists.name,
    runId: analytics_import_runs.id,
    fileName: analytics_import_files.file_name,
    sha256: analytics_import_files.sha256,
    rowCount: analytics_import_files.row_count,
    completedAt: analytics_import_runs.completed_at,
    startedAt: analytics_import_runs.started_at,
    metadata: analytics_import_runs.metadata,
  })
    .from(analytics_import_runs)
    .innerJoin(analytics_import_files, and(
      eq(analytics_import_files.org_id, orgId),
      eq(analytics_import_files.run_id, analytics_import_runs.id),
      eq(analytics_import_files.source, SPOTIFY_AUDIENCE_SOURCE),
      eq(analytics_import_files.widget_key, SPOTIFY_AUDIENCE_WIDGET),
      eq(analytics_import_files.storage_status, "uploaded"),
    ))
    .innerJoin(artists, and(
      eq(artists.org_id, orgId),
      eq(artists.id, analytics_import_runs.artist_id),
    ));
}

function makeProductionTransaction(tx: DrizzleTransaction, orgId: string, observedAt: Date) {
  return {
    async findArtist(artistId: string) {
      const rows = await tx.select({ id: artists.id, name: artists.name })
        .from(artists)
        .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findSuccessfulDuplicate({ artistId, sha256 }: { artistId: string; sha256: string }) {
      const rows = await latestSelection(tx, orgId)
        .where(and(
          eq(analytics_import_runs.org_id, orgId),
          eq(analytics_import_runs.source, SPOTIFY_AUDIENCE_SOURCE),
          eq(analytics_import_runs.status, "completed"),
          eq(analytics_import_runs.artist_id, artistId),
          eq(analytics_import_files.artist_id, artistId),
          eq(analytics_import_files.sha256, sha256),
        ))
        .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.started_at))
        .limit(1);
      return rows[0] ? latestFromRow(rows[0]) : null;
    },

    async upsertRows({ runId, artistId, rows }: { runId: string; artistId: string; rows: SpotifyAudienceRow[] }) {
      return persistRowsSetBased(tx, { orgId, runId, artistId, rows, observedAt });
    },


  };
}

async function persistRowsSetBased(tx: DrizzleTransaction, input: {
  orgId: string;
  runId: string;
  artistId: string;
  rows: SpotifyAudienceRow[];
  observedAt: Date;
}): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const payload = input.rows.map((row) => {
    const rowKey = persistedRowKey(input.artistId, row.date);
    const metricId = `amr_${hashIdentity(`${input.orgId}:${SPOTIFY_AUDIENCE_SOURCE}:${SPOTIFY_AUDIENCE_WIDGET}:${input.artistId}:${row.date}`).slice(0, 40)}`;
    return {
      metric_id: metricId,
      insert_change_id: `amc_${hashIdentity(`${input.runId}:${metricId}:insert`).slice(0, 40)}`,
      update_change_id: `amc_${hashIdentity(`${input.runId}:${metricId}:update`).slice(0, 40)}`,
      row_key: rowKey,
      row_hash: row.rowHash,
      dimensions: { date: row.date },
      metrics: row.metrics,
      raw_row: row.rawRow,
    };
  });
  const result = await tx.execute(sql`
    with incoming as materialized (
      select *
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as staged(
        metric_id text,
        insert_change_id text,
        update_change_id text,
        row_key text,
        row_hash text,
        dimensions jsonb,
        metrics jsonb,
        raw_row jsonb
      )
    ),
    existing as materialized (
      select current.id, current.row_key, current.row_hash, current.raw_row
      from ${analytics_metric_rows} current
      inner join incoming staged on staged.row_key = current.row_key
      where current.org_id = ${input.orgId}
        and current.source = ${SPOTIFY_AUDIENCE_SOURCE}
        and current.widget_key = ${SPOTIFY_AUDIENCE_WIDGET}
        and current.artist_id = ${input.artistId}
        and current.requested_aggregation = ${SPOTIFY_AUDIENCE_AGGREGATION}
        and current.requested_date_range = ${SPOTIFY_AUDIENCE_RANGE}
    ),
    inserted as (
      insert into ${analytics_metric_rows} (
        id, org_id, source, widget_key, artist_id, row_key, row_hash,
        requested_date_range, requested_aggregation, dimensions, metrics, raw_row,
        first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
      )
      select staged.metric_id, ${input.orgId}, ${SPOTIFY_AUDIENCE_SOURCE}, ${SPOTIFY_AUDIENCE_WIDGET},
        ${input.artistId}, staged.row_key, staged.row_hash, ${SPOTIFY_AUDIENCE_RANGE},
        ${SPOTIFY_AUDIENCE_AGGREGATION}, staged.dimensions, staged.metrics, staged.raw_row,
        ${input.runId}, ${input.runId}, ${input.observedAt}, ${input.observedAt}
      from incoming staged
      left join existing previous on previous.row_key = staged.row_key
      where previous.id is null
      on conflict (org_id, source, widget_key, requested_aggregation, requested_date_range, row_key) do nothing
      returning id, row_key
    ),
    updated as (
      update ${analytics_metric_rows} current
      set row_hash = staged.row_hash,
          dimensions = staged.dimensions,
          metrics = staged.metrics,
          raw_row = staged.raw_row,
          last_seen_run_id = ${input.runId},
          last_seen_at = ${input.observedAt}
      from existing previous
      inner join incoming staged on staged.row_key = previous.row_key
      where current.id = previous.id
        and previous.row_hash is distinct from staged.row_hash
      returning current.id, current.row_key
    ),
    unchanged as (
      update ${analytics_metric_rows} current
      set last_seen_run_id = ${input.runId},
          last_seen_at = ${input.observedAt}
      from existing previous
      inner join incoming staged on staged.row_key = previous.row_key
      where current.id = previous.id
        and previous.row_hash is not distinct from staged.row_hash
      returning current.id
    ),
    inserted_changes as (
      insert into ${analytics_metric_changes} (
        id, org_id, run_id, metric_row_id, source, widget_key, artist_id, row_key,
        change_type, previous_hash, current_hash, previous_raw_row, current_raw_row, changed_at
      )
      select staged.insert_change_id, ${input.orgId}, ${input.runId}, added.id,
        ${SPOTIFY_AUDIENCE_SOURCE}, ${SPOTIFY_AUDIENCE_WIDGET}, ${input.artistId}, staged.row_key,
        'insert', null, staged.row_hash, null, staged.raw_row, ${input.observedAt}
      from inserted added
      inner join incoming staged on staged.row_key = added.row_key
      returning id
    ),
    updated_changes as (
      insert into ${analytics_metric_changes} (
        id, org_id, run_id, metric_row_id, source, widget_key, artist_id, row_key,
        change_type, previous_hash, current_hash, previous_raw_row, current_raw_row, changed_at
      )
      select staged.update_change_id, ${input.orgId}, ${input.runId}, changed.id,
        ${SPOTIFY_AUDIENCE_SOURCE}, ${SPOTIFY_AUDIENCE_WIDGET}, ${input.artistId}, staged.row_key,
        'update', previous.row_hash, staged.row_hash, previous.raw_row, staged.raw_row, ${input.observedAt}
      from updated changed
      inner join existing previous on previous.id = changed.id
      inner join incoming staged on staged.row_key = previous.row_key
      returning id
    )
    select
      (select count(*)::int from inserted) as inserted,
      (select count(*)::int from updated) as updated,
      (select count(*)::int from unchanged) as unchanged,
      (select count(*)::int from inserted_changes) + (select count(*)::int from updated_changes) as changes
  `);
  const counts = result.rows?.[0] ?? result[0];
  return {
    inserted: Number(counts?.inserted ?? 0),
    updated: Number(counts?.updated ?? 0),
    unchanged: Number(counts?.unchanged ?? 0),
  };
}

const productionArchive: SpotifySourceArchive = async ({ orgId, artistId, sha256, bytes }) => {
  const { getStorageClient, tenantStorageKey } = await import("./storage");
  const bucket = resolveSpotifyPrivateAnalyticsBucket(process.env);
  const key = tenantStorageKey(orgId, spotifyAudienceArchiveKey(artistId, sha256));
  await getStorageClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: "text/csv; charset=utf-8",
  }));
  return { bucket, key };
};

const productionNow = () => new Date();
const productionRandomId = () => randomUUID();
const productionDatabaseProvider: SpotifyAnalyticsDatabaseProvider = async () => (await import("../lib/db")).db;

const productionDependencies: SpotifyAnalyticsImportDependencies = {
  database: productionDatabaseProvider,
  archive: productionArchive,
  assertArchiveReady: () => { resolveSpotifyPrivateAnalyticsBucket(process.env); },
  now: productionNow,
  randomId: productionRandomId,
};

export function createSpotifyAnalyticsImportProductionService(input: {
  database: AnalyticsSourceImportDatabase;
  archive: SpotifySourceArchive;
  now?: () => Date;
  randomId?: () => string;
}) {
  const now = input.now ?? productionNow;
  const randomId = input.randomId ?? productionRandomId;
  return createSpotifyAnalyticsImportService({
    database: async () => input.database,
    archive: input.archive,
    now,
    randomId,
  });
}

export function createSpotifyAnalyticsImportService(dependencies = productionDependencies) {
  return {
    async applySpotifyAudienceTimeline(input: SpotifyImportInput): Promise<SpotifyImportResult> {
      const parsed = parseSpotifyAudienceTimeline(input.bytes, input.fileName);
      if (parsed.sha256 !== input.expectedSha256) {
        throw new HttpError("Spotify audience preview no longer matches the selected file", 409);
      }

      type SpotifyImportContext = {
        artist: { id: string; name: string };
        parsed: typeof parsed;
      };
      type SpotifyLifecycleInput = SpotifyImportInput & { parsed: typeof parsed };
      const lifecycleInput: SpotifyLifecycleInput = { ...input, parsed };

      return runAnalyticsSourceImport<
        SpotifyLifecycleInput,
        SpotifyImportContext,
        ReturnType<typeof makeProductionTransaction>,
        LatestSpotifyAudienceImport,
        SpotifyImportResult
      >({
        database: dependencies.database,
        source: SPOTIFY_AUDIENCE_SOURCE,
        lock: "wait",
        transaction: makeProductionTransaction,
        assertArchiveReady: dependencies.assertArchiveReady,
        now: dependencies.now,
        randomId: dependencies.randomId,
        getOrgId: (value) => value.orgId,
        verifyTenant: async (tx, value) => {
          const artist = await tx.findArtist(value.artistId);
          if (!artist) throw new NotFoundError("Artist not found in active workspace");
          return { artist, parsed: value.parsed };
        },
        findSuccessfulDuplicate: (tx, context) => tx.findSuccessfulDuplicate({
          artistId: context.artist.id,
          sha256: context.parsed.sha256,
        }),
        duplicateResult: (_tx, duplicate) => ({
          kind: "duplicate" as const,
          runId: duplicate.runId,
          reportingThrough: duplicate.reportingThrough,
          latest: duplicate,
        }),
        runEvidence: (context, observedAt) => ({
          artist_id: context.artist.id,
          requested_date_range: `${context.parsed.dateFrom}..${context.parsed.dateThrough}`,
          requested_aggregation: SPOTIFY_AUDIENCE_AGGREGATION,
          metadata: {
            export_type: "audience_timeline",
            canonical_range: SPOTIFY_AUDIENCE_RANGE,
            reporting_through: context.parsed.dateThrough,
            observed_at: observedAt.toISOString(),
          },
        }),
        archive: (value, context) => dependencies.archive({
          orgId: value.orgId,
          artistId: context.artist.id,
          sha256: context.parsed.sha256,
          bytes: value.bytes,
        }),
        fileEvidence: (context) => ({
          artist_id: context.artist.id,
          widget_key: SPOTIFY_AUDIENCE_WIDGET,
          widget_title: "Audience timeline",
          file_name: context.parsed.fileName,
          sha256: context.parsed.sha256,
          byte_size: context.parsed.byteSize,
          row_count: context.parsed.rowCount,
          headers: context.parsed.headers,
          requested_date_range: `${context.parsed.dateFrom}..${context.parsed.dateThrough}`,
          requested_aggregation: SPOTIFY_AUDIENCE_AGGREGATION,
        }),
        persistRows: (tx, context, runId) => tx.upsertRows({
          runId,
          artistId: context.artist.id,
          rows: context.parsed.rows,
        }),
        importedResult: (context, runId, counts, observedAt) => {
          const latest: LatestSpotifyAudienceImport = {
            artistId: context.artist.id,
            artistName: context.artist.name,
            runId,
            fileName: context.parsed.fileName,
            sha256: context.parsed.sha256,
            rowCount: context.parsed.rowCount,
            importedAt: observedAt.toISOString(),
            reportingThrough: context.parsed.dateThrough,
          };
          return {
            kind: "imported" as const,
            runId,
            ...counts,
            reportingThrough: context.parsed.dateThrough,
            latest,
          };
        },
        failureEvidence: (value, context, phase, observedAt) => ({
          run: {
            artist_id: context?.artist.id ?? null,
            requested_date_range: `${value.parsed.dateFrom}..${value.parsed.dateThrough}`,
            requested_aggregation: SPOTIFY_AUDIENCE_AGGREGATION,
            metadata: {
              export_type: "audience_timeline",
              canonical_range: SPOTIFY_AUDIENCE_RANGE,
              reporting_through: value.parsed.dateThrough,
              observed_at: observedAt.toISOString(),
              file_name: value.parsed.fileName,
              sha256: value.parsed.sha256,
            },
          },
          file: {
            artist_id: context?.artist.id ?? null,
            widget_key: SPOTIFY_AUDIENCE_WIDGET,
            widget_title: "Audience timeline",
            requested_date_range: `${value.parsed.dateFrom}..${value.parsed.dateThrough}`,
            requested_aggregation: SPOTIFY_AUDIENCE_AGGREGATION,
            file_name: value.parsed.fileName,
            sha256: value.parsed.sha256,
            byte_size: value.parsed.byteSize,
            row_count: value.parsed.rowCount,
            headers: value.parsed.headers,
          },
          error: `Spotify audience import failed during ${phase}`,
        }),
        shouldRecordFailure: (error) => !(error instanceof NotFoundError),
      }, lifecycleInput);
    },

    async listLatestSpotifyAudienceImports(orgId: string): Promise<LatestSpotifyAudienceImport[]> {
      const rows = await listLatestAnalyticsSourceImports(dependencies.database, orgId, SPOTIFY_AUDIENCE_SOURCE, SPOTIFY_AUDIENCE_WIDGET, "wait", false);
      return rows.map(latestFromRow);
    },
  };
}
