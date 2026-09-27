import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  analytics_import_files,
  analytics_import_runs,
  analytics_metric_changes,
  analytics_metric_rows,
  artists,
  releases,
  tracks,
} from "../db/schema";
import { HttpError } from "./errors";
import {
  runAnalyticsSourceImport,
  withAnalyticsSourceTransaction,
  type AnalyticsSourceImportDatabase,
  type AnalyticsSourceImportFailurePhase,
} from "./analytics-source-import";
import {
  parseSisenseTrackSnapshot,
  SISENSE_TRACK_SOURCE,
  SISENSE_TRACK_WIDGET,
} from "./sisense-track-snapshot";
import {
  previewSisenseTrackSnapshot,
  SisenseTrackSnapshotPreviewAmbiguityError,
  type ResolvedSisenseTrackRow,
  type SisenseTrackPreviewStore,
  type SisenseTrackSnapshotPreview,
} from "./sisense-track-snapshot-preview";

export interface SisenseTrackSnapshotPreviewRequest {
  orgId: string;
  artistId: string;
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
  bytes: Uint8Array;
  fileName: string;
}

export interface SisenseTrackSnapshotApplyInput extends SisenseTrackSnapshotPreviewRequest {
  expectedSha256: string;
  expectedPreviewFingerprint: string;
  includeUnmatched: boolean;
}

export interface SisenseTrackSnapshotIdentitySample {
  sourceRow: number;
  trackTitle: string;
  primaryArtist: string;
  releaseTitle: string | null;
  isrc: string | null;
  matchStatus: "matched" | "unmatched";
  trackId: string | null;
}

export type BoundSisenseTrackSnapshotPreview = Omit<
  SisenseTrackSnapshotPreview,
  "rows" | "ambiguities"
> & {
  previewFingerprint: string;
  identitySamples: {
    items: SisenseTrackSnapshotIdentitySample[];
    total: number;
    truncated: boolean;
  };
};

export interface LatestSisenseTrackSnapshotImport {
  artistId: string;
  artistName: string;
  runId: string;
  fileName: string;
  sha256: string;
  rowCount: number;
  importedAt: string;
  reportingFrom: string;
  reportingThrough: string;
  requestedDateRange: string;
  aggregation: string;
  counts: SisenseTrackSnapshotPreview["counts"];
  totals: SisenseTrackSnapshotPreview["totals"];
}

export type SisenseTrackSnapshotApplyResult =
  | {
    kind: "duplicate";
    /** The completed run matched by this exact replay; `latest` may identify a newer correction. */
    runId: string;
    /** Authoritative latest completed evidence for the artist at replay time. */
    latest: LatestSisenseTrackSnapshotImport;
  }
  | {
    kind: "imported";
    runId: string;
    inserted: number;
    updated: number;
    unchanged: number;
    latest: LatestSisenseTrackSnapshotImport;
  };

export interface SisenseTrackSnapshotArchive {
  (input: {
    orgId: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    sha256: string;
    bytes: Uint8Array;
  }): Promise<{ bucket: string; key: string }>;
}

interface SisenseTrackRunMetadata extends Record<string, unknown> {
  export_type: "tracks_by_growth_rate";
  reporting_from: string;
  reporting_through: string;
  observed_at: string;
  counts: SisenseTrackSnapshotPreview["counts"];
  totals: SisenseTrackSnapshotPreview["totals"];
}

export type SisenseTrackSnapshotImportTransaction = SisenseTrackPreviewStore & {
  findSuccessfulDuplicate(input: {
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    sha256: string;
  }): Promise<LatestSisenseTrackSnapshotImport | null>;
  findLatestSuccessful(input: { artistId: string }): Promise<LatestSisenseTrackSnapshotImport | null>;
  createRun(input: {
    id: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    metadata: SisenseTrackRunMetadata;
  }): Promise<void>;
  recordFile(input: {
    id: string;
    runId: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    fileName: string;
    sha256: string;
    byteSize: number;
    rowCount: number;
    headers: string[];
    storageBucket: string;
    storageKey: string;
  }): Promise<void>;
  upsertRows(input: {
    runId: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    rows: ResolvedSisenseTrackRow[];
  }): Promise<{ inserted: number; updated: number; unchanged: number }>;
  completeRun(input: {
    runId: string;
    inserted: number;
    updated: number;
    unchanged: number;
  }): Promise<void>;
};

export interface SisenseTrackSnapshotImportStore {
  withPreviewTransaction<T>(
    orgId: string,
    work: (store: SisenseTrackPreviewStore) => Promise<T>,
  ): Promise<T>;
  withLockedTransaction<T>(
    orgId: string,
    work: (tx: SisenseTrackSnapshotImportTransaction) => Promise<T>,
  ): Promise<T>;
  recordFailedRun(input: SisenseTrackSnapshotFailedEvidence): Promise<void>;
  listLatestByArtist(orgId: string): Promise<LatestSisenseTrackSnapshotImport[]>;
}

export interface SisenseTrackSnapshotFailedEvidence {
  runId: string;
  fileId: string;
  orgId: string;
  artistId: string | null;
  fileName: string;
  sha256: string;
  byteSize: number;
  rowCount: number;
  headers: string[];
  requestedDateRange: string;
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
  counts: SisenseTrackSnapshotPreview["counts"] | null;
  totals: SisenseTrackSnapshotPreview["totals"] | null;
  archivedFile: { storageBucket: string; storageKey: string } | null;
  error: string;
}

