import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as databaseSchema from "../src/db/schema";
import type {
  BoundSisenseTrackSnapshotPreview,
  SisenseTrackSnapshotApplyInput,
  SisenseTrackSnapshotArchive,
  SisenseTrackSnapshotPreviewRequest,
} from "../src/server/sisense-track-snapshot-import";
import {
  assertDisposableMigratedAnalyticsFixtureTarget,
  type MigratedAnalyticsFixtureTarget,
} from "./sisense-fixture-safety";

const MIGRATION_0077 = "0077_analytics_metric_rows_last_seen_membership";
const csvHeaders = [
  "track_title",
  "primary_artist",
  "release_title",
  "isrc",
  "spotify_streams",
  "combined_streams",
  "combined_views",
].join(",");

interface FixtureNamespace {
  orgA: string;
  orgB: string;
  artistA: string;
  artistOther: string;
  artistFailure: string;
  artistOrgB: string;
  releaseA: string;
  releaseOther: string;
  releaseFailure: string;
  releaseOrgB: string;
  trackOne: string;
  trackTwo: string;
  trackOther: string;
  trackFailure: string;
  trackOrgB: string;
  suffix: string;
}

interface CsvRow {
  title: string;
  artist: string;
  release?: string;
  isrc?: string;
  spotifyStreams: number;
  combinedStreams: number;
  combinedViews: number;
}

export function createFixtureNamespace(): FixtureNamespace {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const orgA = `sisense-fixture-org-a-${randomUUID()}`;
  const orgB = `sisense-fixture-org-b-${randomUUID()}`;
  const artistA = `sisense-fixture-artist-a-${randomUUID()}`;
  const artistOther = `sisense-fixture-artist-other-${randomUUID()}`;
  const artistFailure = `sisense-fixture-artist-failure-${randomUUID()}`;
  const artistOrgB = `sisense-fixture-artist-org-b-${randomUUID()}`;
  const releaseA = `sisense-fixture-release-a-${randomUUID()}`;
  const releaseOther = `sisense-fixture-release-other-${randomUUID()}`;
  const releaseFailure = `sisense-fixture-release-failure-${randomUUID()}`;
  const releaseOrgB = `sisense-fixture-release-org-b-${randomUUID()}`;
  const trackOne = `sisense-fixture-track-one-${randomUUID()}`;
  const trackTwo = `sisense-fixture-track-two-${randomUUID()}`;
  const trackOther = `sisense-fixture-track-other-${randomUUID()}`;
  const trackFailure = `sisense-fixture-track-failure-${randomUUID()}`;
  const trackOrgB = `sisense-fixture-track-org-b-${randomUUID()}`;
  return {
    orgA,
    orgB,
    artistA,
    artistOther,
    artistFailure,
    artistOrgB,
    releaseA,
    releaseOther,
    releaseFailure,
    releaseOrgB,
    trackOne,
    trackTwo,
    trackOther,
    trackFailure,
    trackOrgB,
    suffix,
  };
}

export async function assertRepositoryMigration0077(client: Pick<Pool, "query">): Promise<void> {
  const migrationSql = await readFile(
    new URL(`../drizzle/${MIGRATION_0077}.sql`, import.meta.url),
    "utf8",
  );
  const expectedHash = createHash("sha256").update(migrationSql).digest("hex");
  let markerCount: number | null;
  try {
    const result = await client.query(
      `select hash from "drizzle"."__drizzle_migrations" where hash = $1`,
      [expectedHash],
    );
    markerCount = result.rowCount;
  } catch (error) {
    throw new Error(
      `Refusing Sisense track snapshot fixture: repository migration marker ${MIGRATION_0077} is unavailable.`,
      { cause: error },
    );
  }
  if (markerCount !== 1) {
    throw new Error(
      `Refusing Sisense track snapshot fixture: repository migration marker ${MIGRATION_0077} is absent.`,
    );
  }
}

