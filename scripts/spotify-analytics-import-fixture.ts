import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as databaseSchema from "../src/db/schema";
import {
  createSpotifyAnalyticsImportProductionService,
  type SpotifySourceArchive,
} from "../src/server/spotify-analytics-import";
import { parseSpotifyAudienceTimeline } from "../src/server/spotify-audience-timeline";
import { assertDisposableMigratedAnalyticsFixtureTarget } from "./sisense-fixture-safety";

const databaseUrl = process.env.ANALYTICS_FIXTURE_DB_URL;
assertDisposableMigratedAnalyticsFixtureTarget({
  databaseUrl,
  fixtureDb: process.env.ANALYTICS_FIXTURE_DB,
  fixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
});

const source = "spotify_for_artists";
const orgA = `fixture-org-a-${randomUUID()}`;
const orgB = `fixture-org-b-${randomUUID()}`;
const artistA = `fixture-artist-a-${randomUUID()}`;
const highVolumeArtist = `fixture-artist-high-volume-${randomUUID()}`;
const failureArtist = `fixture-artist-failure-${randomUUID()}`;
const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool, { schema: databaseSchema });
const csvHeaders = "date,listeners,monthly listeners,monthly active listeners,super listeners,streams,playlist adds,saves,followers";

function csv(firstListeners: number): Uint8Array {
  return new TextEncoder().encode(`${csvHeaders}\n2026-06-24,${firstListeners},2,3,4,5,6,7,8\n2026-06-25,9,10,11,12,13,14,15,16\n`);
}

function highVolumeCsv(rowCount: number): Uint8Array {
  const start = Date.UTC(1900, 0, 1);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return [date, "1", "1", "1", "1", "1", "1", "1", "1"].join(",");
  });
  return new TextEncoder().encode(`${csvHeaders}\n${rows.join("\n")}\n`);
}

async function seedFixtureData(): Promise<void> {
  await pool.query(
    `insert into "label_suite"."orgs" (id, name, slug) values ($1, 'Spotify Fixture A', $2), ($3, 'Spotify Fixture B', $4)`,
    [orgA, `spotify-fixture-a-${randomUUID()}`, orgB, `spotify-fixture-b-${randomUUID()}`],
  );
  await pool.query(
    `insert into "label_suite"."artists" (id, org_id, name) values
      ($1, $2, 'Fixture Artist'),
      ($3, $2, 'High Volume Artist'),
      ($4, $2, 'Failure Artist')`,
    [artistA, orgA, highVolumeArtist, failureArtist],
  );
}

async function countMetricRows(orgId: string, artistId: string): Promise<number> {
  const result = await pool.query<{ total: number }>(
    `select count(*)::int as total from "label_suite"."analytics_metric_rows" where org_id = $1 and artist_id = $2`,
    [orgId, artistId],
  );
  return result.rows[0].total;
}

async function countChanges(orgId: string, artistId: string, changeType: string): Promise<number> {
  const result = await pool.query<{ total: number }>(
    `select count(*)::int as total from "label_suite"."analytics_metric_changes" where org_id = $1 and artist_id = $2 and change_type = $3`,
    [orgId, artistId, changeType],
  );
  return result.rows[0].total;
}

async function cleanupFixtureData(): Promise<void> {
  const orgIds = [orgA, orgB];
  await pool.query(`delete from "label_suite"."analytics_metric_changes" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_metric_rows" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_import_files" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_import_runs" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."artists" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."audit_logs" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."orgs" where id = any($1::text[])`, [orgIds]);
}

let archived = 0;
let lockProofs = 0;
const archiveLocations: Array<{ bucket: string; key: string }> = [];
const archive: SpotifySourceArchive = async ({ orgId, artistId, sha256 }) => {
  const competitor = await pool.connect();
  try {
    await competitor.query("begin");
    const result = await competitor.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
      [`label-suite:${orgId}:${source}`],
    );
    assert.equal(result.rows[0].locked, false);
    lockProofs += 1;
    await competitor.query("rollback");
  } finally {
    competitor.release();
  }

  const location = {
    bucket: "fixture-private",
    key: `${orgId}/analytics/spotify-for-artists/${artistId}/audience-timeline/${sha256}.csv`,
  };
  archived += 1;
  archiveLocations.push(location);
  return location;
};

const service = createSpotifyAnalyticsImportProductionService({
  database,
  archive,
  now: () => new Date("2026-08-10T12:00:00Z"),
  randomId: () => randomUUID(),
});