export interface SisenseTrackSnapshotServiceDependencies {
  store: SisenseTrackSnapshotImportStore;
  archive: SisenseTrackSnapshotArchive;
  assertArchiveReady?: () => void;
  now: () => Date;
  randomId: () => string;
}

export interface SisenseTrackSnapshotProductionAdapter {
  previewStore(tx: DrizzleTransaction, orgId: string): SisenseTrackPreviewStore;
  importTransaction(
    tx: DrizzleTransaction,
    orgId: string,
    observedAt: Date,
  ): any;
  recordFailedRun(
    tx: DrizzleTransaction,
    input: SisenseTrackSnapshotFailedEvidence,
    observedAt: Date,
  ): Promise<void>;
  listLatestByArtist(
    tx: DrizzleTransaction,
    orgId: string,
  ): Promise<LatestSisenseTrackSnapshotImport[]>;
}

type DrizzleTransaction = any;
type SisenseTrackSnapshotDatabaseProvider = () => Promise<AnalyticsSourceImportDatabase>;
const SISENSE_TRACK_WIDGET_TITLE = "Tracks by Growth Rate";
const SISENSE_TRACK_EXPECTED_CLIENT_ERROR = "SISENSE_TRACK_EXPECTED_CLIENT_ERROR";
const SISENSE_TRACK_LOCKED_ERROR = "SISENSE_TRACK_LOCKED";
const EMPTY_COUNTS: SisenseTrackSnapshotPreview["counts"] = {
  sourceRows: 0,
  uniqueTracks: 0,
  matched: 0,
  unmatched: 0,
  ambiguous: 0,
  exactDuplicates: 0,
};
const EMPTY_TOTALS: SisenseTrackSnapshotPreview["totals"] = {
  combinedStreams: 0,
  combinedViews: 0,
};

function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeSegment(value: string): string {
  const original = value.trim();
  const sanitized = original
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "artist";
  return sanitized === original ? sanitized : `${sanitized}-${hashIdentity(original).slice(0, 12)}`;
}

export function sisenseTrackArchiveKey(artistId: string, range: string, sha256: string): string {
  return `analytics/sisense/${safeSegment(artistId)}/tracks-by-growth-rate/${hashIdentity(range).slice(0, 16)}/${sha256}.csv`;
}

export function resolveSisenseTrackPrivateAnalyticsBucket(
  environment: Record<string, string | undefined>,
): string {
  const bucket = environment.R2_ANALYTICS_PRIVATE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("R2_ANALYTICS_PRIVATE_BUCKET is required for private Sisense analytics archives");
  }
  if (bucket === environment.R2_BUCKET?.trim()) {
    throw new Error("R2_ANALYTICS_PRIVATE_BUCKET must be distinct from R2_BUCKET");
  }
  return bucket;
}

function safeFailureMessage(phase: AnalyticsSourceImportFailurePhase): string {
  return `Sisense track snapshot import failed during ${phase}`;
}

function expectedClientError(message: string, status: number): HttpError {
  return new HttpError(message, status, SISENSE_TRACK_EXPECTED_CLIENT_ERROR);
}

function isKnownPreSideEffectClientError(error: unknown): error is HttpError {
  if (!(error instanceof HttpError)) return false;
  if (error.code === SISENSE_TRACK_EXPECTED_CLIENT_ERROR || error.code === SISENSE_TRACK_LOCKED_ERROR) {
    return true;
  }
  if (error instanceof SisenseTrackSnapshotPreviewAmbiguityError) return true;
  return (
    (error.status === 404 && error.message === "Artist not found in active organization")
    || (error.status === 400 && error.message === "Sisense snapshot totals exceed safe integer range")
  );
}

export function sisenseTrackPreviewFingerprint(
  orgId: string,
  preview: SisenseTrackSnapshotPreview,
): string {
  const resolvedRows = preview.rows
    .map((row) => [
      row.persistedRowKey,
      row.rowHash,
      row.matchStatus,
      row.trackId,
    ] as const)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const canonical = {
    version: 1,
    organization_id: orgId,
    artist_id: preview.artistId,
    file_sha256: preview.sha256,
    reporting_from: preview.reportingFrom,
    reporting_through: preview.reportingThrough,
    requested_date_range: preview.requestedDateRange,
    aggregation: preview.aggregation,
    counts: {
      source_rows: preview.counts.sourceRows,
      unique_tracks: preview.counts.uniqueTracks,
      matched: preview.counts.matched,
      unmatched: preview.counts.unmatched,
      ambiguous: preview.counts.ambiguous,
      exact_duplicates: preview.counts.exactDuplicates,
    },
    totals: {
      combined_streams: preview.totals.combinedStreams,
      combined_views: preview.totals.combinedViews,
    },
    ambiguity_free: preview.ambiguities.length === 0,
    resolved_rows: resolvedRows,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const SISENSE_TRACK_MAX_IDENTITY_SAMPLES = 20;
const SISENSE_TRACK_MAX_IDENTITY_SAMPLES_PER_STATUS = 10;
const SISENSE_TRACK_MAX_SAMPLE_TEXT_LENGTH = 160;

function sanitizedSampleText(value: string): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= SISENSE_TRACK_MAX_SAMPLE_TEXT_LENGTH) return sanitized;
  return `${sanitized.slice(0, SISENSE_TRACK_MAX_SAMPLE_TEXT_LENGTH - 1)}…`;
}