export function createGuardedAnalyticsFixturePool<T>(
  target: MigratedAnalyticsFixtureTarget,
  poolFactory: (databaseUrl: string) => T,
): T {
  assertDisposableMigratedAnalyticsFixtureTarget(target);
  return poolFactory(target.databaseUrl!);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(...rows: CsvRow[]): Uint8Array {
  const body = rows.map((row) => [
    row.title,
    row.artist,
    row.release ?? "",
    row.isrc ?? "",
    row.spotifyStreams,
    row.combinedStreams,
    row.combinedViews,
  ].map(csvCell).join(","));
  return new TextEncoder().encode(`${csvHeaders}\n${body.join("\n")}\n`);
}

async function seedFixtureData(pool: Pool, namespace: FixtureNamespace): Promise<void> {
  const artistNameA = `Sisense Fixture Artist A ${namespace.suffix}`;
  const artistNameOther = `Sisense Fixture Artist Other ${namespace.suffix}`;
  const artistNameFailure = `Sisense Fixture Artist Failure ${namespace.suffix}`;
  const artistNameOrgB = `Sisense Fixture Artist Org B ${namespace.suffix}`;
  const releaseNameA = `Sisense Fixture Release A ${namespace.suffix}`;
  const releaseNameOther = `Sisense Fixture Release Other ${namespace.suffix}`;
  const releaseNameFailure = `Sisense Fixture Release Failure ${namespace.suffix}`;
  const releaseNameOrgB = `Sisense Fixture Release Org B ${namespace.suffix}`;

  await pool.query(
    `insert into "label_suite"."orgs" (id, name, slug) values
      ($1, 'Sisense Snapshot Fixture A', $2),
      ($3, 'Sisense Snapshot Fixture B', $4)`,
    [
      namespace.orgA,
      `sisense-snapshot-fixture-a-${namespace.suffix}`,
      namespace.orgB,
      `sisense-snapshot-fixture-b-${namespace.suffix}`,
    ],
  );
  await pool.query(
    `insert into "label_suite"."artists" (id, org_id, name) values
      ($1, $2, $3), ($4, $2, $5), ($6, $2, $7), ($8, $9, $10)`,
    [
      namespace.artistA,
      namespace.orgA,
      artistNameA,
      namespace.artistOther,
      artistNameOther,
      namespace.artistFailure,
      artistNameFailure,
      namespace.artistOrgB,
      namespace.orgB,
      artistNameOrgB,
    ],
  );
  await pool.query(
    `insert into "label_suite"."releases" (id, org_id, artist_id, title) values
      ($1, $2, $3, $4), ($5, $2, $6, $7), ($8, $2, $9, $10), ($11, $12, $13, $14)`,
    [
      namespace.releaseA,
      namespace.orgA,
      namespace.artistA,
      releaseNameA,
      namespace.releaseOther,
      namespace.artistOther,
      releaseNameOther,
      namespace.releaseFailure,
      namespace.artistFailure,
      releaseNameFailure,
      namespace.releaseOrgB,
      namespace.orgB,
      namespace.artistOrgB,
      releaseNameOrgB,
    ],
  );
  await pool.query(
    `insert into "label_suite"."tracks" (id, org_id, release_id, title, isrc, position) values
      ($1, $2, $3, 'Fixture Track One', 'DKFIX2600001', 1),
      ($4, $2, $3, 'Fixture Track Two', 'DKFIX2600002', 2),
      ($5, $2, $6, 'Fixture Other Track', 'DKFIX2600003', 1),
      ($7, $2, $8, 'Fixture Failure Track', 'DKFIX2600004', 1),
      ($9, $10, $11, 'Fixture Org B Track', 'DKFIX2600001', 1)`,
    [
      namespace.trackOne,
      namespace.orgA,
      namespace.releaseA,
      namespace.trackTwo,
      namespace.trackOther,
      namespace.releaseOther,
      namespace.trackFailure,
      namespace.releaseFailure,
      namespace.trackOrgB,
      namespace.orgB,
      namespace.releaseOrgB,
    ],
  );
}

async function cleanupFixtureData(pool: Pool, namespace: FixtureNamespace): Promise<void> {
  const orgIds = [namespace.orgA, namespace.orgB];
  await pool.query(`delete from "label_suite"."analytics_metric_changes" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_metric_rows" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_import_files" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."analytics_import_runs" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."tracks" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."releases" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."artists" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."audit_logs" where org_id = any($1::text[])`, [orgIds]);
  await pool.query(`delete from "label_suite"."orgs" where id = any($1::text[])`, [orgIds]);
}

function previewInput(
  namespace: FixtureNamespace,
  artistId: string,
  bytes: Uint8Array,
): SisenseTrackSnapshotPreviewRequest {
  return {
    orgId: namespace.orgA,
    artistId,
    reportingFrom: "2026-08-01",
    reportingThrough: "2026-08-08",
    aggregation: "Daily",
    bytes,
    fileName: "Tracks by Growth Rate.csv",
  };
}

function boundApplyInput(
  preview: BoundSisenseTrackSnapshotPreview,
  input: SisenseTrackSnapshotPreviewRequest,
  includeUnmatched: boolean,
): SisenseTrackSnapshotApplyInput {
  return {
    ...input,
    expectedSha256: preview.sha256,
    expectedPreviewFingerprint: preview.previewFingerprint,
    includeUnmatched,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.ANALYTICS_FIXTURE_DB_URL;
  const pool = createGuardedAnalyticsFixturePool({
    databaseUrl,
    fixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    fixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  }, (connectionString) => new Pool({ connectionString }));
  const namespace = createFixtureNamespace();
  let seeded = false;
  try {
    await assertRepositoryMigration0077(pool);
    const {
      createSisenseTrackSnapshotProductionService: createProductionSisenseTrackSnapshotService,
    } = await import("../src/server/sisense-track-snapshot-import");
    const database = drizzle(pool, { schema: databaseSchema });
    const archives: Array<{ bucket: string; key: string; sha256: string }> = [];
    let lockProofs = 0;
    const archive: SisenseTrackSnapshotArchive = async ({ orgId, artistId, requestedDateRange, sha256 }) => {
      const competitor = await pool.connect();
      try {
        await competitor.query("begin");
        const result = await competitor.query<{ locked: boolean }>(
          "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
          [`label-suite:${orgId}:sisense`],
        );
        assert.equal(result.rows[0].locked, false);
        lockProofs += 1;
        await competitor.query("rollback");
      } finally {
        competitor.release();
      }
      const archived = {
        bucket: "fixture-private-analytics",
        key: `${orgId}/private/sisense/${artistId}/${createHash("sha256").update(requestedDateRange).digest("hex").slice(0, 16)}/${sha256}.csv`,
        sha256,
      };
      assert.equal(/^https?:\/\//.test(archived.key), false);
      archives.push(archived);
      return { bucket: archived.bucket, key: archived.key };
    };
    let clockTick = 0;
    const now = () => new Date(Date.parse("2026-08-11T12:00:00.000Z") + clockTick++ * 1_000);
    const service = createProductionSisenseTrackSnapshotService({
      database,
      archive,
      now,
      randomId: () => randomUUID(),
    });

    seeded = true;
    await seedFixtureData(pool, namespace);

    const artistNameA = `Sisense Fixture Artist A ${namespace.suffix}`;
    const releaseNameA = `Sisense Fixture Release A ${namespace.suffix}`;
    const initialBytes = csv(
      {
        title: "Fixture Track One",
        artist: artistNameA,
        release: releaseNameA,
        isrc: "DKFIX2600001",
        spotifyStreams: 95,
        combinedStreams: 100,
        combinedViews: 10,
      },
      {
        title: "Fixture Unmatched Track",
        artist: artistNameA,
        release: releaseNameA,
        spotifyStreams: 45,
        combinedStreams: 50,
        combinedViews: 5,
      },
    );
    const initialInput = previewInput(namespace, namespace.artistA, initialBytes);
    const initialPreview = await service.preview(initialInput);
    assert.deepEqual(initialPreview.counts, {
      sourceRows: 2,
      uniqueTracks: 2,
      matched: 1,
      unmatched: 1,
      ambiguous: 0,
      exactDuplicates: 0,
    });
    await assert.rejects(
      service.apply(boundApplyInput(initialPreview, initialInput, false)),
      /Acknowledge unmatched Sisense source rows/,
    );
    assert.equal(archives.length, 0);

    const first = await service.apply(boundApplyInput(initialPreview, initialInput, true));
    assert.equal(first.kind, "imported");
    if (first.kind !== "imported") throw new Error("Expected first Sisense fixture import to apply");
    assert.deepEqual(
      { inserted: first.inserted, updated: first.updated, unchanged: first.unchanged },
      { inserted: 2, updated: 0, unchanged: 0 },
    );

    const duplicate = await service.apply(boundApplyInput(initialPreview, initialInput, true));
    assert.equal(duplicate.kind, "duplicate");
    assert.equal(duplicate.runId, first.runId);
    assert.equal(archives.length, 1);

    const correctionBytes = csv(
      {
        title: "Fixture Track One",
        artist: artistNameA,
        release: releaseNameA,
        isrc: "DKFIX2600001",
        spotifyStreams: 105,
        combinedStreams: 110,
        combinedViews: 11,
      },
      {
        title: "Fixture Track Two",
        artist: artistNameA,
        release: releaseNameA,
        isrc: "DKFIX2600002",
        spotifyStreams: 20,
        combinedStreams: 25,
        combinedViews: 2,
      },
    );
    const correctionInput = previewInput(namespace, namespace.artistA, correctionBytes);
    const correctionPreview = await service.preview(correctionInput);
    const correction = await service.apply(boundApplyInput(correctionPreview, correctionInput, false));
    assert.equal(correction.kind, "imported");
    if (correction.kind !== "imported") throw new Error("Expected corrected Sisense fixture import to apply");
    assert.deepEqual(
      { inserted: correction.inserted, updated: correction.updated, unchanged: correction.unchanged },
      { inserted: 1, updated: 1, unchanged: 0 },
    );

    const membership = await pool.query<{
      title: string;
      last_seen_run_id: string;
    }>(`
      select dimensions->>'track_title' as title, last_seen_run_id
      from "label_suite"."analytics_metric_rows"
      where org_id = $1 and artist_id = $2 and source = 'sisense' and widget_key = 'tracks-by-growth-rate'
      order by title
    `, [namespace.orgA, namespace.artistA]);
    assert.equal(membership.rows.length, 3);
    assert.deepEqual(
      membership.rows.filter((row) => row.last_seen_run_id === correction.runId).map((row) => row.title),
      ["Fixture Track One", "Fixture Track Two"],
    );
    assert.equal(
      membership.rows.find((row) => row.title === "Fixture Unmatched Track")?.last_seen_run_id,
      first.runId,
    );

    const artistNameOther = `Sisense Fixture Artist Other ${namespace.suffix}`;
    const releaseNameOther = `Sisense Fixture Release Other ${namespace.suffix}`;
    const otherBytes = csv({
      title: "Fixture Other Track",
      artist: artistNameOther,
      release: releaseNameOther,
      isrc: "DKFIX2600003",
      spotifyStreams: 30,
      combinedStreams: 35,
      combinedViews: 3,
    });
    const otherInput = previewInput(namespace, namespace.artistOther, otherBytes);
    const otherPreview = await service.preview(otherInput);
    const other = await service.apply(boundApplyInput(otherPreview, otherInput, false));
    assert.equal(other.kind, "imported");

    const latestOrgA = await service.listLatestByArtist(namespace.orgA);
    assert.deepEqual(
      latestOrgA.map((item) => [item.artistId, item.runId]).sort(),
      [
        [namespace.artistA, correction.runId],
        [namespace.artistOther, other.runId],
      ].sort(),
    );
    assert.deepEqual(await service.listLatestByArtist(namespace.orgB), []);
    const orgBMetricCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_metric_rows" where org_id = $1`,
      [namespace.orgB],
    );
    assert.equal(orgBMetricCount.rows[0]?.total, 0);

    const artistNameFailure = `Sisense Fixture Artist Failure ${namespace.suffix}`;
    const releaseNameFailure = `Sisense Fixture Release Failure ${namespace.suffix}`;
    const failureBytes = csv({
      title: "Fixture Failure Track",
      artist: artistNameFailure,
      release: releaseNameFailure,
      isrc: "DKFIX2600004",
      spotifyStreams: 40,
      combinedStreams: 45,
      combinedViews: 4,
    });
    const failureInput = {
      ...previewInput(namespace, namespace.artistFailure, failureBytes),
      fileName: "Failure evidence.csv",
    };
    const failurePreview = await service.preview(failureInput);
    const failureRowKey = `artist:${namespace.artistFailure}:track:${namespace.trackFailure}`;

    const transactionalRunRawId = `fixture-primary-failure-${randomUUID()}`;
    const transactionalFileRawId = `fixture-primary-file-${randomUUID()}`;
    const failureRunRawId = `fixture-recorded-failure-${randomUUID()}`;
    const failureFileRawId = `fixture-recorded-file-${randomUUID()}`;
    const transactionalRunId = `air_${transactionalRunRawId}`;
    const transactionalFileId = `aif_${transactionalFileRawId}`;
    const failureRunId = `air_${failureRunRawId}`;
    const failureFileId = `aif_${failureFileRawId}`;
    const failureMetricId = `amr_${createHash("sha256").update([
      namespace.orgA,
      "sisense",
      "tracks-by-growth-rate",
      failurePreview.aggregation,
      failurePreview.requestedDateRange,
      failureRowKey,
    ].join(":")).digest("hex").slice(0, 40)}`;
    const collidingChangeId = `amc_${createHash("sha256")
      .update(`${transactionalRunId}:${failureMetricId}:insert`)
      .digest("hex")
      .slice(0, 40)}`;
    const changeAnchor = await pool.query<{
      metric_row_id: string;
      run_id: string | null;
      track_id: string | null;
      row_key: string;
      row_hash: string;
    }>(`
      select id as metric_row_id, last_seen_run_id as run_id, track_id, row_key, row_hash
      from "label_suite"."analytics_metric_rows"
      where org_id = $1 and artist_id = $2
      order by id
      limit 1
    `, [namespace.orgA, namespace.artistA]);
    const anchor = changeAnchor.rows[0];
    if (!anchor?.run_id) throw new Error("Expected existing fixture metric provenance");
    await pool.query(`
      insert into "label_suite"."analytics_metric_changes" (
        id, org_id, run_id, metric_row_id, source, widget_key, artist_id, track_id,
        row_key, change_type, current_hash, current_raw_row
      ) values ($1, $2, $3, $4, 'sisense', 'tracks-by-growth-rate', $5, $6, $7,
        'fixture_collision', $8, '{}'::jsonb)
    `, [
      collidingChangeId,
      namespace.orgA,
      anchor.run_id,
      anchor.metric_row_id,
      namespace.artistA,
      anchor.track_id,
      anchor.row_key,
      anchor.row_hash,
    ]);

    const failureIds = [
      transactionalRunRawId,
      transactionalFileRawId,
      failureRunRawId,
      failureFileRawId,
    ];
    const failureService = createProductionSisenseTrackSnapshotService({
      database,
      archive,
      now,
      randomId: () => {
        const id = failureIds.shift();
        if (!id) throw new Error("Fixture random-id sequence exhausted");
        return id;
      },
    });
    await assert.rejects(
      failureService.apply(boundApplyInput(failurePreview, failureInput, false)),
      /Sisense track snapshot import failed during metric persistence/,
    );

    const failedEvidence = await pool.query<{
      run_id: string;
      file_id: string;
      status: string;
      error: string;
      files_downloaded: number;
      file_name: string;
      sha256: string;
      row_count: number;
      storage_bucket: string;
      storage_key: string;
      storage_status: string;
    }>(`
      select r.id as run_id, f.id as file_id, r.status, r.error, r.files_downloaded,
        f.file_name, f.sha256, f.row_count,
        f.storage_bucket, f.storage_key, f.storage_status
      from "label_suite"."analytics_import_runs" r
      inner join "label_suite"."analytics_import_files" f
        on f.org_id = r.org_id and f.run_id = r.id
      where r.org_id = $1 and r.artist_id = $2 and r.status = 'failed'
    `, [namespace.orgA, namespace.artistFailure]);
    assert.equal(failedEvidence.rows.length, 1);
    assert.deepEqual(failedEvidence.rows[0], {
      run_id: failureRunId,
      file_id: failureFileId,
      status: "failed",
      error: "Sisense track snapshot import failed during metric persistence",
      files_downloaded: 1,
      file_name: "Failure-evidence.csv",
      sha256: failurePreview.sha256,
      row_count: 1,
      storage_bucket: "fixture-private-analytics",
      storage_key: archives.at(-1)?.key,
      storage_status: "uploaded",
    });

    const originalRunCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_import_runs" where id = $1`,
      [transactionalRunId],
    );
    assert.equal(originalRunCount.rows[0]?.total, 0);
    const originalFileCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_import_files" where id = $1`,
      [transactionalFileId],
    );
    assert.equal(originalFileCount.rows[0]?.total, 0);
    const failureRunCount = await pool.query<{
      total: number;
      failed: number;
      running: number;
    }>(`
      select count(*)::int as total,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'running')::int as running
      from "label_suite"."analytics_import_runs"
      where org_id = $1 and artist_id = $2
    `, [namespace.orgA, namespace.artistFailure]);
    assert.deepEqual(failureRunCount.rows[0], { total: 1, failed: 1, running: 0 });
    const failureFileCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_import_files" where org_id = $1 and artist_id = $2`,
      [namespace.orgA, namespace.artistFailure],
    );
    assert.equal(failureFileCount.rows[0]?.total, 1);
    const failureMetricRowCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_metric_rows" where org_id = $1 and artist_id = $2`,
      [namespace.orgA, namespace.artistFailure],
    );
    assert.equal(failureMetricRowCount.rows[0]?.total, 0);
    const failureMetricChangeCount = await pool.query<{ total: number }>(
      `select count(*)::int as total from "label_suite"."analytics_metric_changes" where org_id = $1 and artist_id = $2`,
      [namespace.orgA, namespace.artistFailure],
    );
    assert.equal(failureMetricChangeCount.rows[0]?.total, 0);
    assert.equal(archives.length, 4);
    assert.equal(lockProofs, 4);
    assert.equal(archives.every((item) => item.bucket === "fixture-private-analytics"), true);
    console.log("Sisense track snapshot import fixture PASS");
  } finally {
    try {
      if (seeded) await cleanupFixtureData(pool, namespace);
    } finally {
      await pool.end();
    }
  }
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (isDirectRun) await main();