try {
  await seedFixtureData();

  const initialBytes = csv(1);
  const initialPreview = parseSpotifyAudienceTimeline(initialBytes, "Audience timeline.csv");
  const fixtureInput = { orgId: orgA, artistId: artistA, fileName: "Audience timeline.csv" };
  const first = await service.applySpotifyAudienceTimeline({
    ...fixtureInput,
    bytes: initialBytes,
    expectedSha256: initialPreview.sha256,
  });
  assert.equal(first.kind, "imported");
  if (first.kind !== "imported") throw new Error("Expected first import to insert rows");
  assert.deepEqual(
    { inserted: first.inserted, updated: first.updated, unchanged: first.unchanged },
    { inserted: 2, updated: 0, unchanged: 0 },
  );
  const successfulEvidence = await pool.query<{
    status: string;
    file_name: string;
    sha256: string;
    row_count: number;
    storage_bucket: string;
    storage_key: string;
  }>(`
    select r.status, f.file_name, f.sha256, f.row_count, f.storage_bucket, f.storage_key
    from "label_suite"."analytics_import_runs" r
    inner join "label_suite"."analytics_import_files" f
      on f.org_id = r.org_id and f.run_id = r.id
    where r.org_id = $1 and r.id = $2
  `, [orgA, first.runId]);
  assert.deepEqual(successfulEvidence.rows, [{
    status: "completed",
    file_name: "Audience-timeline.csv",
    sha256: initialPreview.sha256,
    row_count: 2,
    storage_bucket: archiveLocations[0].bucket,
    storage_key: archiveLocations[0].key,
  }]);

  const duplicate = await service.applySpotifyAudienceTimeline({
    ...fixtureInput,
    bytes: initialBytes,
    expectedSha256: initialPreview.sha256,
  });
  assert.equal(duplicate.kind, "duplicate");

  const correctedBytes = csv(2);
  const correctedPreview = parseSpotifyAudienceTimeline(correctedBytes, "Audience timeline.csv");
  const corrected = await service.applySpotifyAudienceTimeline({
    ...fixtureInput,
    bytes: correctedBytes,
    expectedSha256: correctedPreview.sha256,
  });
  assert.equal(corrected.kind, "imported");
  if (corrected.kind !== "imported") throw new Error("Expected corrected import to apply rows");
  assert.deepEqual(
    { inserted: corrected.inserted, updated: corrected.updated, unchanged: corrected.unchanged },
    { inserted: 0, updated: 1, unchanged: 1 },
  );
  assert.equal(await countMetricRows(orgA, artistA), 2);
  assert.equal(await countChanges(orgA, artistA, "update"), 1);
  assert.equal(await countMetricRows(orgB, artistA), 0);
  assert.deepEqual(await service.listLatestSpotifyAudienceImports(orgB), []);

  const highBytes = highVolumeCsv(10_000);
  const highPreview = parseSpotifyAudienceTimeline(highBytes, "Audience timeline.csv");
  const high = await service.applySpotifyAudienceTimeline({
    orgId: orgA,
    artistId: highVolumeArtist,
    fileName: "Audience timeline.csv",
    bytes: highBytes,
    expectedSha256: highPreview.sha256,
  });
  assert.equal(high.kind, "imported");
  if (high.kind !== "imported") throw new Error("Expected high-volume import to apply rows");
  assert.deepEqual(
    { inserted: high.inserted, updated: high.updated, unchanged: high.unchanged },
    { inserted: 10_000, updated: 0, unchanged: 0 },
  );
  assert.equal(await countMetricRows(orgA, highVolumeArtist), 10_000);

  const collision = await pool.query<{ id: string }>(
    `select id from "label_suite"."analytics_import_files" where org_id = $1 order by created_at limit 1`,
    [orgA],
  );
  const collidingFileId = collision.rows[0]?.id;
  if (!collidingFileId?.startsWith("aif_")) throw new Error("Expected an existing production-adapter file id");
  const failureIds = [
    `fixture-primary-failure-${randomUUID()}`,
    collidingFileId.slice(4),
    `fixture-recorded-failure-${randomUUID()}`,
    `fixture-recorded-file-${randomUUID()}`,
  ];
  const failureService = createSpotifyAnalyticsImportProductionService({
    database,
    archive,
    now: () => new Date("2026-08-10T12:05:00Z"),
    randomId: () => {
      const id = failureIds.shift();
      if (!id) throw new Error("Fixture random-id sequence exhausted");
      return id;
    },
  });
  const failedBytes = csv(3);
  const failedPreview = parseSpotifyAudienceTimeline(failedBytes, "Failure evidence.csv");
  await assert.rejects(
    failureService.applySpotifyAudienceTimeline({
      orgId: orgA,
      artistId: failureArtist,
      fileName: "Failure evidence.csv",
      bytes: failedBytes,
      expectedSha256: failedPreview.sha256,
    }),
  );

  const failedEvidence = await pool.query<{
    status: string;
    error: string;
    files_downloaded: number;
    file_name: string;
    sha256: string;
    byte_size: number;
    row_count: number;
    headers: string[];
    requested_date_range: string;
    storage_bucket: string;
    storage_key: string;
    storage_status: string;
  }>(`
    select r.status, r.error, r.files_downloaded, f.file_name, f.sha256, f.byte_size,
      f.row_count, f.headers, f.requested_date_range, f.storage_bucket, f.storage_key, f.storage_status
    from "label_suite"."analytics_import_runs" r
    inner join "label_suite"."analytics_import_files" f on f.run_id = r.id and f.org_id = r.org_id
    where r.org_id = $1 and r.artist_id = $2
  `, [orgA, failureArtist]);
  assert.equal(failedEvidence.rows.length, 1);
  assert.deepEqual(failedEvidence.rows[0], {
    status: "failed",
    error: "Spotify audience import failed during file provenance",
    files_downloaded: 1,
    file_name: "Failure-evidence.csv",
    sha256: failedPreview.sha256,
    byte_size: failedBytes.byteLength,
    row_count: 2,
    headers: csvHeaders.split(","),
    requested_date_range: "2026-06-24..2026-06-25",
    storage_bucket: archiveLocations.at(-1)?.bucket,
    storage_key: archiveLocations.at(-1)?.key,
    storage_status: "uploaded",
  });
  assert.equal(await countMetricRows(orgA, failureArtist), 0);
  assert.equal(archived, 4);
  assert.equal(lockProofs, 4);
  console.log("Spotify analytics import fixture PASS");
} finally {
  await cleanupFixtureData().catch(() => undefined);
  await pool.end();
}
