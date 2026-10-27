import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { db } from "../lib/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { analytics_import_files, analytics_import_runs, analytics_metric_rows, artists } from "../db/schema";
import { runAnalyticsSourceImport, type AnalyticsSourceImportDatabase } from "./analytics-source-import";
import { HttpError, NotFoundError } from "./errors";
import { NATIVE_MUSIC_WIDGET, parseNativeMusicSnapshot, type NativeMusicSnapshot } from "./native-music-snapshot";
import { resolveSpotifyPrivateAnalyticsBucket } from "./spotify-analytics-import";

type Input = { orgId: string; artistId: string; bytes: Uint8Array; fileName: string; expectedSha256: string };
type Dependencies = {
  database: () => Promise<AnalyticsSourceImportDatabase>;
  archive: (input: Input, sha256: string) => Promise<{ bucket: string; key: string }>;
};
const production: Dependencies = {
  database: async () => (await import("../lib/db")).db,
  archive: async (input, sha256) => {
    const { getStorageClient, tenantStorageKey } = await import("./storage");
    const bucket = resolveSpotifyPrivateAnalyticsBucket(process.env);
    const key = tenantStorageKey(input.orgId, `analytics/native-music/${sha256}.json`);
    await getStorageClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: input.bytes, ContentType: "application/json" }));
    return { bucket, key };
  },
};

export async function importNativeMusicSnapshot(input: Input, dependencies = production) {
  const parsed = parseNativeMusicSnapshot(input.bytes);
  if (parsed.sha256 !== input.expectedSha256) throw new HttpError("Native music preview no longer matches the selected file", 409);
  const snapshot = parsed.snapshot;
  const range = `${snapshot.dateFrom}..${snapshot.dateThrough}`;
  const { rows: _rows, ...scope } = snapshot;
  const runEvidence = { artist_id: input.artistId, requested_date_range: range, requested_aggregation: "Period", metadata: { ...scope, sha256: parsed.sha256, reporting_through: snapshot.dateThrough } };
  const fileEvidence = {
    artist_id: input.artistId, widget_key: NATIVE_MUSIC_WIDGET, widget_title: "Native song catalogue",
    requested_date_range: range, requested_aggregation: "Period", file_name: input.fileName,
    sha256: parsed.sha256, byte_size: input.bytes.length, row_count: snapshot.rows.length,
    headers: ["recordingId", "title", "value", "sourceUrl"],
  };
  return runAnalyticsSourceImport({
    database: dependencies.database, source: snapshot.provider, lock: "wait",
    transaction: (tx) => tx, now: () => new Date(), randomId: randomUUID,
    getOrgId: (value: Input) => value.orgId,
    verifyTenant: async (tx, value) => {
      const found = await tx.select({ id: artists.id, spotifyId: artists.spotify_id }).from(artists)
        .where(and(eq(artists.org_id, value.orgId), eq(artists.id, value.artistId))).limit(1);
      if (!found.length) throw new NotFoundError("Artist not found in active workspace");
      if (snapshot.provider === "spotify_for_artists" && found[0].spotifyId && found[0].spotifyId !== snapshot.providerArtistId) {
        throw new HttpError("Native Spotify artist ID does not match the selected artist", 409);
      }
      return value;
    },
    findSuccessfulDuplicate: async (tx) => {
      const found = await tx.select({ runId: analytics_import_runs.id }).from(analytics_import_runs)
        .innerJoin(analytics_import_files, eq(analytics_import_files.run_id, analytics_import_runs.id))
        .where(and(eq(analytics_import_runs.org_id, input.orgId), eq(analytics_import_runs.artist_id, input.artistId),
          eq(analytics_import_runs.source, snapshot.provider), eq(analytics_import_runs.status, "completed"),
          eq(analytics_import_files.org_id, input.orgId), eq(analytics_import_files.widget_key, NATIVE_MUSIC_WIDGET),
          eq(analytics_import_files.sha256, parsed.sha256))).limit(1);
      return found[0] ?? null;
    },
    duplicateResult: (_tx, duplicate: { runId: string }) => ({ kind: "duplicate", runId: duplicate.runId }),
    runEvidence: () => runEvidence,
    fileEvidence: () => fileEvidence,
    archive: (value) => dependencies.archive(value, parsed.sha256),
    persistRows: async (tx, _context, runId) => {
      // Each capture is immutable. The read model selects exactly one complete run;
      // later captures never silently blend with older catalogue membership.
      for (let offset = 0; offset < snapshot.rows.length; offset += 500) {
      await tx.insert(analytics_metric_rows).values(snapshot.rows.slice(offset, offset + 500).map((row) => ({
        id: `amr_${randomUUID()}`, org_id: input.orgId, artist_id: input.artistId,
        source: snapshot.provider, widget_key: NATIVE_MUSIC_WIDGET,
        row_key: `${input.artistId}:${runId}:${row.recordingId}`,
        row_hash: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        requested_date_range: range, requested_aggregation: "Period",
        dimensions: { recording_id: row.recordingId, title: row.title, source_url: row.sourceUrl },
        metrics: { value: row.value }, raw_row: { ...row, value: row.value === null ? null : String(row.value) },
        first_seen_run_id: runId, last_seen_run_id: runId,
      })));
      }
      return { inserted: snapshot.rows.length, updated: 0, unchanged: 0 };
    },
    importedResult: (_context, runId) => ({ kind: "imported", runId }),
    failureEvidence: (_value, _context, phase) => ({ run: runEvidence, file: fileEvidence, error: `Native music import failed during ${phase}` }),
    shouldRecordFailure: (error) => !(error instanceof NotFoundError),
  }, input);
}