function identitySample(row: ResolvedSisenseTrackRow): SisenseTrackSnapshotIdentitySample {
  return {
    sourceRow: row.sourceRow,
    trackTitle: sanitizedSampleText(row.trackTitle),
    primaryArtist: sanitizedSampleText(row.primaryArtist),
    releaseTitle: row.releaseTitle === null ? null : sanitizedSampleText(row.releaseTitle),
    isrc: row.isrc === null ? null : sanitizedSampleText(row.isrc),
    matchStatus: row.matchStatus,
    trackId: row.trackId,
  };
}

function identitySamples(rows: ResolvedSisenseTrackRow[]): BoundSisenseTrackSnapshotPreview["identitySamples"] {
  const selected = [
    ...rows.filter((row) => row.matchStatus === "matched")
      .slice(0, SISENSE_TRACK_MAX_IDENTITY_SAMPLES_PER_STATUS),
    ...rows.filter((row) => row.matchStatus === "unmatched")
      .slice(0, SISENSE_TRACK_MAX_IDENTITY_SAMPLES_PER_STATUS),
  ];
  const selectedRows = new Set(selected.map((row) => row.sourceRow));
  for (const row of rows) {
    if (selected.length >= SISENSE_TRACK_MAX_IDENTITY_SAMPLES) break;
    if (!selectedRows.has(row.sourceRow)) {
      selected.push(row);
      selectedRows.add(row.sourceRow);
    }
  }
  const items = selected
    .sort((left, right) => left.sourceRow - right.sourceRow)
    .map(identitySample);
  return { items, total: rows.length, truncated: rows.length > items.length };
}

function bindPreview(
  orgId: string,
  preview: SisenseTrackSnapshotPreview,
): BoundSisenseTrackSnapshotPreview {
  return {
    kind: preview.kind,
    artistId: preview.artistId,
    artistName: preview.artistName,
    fileName: preview.fileName,
    sha256: preview.sha256,
    requestedDateRange: preview.requestedDateRange,
    reportingFrom: preview.reportingFrom,
    reportingThrough: preview.reportingThrough,
    aggregation: preview.aggregation,
    counts: preview.counts,
    totals: preview.totals,
    previewFingerprint: sisenseTrackPreviewFingerprint(orgId, preview),
    identitySamples: identitySamples(preview.rows),
  };
}

function recordRows(result: unknown): any[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows;
  }
  return Array.isArray(result) ? result : [];
}

function stringMetadata(
  metadata: Record<string, unknown> | null,
  key: string,
  fallback = "",
): string {
  return typeof metadata?.[key] === "string" ? metadata[key] : fallback;
}

function countsMetadata(metadata: Record<string, unknown> | null): SisenseTrackSnapshotPreview["counts"] {
  const counts = metadata?.counts;
  if (!counts || typeof counts !== "object") return EMPTY_COUNTS;
  const candidate = counts as Record<string, unknown>;
  return {
    sourceRows: Number(candidate.sourceRows ?? 0),
    uniqueTracks: Number(candidate.uniqueTracks ?? 0),
    matched: Number(candidate.matched ?? 0),
    unmatched: Number(candidate.unmatched ?? 0),
    ambiguous: Number(candidate.ambiguous ?? 0),
    exactDuplicates: Number(candidate.exactDuplicates ?? 0),
  };
}

function totalsMetadata(metadata: Record<string, unknown> | null): SisenseTrackSnapshotPreview["totals"] {
  const totals = metadata?.totals;
  if (!totals || typeof totals !== "object") return EMPTY_TOTALS;
  const candidate = totals as Record<string, unknown>;
  return {
    combinedStreams: Number(candidate.combinedStreams ?? 0),
    combinedViews: Number(candidate.combinedViews ?? 0),
  };
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
  requestedDateRange: string | null;
  aggregation: string | null;
  metadata: Record<string, unknown> | null;
}): LatestSisenseTrackSnapshotImport {
  return {
    artistId: row.artistId,
    artistName: row.artistName,
    runId: row.runId,
    fileName: row.fileName,
    sha256: row.sha256,
    rowCount: Number(row.rowCount ?? 0),
    importedAt: (row.completedAt ?? row.startedAt ?? new Date(0)).toISOString(),
    reportingFrom: stringMetadata(row.metadata, "reporting_from"),
    reportingThrough: stringMetadata(row.metadata, "reporting_through"),
    requestedDateRange: row.requestedDateRange ?? "",
    aggregation: row.aggregation ?? "",
    counts: countsMetadata(row.metadata),
    totals: totalsMetadata(row.metadata),
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
    requestedDateRange: analytics_import_runs.requested_date_range,
    aggregation: analytics_import_runs.requested_aggregation,
    metadata: analytics_import_runs.metadata,
  })
    .from(analytics_import_runs)
    .innerJoin(analytics_import_files, and(
      eq(analytics_import_files.org_id, orgId),
      eq(analytics_import_files.run_id, analytics_import_runs.id),
      eq(analytics_import_files.source, SISENSE_TRACK_SOURCE),
      eq(analytics_import_files.widget_key, SISENSE_TRACK_WIDGET),
      eq(analytics_import_files.storage_status, "uploaded"),
    ))
    .innerJoin(artists, and(
      eq(artists.org_id, orgId),
      eq(artists.id, analytics_import_runs.artist_id),
    ));
}

function productionPreviewStore(tx: DrizzleTransaction, orgId: string): SisenseTrackPreviewStore {
  return {
    async findArtist({ orgId: requestedOrgId, artistId }) {
      if (requestedOrgId !== orgId) throw new HttpError("Organization scope mismatch", 403);
      const rows = await tx.select({ id: artists.id, name: artists.name })
        .from(artists)
        .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findTracksByIsrc({ orgId: requestedOrgId, artistId, isrcs }) {
      if (requestedOrgId !== orgId) throw new HttpError("Organization scope mismatch", 403);
      if (isrcs.length === 0) return [];
      const result = await tx.execute(sql`
        with requested as materialized (
          select value as isrc
          from jsonb_array_elements_text(${JSON.stringify(isrcs)}::jsonb)
        )
        select distinct
          candidate.id as "id",
          release.artist_id as "artistId",
          candidate.isrc as "isrc",
          candidate.title as "title",
          release.title as "releaseTitle"
        from ${tracks} candidate
        inner join ${releases} release
          on release.id = candidate.release_id
         and release.org_id = ${orgId}
         and release.artist_id = ${artistId}
        inner join requested
          on requested.isrc = upper(regexp_replace(coalesce(candidate.isrc, ''), '[^a-zA-Z0-9]', '', 'g'))
        where candidate.org_id = ${orgId}
      `);
      return recordRows(result);
    },

    async findTracksByIdentity({ orgId: requestedOrgId, artistId, identities }) {
      if (requestedOrgId !== orgId) throw new HttpError("Organization scope mismatch", 403);
      if (identities.length === 0) return [];
      const result = await tx.execute(sql`
        with requested as materialized (
          select *
          from jsonb_to_recordset(${JSON.stringify(identities)}::jsonb) as identity(
            "trackTitle" text,
            "releaseTitle" text
          )
        )
        select distinct
          candidate.id as "id",
          release.artist_id as "artistId",
          candidate.isrc as "isrc",
          candidate.title as "title",
          release.title as "releaseTitle"
        from ${tracks} candidate
        inner join ${releases} release
          on release.id = candidate.release_id
         and release.org_id = ${orgId}
         and release.artist_id = ${artistId}
        inner join requested identity
          on lower(regexp_replace(btrim(candidate.title), '\\s+', ' ', 'g')) = identity."trackTitle"
         and (
           identity."releaseTitle" is null
           or lower(regexp_replace(btrim(release.title), '\\s+', ' ', 'g')) = identity."releaseTitle"
         )
        where candidate.org_id = ${orgId}
      `);
      return recordRows(result);
    },
  };
}

function productionImportTransaction(
  tx: DrizzleTransaction,
  orgId: string,
  observedAt: Date,
): SisenseTrackSnapshotImportTransaction {
  return {
    ...productionPreviewStore(tx, orgId),

    async findSuccessfulDuplicate({ artistId, requestedDateRange, aggregation, sha256 }) {
      const rows = await latestSelection(tx, orgId)
        .where(and(
          eq(analytics_import_runs.org_id, orgId),
          eq(analytics_import_runs.source, SISENSE_TRACK_SOURCE),
          eq(analytics_import_runs.mode, "manual_import"),
          eq(analytics_import_runs.status, "completed"),
          eq(analytics_import_runs.artist_id, artistId),
          eq(analytics_import_runs.requested_date_range, requestedDateRange),
          eq(analytics_import_runs.requested_aggregation, aggregation),
          eq(analytics_import_files.artist_id, artistId),
          eq(analytics_import_files.requested_date_range, requestedDateRange),
          eq(analytics_import_files.requested_aggregation, aggregation),
          eq(analytics_import_files.sha256, sha256),
        ))
        .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.started_at))
        .limit(1);
      return rows[0] ? latestFromRow(rows[0]) : null;
    },

    async findLatestSuccessful({ artistId }) {
      const rows = await latestSelection(tx, orgId)
        .where(and(
          eq(analytics_import_runs.org_id, orgId),
          eq(analytics_import_runs.source, SISENSE_TRACK_SOURCE),
          eq(analytics_import_runs.mode, "manual_import"),
          eq(analytics_import_runs.status, "completed"),
          eq(analytics_import_runs.artist_id, artistId),
          eq(analytics_import_files.artist_id, artistId),
        ))
        .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.started_at))
        .limit(1);
      return rows[0] ? latestFromRow(rows[0]) : null;
    },

    async createRun({ id, artistId, requestedDateRange, aggregation, metadata }) {
      await tx.insert(analytics_import_runs).values({
        id,
        org_id: orgId,
        source: SISENSE_TRACK_SOURCE,
        artist_id: artistId,
        mode: "manual_import",
        requested_date_range: requestedDateRange,
        requested_aggregation: aggregation,
        status: "running",
        started_at: observedAt,
        metadata,
      });
    },

    async recordFile(input) {
      await tx.insert(analytics_import_files).values({
        id: input.id,
        org_id: orgId,
        run_id: input.runId,
        source: SISENSE_TRACK_SOURCE,
        widget_key: SISENSE_TRACK_WIDGET,
        widget_title: SISENSE_TRACK_WIDGET_TITLE,
        artist_id: input.artistId,
        requested_date_range: input.requestedDateRange,
        requested_aggregation: input.aggregation,
        file_name: input.fileName,
        storage_bucket: input.storageBucket,
        storage_key: input.storageKey,
        storage_status: "uploaded",
        storage_uploaded_at: observedAt,
        sha256: input.sha256,
        byte_size: input.byteSize,
        row_count: input.rowCount,
        headers: input.headers,
        created_at: observedAt,
      });
    },

    async upsertRows(input) {
      return persistSisenseTrackSnapshotRowsSetBased(tx, {
        orgId,
        observedAt,
        ...input,
      });
    },

    async completeRun({ runId, inserted, updated, unchanged }) {
      await tx.update(analytics_import_runs).set({
        status: "completed",
        completed_at: observedAt,
        files_downloaded: 1,
        rows_imported: inserted + updated + unchanged,
        rows_inserted: inserted,
        rows_updated: updated,
        rows_unchanged: unchanged,
        error: null,
      }).where(and(
        eq(analytics_import_runs.org_id, orgId),
        eq(analytics_import_runs.id, runId),
      ));
    },
  };
}