export type NativeMusicCatalogue = NativeMusicSnapshot & { artistId: string; runId: string };

export async function listNativeMusicCatalogues(orgId: string, artistId?: string, suppliedDatabase?: typeof db): Promise<NativeMusicCatalogue[]> {
  const database = suppliedDatabase ?? (await import("../lib/db")).db;
  const runs = await database.select({ runId: analytics_import_runs.id, artistId: analytics_import_runs.artist_id, metadata: analytics_import_runs.metadata, rowCount: analytics_import_files.row_count })
    .from(analytics_import_runs)
    .innerJoin(analytics_import_files, and(eq(analytics_import_files.run_id, analytics_import_runs.id), eq(analytics_import_files.org_id, orgId),
      eq(analytics_import_files.widget_key, NATIVE_MUSIC_WIDGET), eq(analytics_import_files.storage_status, "uploaded")))
    .where(and(eq(analytics_import_runs.org_id, orgId), eq(analytics_import_runs.status, "completed"),
      inArray(analytics_import_runs.source, ["spotify_for_artists", "apple_music_for_artists"]),
      ...(artistId ? [eq(analytics_import_runs.artist_id, artistId)] : [])))
    .orderBy(desc(analytics_import_runs.completed_at));
  const seen = new Set<string>();
  const result: NativeMusicCatalogue[] = [];
  // Compare observation times, not upload times: importing an old file must not
  // displace a newer native observation.
  runs.sort((a, b) => Date.parse(String(b.metadata?.capturedAt)) - Date.parse(String(a.metadata?.capturedAt)));
  for (const run of runs) {
    const key = `${run.artistId}:${run.metadata?.provider}`;
    if (!run.artistId || seen.has(key)) continue;
    const rows = await database.select({ dimensions: analytics_metric_rows.dimensions, metrics: analytics_metric_rows.metrics })
      .from(analytics_metric_rows).where(and(eq(analytics_metric_rows.org_id, orgId), eq(analytics_metric_rows.last_seen_run_id, run.runId),
        eq(analytics_metric_rows.widget_key, NATIVE_MUSIC_WIDGET)));
    if (rows.length !== run.rowCount) throw new HttpError("Native music catalogue is incomplete; re-import its archived source", 500);
    const { sha256: _sha, reporting_through: _through, ...scope } = run.metadata ?? {};
    const parsed = parseNativeMusicSnapshot(new TextEncoder().encode(JSON.stringify({ ...scope, rows: rows.map((row) => ({
      recordingId: row.dimensions.recording_id, title: row.dimensions.title, sourceUrl: row.dimensions.source_url, value: row.metrics.value,
    })) })));
    result.push({ ...parsed.snapshot, artistId: run.artistId, runId: run.runId });
    seen.add(key);
  }
  return result;
}