export async function persistSisenseTrackSnapshotRowsSetBased(
  tx: Pick<DrizzleTransaction, "execute">,
  input: {
    orgId: string;
    runId: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    rows: ResolvedSisenseTrackRow[];
    observedAt: Date;
  },
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const payload = input.rows.map((row) => {
    const metricId = `amr_${hashIdentity([
      input.orgId,
      SISENSE_TRACK_SOURCE,
      SISENSE_TRACK_WIDGET,
      input.aggregation,
      input.requestedDateRange,
      row.persistedRowKey,
    ].join(":")).slice(0, 40)}`;
    return {
      metric_id: metricId,
      insert_change_id: `amc_${hashIdentity(`${input.runId}:${metricId}:insert`).slice(0, 40)}`,
      update_change_id: `amc_${hashIdentity(`${input.runId}:${metricId}:update`).slice(0, 40)}`,
      track_id: row.trackId,
      row_key: row.persistedRowKey,
      row_hash: row.rowHash,
      dimensions: {
        track_title: row.trackTitle,
        primary_artist: row.primaryArtist,
        release_title: row.releaseTitle,
        isrc: row.isrc,
        match_status: row.matchStatus,
      },
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
        track_id text,
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
        and current.source = ${SISENSE_TRACK_SOURCE}
        and current.widget_key = ${SISENSE_TRACK_WIDGET}
        and current.artist_id = ${input.artistId}
        and current.requested_aggregation = ${input.aggregation}
        and current.requested_date_range = ${input.requestedDateRange}
    ),
    inserted as (
      insert into ${analytics_metric_rows} (
        id, org_id, source, widget_key, artist_id, track_id, row_key, row_hash,
        requested_date_range, requested_aggregation, dimensions, metrics, raw_row,
        first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
      )
      select staged.metric_id, ${input.orgId}, ${SISENSE_TRACK_SOURCE}, ${SISENSE_TRACK_WIDGET},
        ${input.artistId}, staged.track_id, staged.row_key, staged.row_hash,
        ${input.requestedDateRange}, ${input.aggregation}, staged.dimensions, staged.metrics,
        staged.raw_row, ${input.runId}, ${input.runId}, ${input.observedAt}, ${input.observedAt}
      from incoming staged
      left join existing previous on previous.row_key = staged.row_key
      where previous.id is null
      on conflict (org_id, source, widget_key, requested_aggregation, requested_date_range, row_key) do nothing
      returning id, row_key
    ),
    updated as (
      update ${analytics_metric_rows} current
      set track_id = staged.track_id,
          row_hash = staged.row_hash,
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
        id, org_id, run_id, metric_row_id, source, widget_key, artist_id, track_id,
        row_key, change_type, previous_hash, current_hash, previous_raw_row,
        current_raw_row, changed_at
      )
      select staged.insert_change_id, ${input.orgId}, ${input.runId}, added.id,
        ${SISENSE_TRACK_SOURCE}, ${SISENSE_TRACK_WIDGET}, ${input.artistId}, staged.track_id,
        staged.row_key, 'insert', null, staged.row_hash, null, staged.raw_row, ${input.observedAt}
      from inserted added
      inner join incoming staged on staged.row_key = added.row_key
      returning id
    ),
    updated_changes as (
      insert into ${analytics_metric_changes} (
        id, org_id, run_id, metric_row_id, source, widget_key, artist_id, track_id,
        row_key, change_type, previous_hash, current_hash, previous_raw_row,
        current_raw_row, changed_at
      )
      select staged.update_change_id, ${input.orgId}, ${input.runId}, changed.id,
        ${SISENSE_TRACK_SOURCE}, ${SISENSE_TRACK_WIDGET}, ${input.artistId}, staged.track_id,
        staged.row_key, 'update', previous.row_hash, staged.row_hash, previous.raw_row,
        staged.raw_row, ${input.observedAt}
      from updated changed
      inner join existing previous on previous.id = changed.id
      inner join incoming staged on staged.row_key = previous.row_key
      returning id
    )
    select
      (select count(*)::int from inserted) as inserted,
      (select count(*)::int from updated) as updated,
      (select count(*)::int from unchanged) as unchanged,
      (select count(*)::int from inserted_changes)
        + (select count(*)::int from updated_changes) as changes
  `);
  const counts = recordRows(result)[0] ?? {};
  return {
    inserted: Number(counts.inserted ?? 0),
    updated: Number(counts.updated ?? 0),
    unchanged: Number(counts.unchanged ?? 0),
  };
}

async function recordFailedRunProduction(
  tx: DrizzleTransaction,
  input: SisenseTrackSnapshotFailedEvidence,
  observedAt: Date,
): Promise<void> {
  await tx.insert(analytics_import_runs).values({
    id: input.runId,
    org_id: input.orgId,
    source: SISENSE_TRACK_SOURCE,
    artist_id: input.artistId,
    mode: "manual_import",
    requested_date_range: input.requestedDateRange,
    requested_aggregation: input.aggregation,
    status: "failed",
    started_at: observedAt,
    completed_at: observedAt,
    files_downloaded: input.archivedFile ? 1 : 0,
    rows_imported: 0,
    rows_inserted: 0,
    rows_updated: 0,
    rows_unchanged: 0,
    error: input.error.slice(0, 500),
    metadata: {
      export_type: "tracks_by_growth_rate",
      reporting_from: input.reportingFrom,
      reporting_through: input.reportingThrough,
      observed_at: observedAt.toISOString(),
      counts: input.counts,
      totals: input.totals,
      file_name: input.fileName,
      sha256: input.sha256,
    },
  });
  if (input.archivedFile && input.artistId) {
    await tx.insert(analytics_import_files).values({
      id: input.fileId,
      org_id: input.orgId,
      run_id: input.runId,
      source: SISENSE_TRACK_SOURCE,
      widget_key: SISENSE_TRACK_WIDGET,
      widget_title: SISENSE_TRACK_WIDGET_TITLE,
      artist_id: input.artistId,
      requested_date_range: input.requestedDateRange,
      requested_aggregation: input.aggregation,
      file_name: input.fileName,
      storage_bucket: input.archivedFile.storageBucket,
      storage_key: input.archivedFile.storageKey,
      storage_status: "uploaded",
      storage_uploaded_at: observedAt,
      sha256: input.sha256,
      byte_size: input.byteSize,
      row_count: input.rowCount,
      headers: input.headers,
      created_at: observedAt,
    });
  }
}

async function listLatestByArtistProduction(
  tx: DrizzleTransaction,
  orgId: string,
): Promise<LatestSisenseTrackSnapshotImport[]> {
  const rows = await latestSelection(tx, orgId)
    .where(and(
      eq(analytics_import_runs.org_id, orgId),
      eq(analytics_import_runs.source, SISENSE_TRACK_SOURCE),
      eq(analytics_import_runs.mode, "manual_import"),
      eq(analytics_import_runs.status, "completed"),
    ))
    .orderBy(desc(analytics_import_runs.completed_at), desc(analytics_import_runs.started_at));
  const latest = new Map<string, LatestSisenseTrackSnapshotImport>();
  for (const row of rows) {
    if (row.artistId && !latest.has(row.artistId)) latest.set(row.artistId, latestFromRow(row));
  }
  return [...latest.values()];
}

function createProductionStore(
  databaseProvider: SisenseTrackSnapshotDatabaseProvider,
  now: () => Date,
  adapter: Partial<SisenseTrackSnapshotProductionAdapter> = {},
): SisenseTrackSnapshotImportStore {
  return {
    withPreviewTransaction(orgId, work) {
      return withAnalyticsSourceTransaction(databaseProvider, orgId, SISENSE_TRACK_SOURCE, "none", (tx) => work(
        adapter.previewStore?.(tx, orgId) ?? productionPreviewStore(tx, orgId),
      ));
    },

    withLockedTransaction(orgId, work) {
      const observedAt = now();
      return withAnalyticsSourceTransaction(
        databaseProvider,
        orgId,
        SISENSE_TRACK_SOURCE,
        "try",
        (tx) => work(adapter.importTransaction?.(tx, orgId, observedAt) ?? productionImportTransaction(tx, orgId, observedAt)),
        () => new HttpError(
          "Sisense analytics import is already running for this organization",
          409,
          SISENSE_TRACK_LOCKED_ERROR,
        ),
      );
    },

    async recordFailedRun(input) {
      await withAnalyticsSourceTransaction(databaseProvider, input.orgId, SISENSE_TRACK_SOURCE, "wait", async (tx) => {
        const observedAt = now();
        if (adapter.recordFailedRun) await adapter.recordFailedRun(tx, input, observedAt);
        else await recordFailedRunProduction(tx, input, observedAt);
      });
    },

    listLatestByArtist(orgId) {
      return withAnalyticsSourceTransaction(databaseProvider, orgId, SISENSE_TRACK_SOURCE, "none", (tx) => (
        adapter.listLatestByArtist?.(tx, orgId) ?? listLatestByArtistProduction(tx, orgId)
      ));
    },
  };
}

const productionNow = () => new Date();
const productionRandomId = () => randomUUID();
const productionDatabaseProvider: SisenseTrackSnapshotDatabaseProvider = async () => (await import("../lib/db")).db;
const productionArchive: SisenseTrackSnapshotArchive = async (input) => {
  const { getStorageClient, tenantStorageKey } = await import("./storage");
  const bucket = resolveSisenseTrackPrivateAnalyticsBucket(process.env);
  const key = tenantStorageKey(
    input.orgId,
    sisenseTrackArchiveKey(input.artistId, input.requestedDateRange, input.sha256),
  );
  await getStorageClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: input.bytes,
    ContentType: "text/csv; charset=utf-8",
  }));
  return { bucket, key };
};

export function createSisenseTrackSnapshotProductionService(input: {
  database: AnalyticsSourceImportDatabase;
  archive: SisenseTrackSnapshotArchive;
  now?: () => Date;
  randomId?: () => string;
  adapter?: Partial<SisenseTrackSnapshotProductionAdapter>;
}) {
  const now = input.now ?? productionNow;
  return createSisenseTrackSnapshotService({
    store: createProductionStore(async () => input.database, now, input.adapter),
    archive: input.archive,
    now,
    randomId: input.randomId ?? productionRandomId,
  });
}

export function createProductionSisenseTrackSnapshotService() {
  return createSisenseTrackSnapshotService({
    store: createProductionStore(productionDatabaseProvider, productionNow),
    archive: productionArchive,
    assertArchiveReady: () => { resolveSisenseTrackPrivateAnalyticsBucket(process.env); },
    now: productionNow,
    randomId: productionRandomId,
  });
}

function assertPreviewRebound(
  input: SisenseTrackSnapshotApplyInput,
  preview: SisenseTrackSnapshotPreview,
): void {
  if (
    preview.artistId !== input.artistId
    || preview.sha256 !== input.expectedSha256
    || preview.reportingFrom !== input.reportingFrom
    || preview.reportingThrough !== input.reportingThrough
    || preview.requestedDateRange !== `${input.reportingFrom} to ${input.reportingThrough}`
    || preview.aggregation !== input.aggregation.trim()
  ) {
    throw expectedClientError(
      "Sisense snapshot preview no longer matches the selected artist, file, or reporting form",
      409,
    );
  }
}

export function createSisenseTrackSnapshotService(dependencies: SisenseTrackSnapshotServiceDependencies) {
  return {
    async preview(input: SisenseTrackSnapshotPreviewRequest): Promise<BoundSisenseTrackSnapshotPreview> {
      const parsed = parseSisenseTrackSnapshot(input.bytes, input.fileName, input);
      return dependencies.store.withPreviewTransaction(input.orgId, async (store) => (
        bindPreview(input.orgId, await previewSisenseTrackSnapshot(store, {
          orgId: input.orgId,
          artistId: input.artistId,
          parsed,
        }))
      ));
    },

    async apply(input: SisenseTrackSnapshotApplyInput): Promise<SisenseTrackSnapshotApplyResult> {
      dependencies.assertArchiveReady?.();
      const parsed = parseSisenseTrackSnapshot(input.bytes, input.fileName, input);
      if (parsed.sha256 !== input.expectedSha256) {
        throw new HttpError("Sisense snapshot preview no longer matches the selected file", 409);
      }
      if (!/^[a-f0-9]{64}$/.test(input.expectedPreviewFingerprint)) {
        throw new HttpError("expectedPreviewFingerprint must be a lowercase SHA-256 fingerprint", 400);
      }

      let verifiedArtistId: string | null = null;
      const previewEvidence: { current: SisenseTrackSnapshotPreview | null } = { current: null };
      let sideEffectsStarted = false;
      type SisenseImportContext = {
        preview: SisenseTrackSnapshotPreview;
        parsed: typeof parsed;
      };
      type SisenseLifecycleInput = SisenseTrackSnapshotApplyInput & { parsed: typeof parsed };
      const lifecycleInput: SisenseLifecycleInput = { ...input, parsed };

      return runAnalyticsSourceImport<
        SisenseLifecycleInput,
        SisenseImportContext,
        SisenseTrackSnapshotImportTransaction,
        LatestSisenseTrackSnapshotImport,
        { inserted: number; updated: number; unchanged: number },
        SisenseTrackSnapshotApplyResult,
        SisenseTrackSnapshotFailedEvidence
      >({
        store: dependencies.store,
        now: dependencies.now,
        randomId: dependencies.randomId,
        initialFailurePhase: "tenant verification",
        getOrgId: (value) => value.orgId,
        verifyTenant: async (tx, value) => {
          const preview = await previewSisenseTrackSnapshot(tx, {
            orgId: value.orgId,
            artistId: value.artistId,
            parsed: value.parsed,
          });
          previewEvidence.current = preview;
          assertPreviewRebound(value, preview);
          const rebound = bindPreview(value.orgId, preview);
          if (rebound.previewFingerprint !== value.expectedPreviewFingerprint) {
            throw expectedClientError(
              "Sisense snapshot preview no longer matches the selected artist, file, reporting form, or catalog resolution",
              409,
            );
          }
          verifiedArtistId = preview.artistId;
          if (preview.counts.unmatched > 0 && value.includeUnmatched !== true) {
            throw expectedClientError(
              "Acknowledge unmatched Sisense source rows before importing this snapshot",
              409,
            );
          }
          return { preview, parsed: value.parsed };
        },
        findSuccessfulDuplicate: async (tx, context) => {
          const matchedDuplicate = await tx.findSuccessfulDuplicate({
            artistId: context.preview.artistId,
            requestedDateRange: context.preview.requestedDateRange,
            aggregation: context.preview.aggregation,
            sha256: context.preview.sha256,
          });
          return matchedDuplicate;
        },
        duplicateResult: async (tx, duplicate) => ({
          kind: "duplicate" as const,
          runId: duplicate.runId,
          latest: (await tx.findLatestSuccessful({ artistId: duplicate.artistId })) ?? duplicate,
        }),
        createRun: async (tx, context, runId) => {
          sideEffectsStarted = true;
          const observedAt = dependencies.now();
          const metadata: SisenseTrackRunMetadata = {
            export_type: "tracks_by_growth_rate",
            reporting_from: context.preview.reportingFrom,
            reporting_through: context.preview.reportingThrough,
            observed_at: observedAt.toISOString(),
            counts: context.preview.counts,
            totals: context.preview.totals,
          };
          await tx.createRun({
            id: runId,
            artistId: context.preview.artistId,
            requestedDateRange: context.preview.requestedDateRange,
            aggregation: context.preview.aggregation,
            metadata,
          });
        },
        archive: (value, context) => dependencies.archive({
          orgId: value.orgId,
          artistId: context.preview.artistId,
          requestedDateRange: context.preview.requestedDateRange,
          aggregation: context.preview.aggregation,
          sha256: context.preview.sha256,
          bytes: value.bytes,
        }),
        recordFile: (tx, context, runId, fileId, archived) => tx.recordFile({
            id: fileId,
            runId,
            artistId: context.preview.artistId,
            requestedDateRange: context.preview.requestedDateRange,
            aggregation: context.preview.aggregation,
            fileName: context.preview.fileName,
            sha256: context.preview.sha256,
            byteSize: context.parsed.byteSize,
            rowCount: context.parsed.sourceRowCount,
            headers: context.parsed.headers,
            storageBucket: archived.bucket,
            storageKey: archived.key,
          }),
        persistRows: (tx, context, runId) => tx.upsertRows({
          runId,
          artistId: context.preview.artistId,
          requestedDateRange: context.preview.requestedDateRange,
          aggregation: context.preview.aggregation,
          rows: context.preview.rows,
        }),
        completeRun: (tx, runId, counts) => tx.completeRun({ runId, ...counts }),
        importedResult: (context, runId, counts, observedAt) => {
          const latest: LatestSisenseTrackSnapshotImport = {
            artistId: context.preview.artistId,
            artistName: context.preview.artistName,
            runId,
            fileName: context.preview.fileName,
            sha256: context.preview.sha256,
            rowCount: context.parsed.sourceRowCount,
            importedAt: observedAt.toISOString(),
            reportingFrom: context.preview.reportingFrom,
            reportingThrough: context.preview.reportingThrough,
            requestedDateRange: context.preview.requestedDateRange,
            aggregation: context.preview.aggregation,
            counts: context.preview.counts,
            totals: context.preview.totals,
          };
          return { kind: "imported" as const, runId, ...counts, latest };
        },
        buildFailureEvidence: ({ input: value, context, archivedFile, phase, runId, fileId }) => ({
          runId,
          fileId,
          orgId: value.orgId,
          artistId: verifiedArtistId ?? context?.preview.artistId ?? null,
          fileName: value.parsed.fileName,
          sha256: value.parsed.sha256,
          byteSize: value.parsed.byteSize,
          rowCount: value.parsed.sourceRowCount,
          headers: value.parsed.headers,
          requestedDateRange: value.parsed.requestedDateRange,
          reportingFrom: value.parsed.reportingFrom,
          reportingThrough: value.parsed.reportingThrough,
          aggregation: value.parsed.aggregation,
          counts: previewEvidence.current?.counts ?? null,
          totals: previewEvidence.current?.totals ?? null,
          archivedFile: archivedFile ? {
            storageBucket: archivedFile.bucket,
            storageKey: archivedFile.key,
          } : null,
          error: safeFailureMessage(phase),
        }),
        shouldRecordFailure: (error) => sideEffectsStarted || !isKnownPreSideEffectClientError(error),
        mapError: (error, phase) => {
          if (!sideEffectsStarted && isKnownPreSideEffectClientError(error)) throw error;
          throw new HttpError(safeFailureMessage(phase), 500);
        },
      }, lifecycleInput);
    },

    listLatestByArtist(orgId: string) {
      return dependencies.store.listLatestByArtist(orgId);
    },
  };
}
