/**
 * Disposable CI fixture for the actual Sisense importer and analytics table
 * contract. It never targets a production-like database.
 * Run only with ANALYTICS_FIXTURE_DB=1 and a disposable DATABASE_URL.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { assertDisposableForcedFailureTarget } from "./sisense-fixture-safety";

const databaseUrl = process.env.ANALYTICS_FIXTURE_DB_URL ?? "";
const schema = `analytics_fixture_${randomUUID().replaceAll("-", "")}`;
assertDisposableForcedFailureTarget({
  databaseUrl,
  schema,
  fixtureDb: process.env.ANALYTICS_FIXTURE_DB,
  fixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
});

const tenant = "tenant-a";
const otherTenant = "tenant-b";
const advisoryKey = `label-suite:${tenant}:sisense`;
const rlsProbeRole = `analytics_fixture_rls_${randomUUID().replaceAll("-", "")}`;
const client = new Client({ connectionString: databaseUrl });
const contender = new Client({ connectionString: databaseUrl });
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "analytics-ingestion-fixture-"));
const csvPath = path.join(fixtureDirectory, "fixture-tracks.csv");
const csvContents = "date,streams\n2026-07-28,12\n";

try {
  await client.connect();
  await contender.connect();
  await client.query(`create schema ${schema}`);
  await createImporterTables(client);
  await client.query(`insert into ${schema}.orgs (id) values ($1), ($2)`, [tenant, otherTenant]);
  await verifyRlsAndAdvisoryLock(client, contender);
  await writeFile(csvPath, csvContents, "utf8");

  const result = await runImporter([
    "--mode", "import",
    "--file", csvPath,
    "--widget-key", "fixture-tracks",
    "--date-range", "Last 30 days",
    "--aggregation", "Daily",
    "--apply",
    "--no-upload",
  ], {
    DATABASE_URL: databaseUrl,
    SISENSE_DB_SCHEMA: schema,
    SISENSE_ORG_ID: tenant,
    ANALYTICS_FIXTURE_DB: "1",
    ANALYTICS_FIXTURE_DISPOSABLE: "1",
    SISENSE_TEST_FAIL_AFTER_RAW_STAGING: "1",
  });
  if (result.status !== 1 || !result.output.includes("Test requested failure after raw-file staging.")) {
    throw new Error(`Actual importer did not fail at the staged-provenance seam: ${result.output}`);
  }

  const run = await client.query<{ status: string; files_downloaded: number; rows_imported: number }>(
    `select status, files_downloaded, rows_imported from ${schema}.analytics_import_runs where org_id = $1`,
    [tenant],
  );
  if (run.rows.length !== 1 || run.rows[0]?.status !== "failed" || run.rows[0]?.files_downloaded !== 1 || run.rows[0]?.rows_imported !== 0) {
    throw new Error("Failed actual import did not retain the expected failed run metadata");
  }

  const stagedFile = await client.query<{
    file_name: string;
    sha256: string;
    byte_size: number;
    row_count: number;
    requested_date_range: string;
    requested_aggregation: string;
    storage_status: string;
    local_path: string;
  }>(`
    select file_name, sha256, byte_size, row_count, requested_date_range, requested_aggregation, storage_status, local_path
    from ${schema}.analytics_import_files
    where org_id = $1
  `, [tenant]);
  const expectedHash = createHash("sha256").update(csvContents).digest("hex");
  if (stagedFile.rows.length !== 1 || stagedFile.rows[0]?.file_name !== "fixture-tracks.csv" || stagedFile.rows[0]?.sha256 !== expectedHash || stagedFile.rows[0]?.byte_size !== Buffer.byteLength(csvContents) || stagedFile.rows[0]?.row_count !== 1 || stagedFile.rows[0]?.requested_date_range !== "Last 30 days" || stagedFile.rows[0]?.requested_aggregation !== "Daily" || stagedFile.rows[0]?.storage_status !== "not_requested" || stagedFile.rows[0]?.local_path !== csvPath) {
    throw new Error("Raw-file provenance was not retained before the normalized-row failure");
  }

  const rows = await client.query(`select count(*)::int as total from ${schema}.analytics_metric_rows where org_id = $1`, [tenant]);
  if (rows.rows[0]?.total !== 0) throw new Error("Normalized rows survived a staged-import failure");
  // A prior snapshot followed by two distinct empty/null playlist dimensions
  // must retain both source identities and replay without change events.
  const playlistPath = path.join(fixtureDirectory, "playlist.csv");
  const playlistArgs = ["--mode", "import", "--file", playlistPath,
    "--widget-key", "fixture-playlists", "--date-range", "14 Days",
    "--aggregation", "Daily", "--apply", "--no-upload"];
  const playlistEnv = { DATABASE_URL: databaseUrl, SISENSE_DB_SCHEMA: schema,
    SISENSE_ORG_ID: tenant, ANALYTICS_FIXTURE_DB: "1", ANALYTICS_FIXTURE_DISPOSABLE: "1" };
  await writeFile(playlistPath, 'playlist__name,playlist__source_uri,streams\n,,1\n');
  const seed = await runImporter(playlistArgs, playlistEnv);
  if (seed.status !== 0) throw new Error(`Playlist seed failed: ${seed.output}`);
  await writeFile(playlistPath, 'playlist__name,playlist__source_uri,streams\n"",,761\n"","",405\n');
  const imported = await runImporter(playlistArgs, playlistEnv);
  if (imported.status !== 0) throw new Error(`Distinct playlist import failed: ${imported.output}`);
  const replay = await runImporter(playlistArgs, playlistEnv);
  if (replay.status !== 0 || !replay.output.includes("0 inserted, 0 updated, 2 unchanged")) {
    throw new Error(`Playlist replay was not idempotent: ${replay.output}`);
  }
  console.log("analytics ingestion fixture passed");
} finally {
  await client.query(`drop schema if exists ${schema} cascade`).catch(() => undefined);
  await client.end().catch(() => undefined);
  await contender.end().catch(() => undefined);
  await rm(fixtureDirectory, { recursive: true, force: true }).catch(() => undefined);
}

async function verifyRlsAndAdvisoryLock(db: Client, competingClient: Client): Promise<void> {
  await db.query("begin");
  try {
    await db.query(`
      alter table ${schema}.analytics_metric_rows enable row level security;
      alter table ${schema}.analytics_metric_rows force row level security;
      create policy tenant_isolation on ${schema}.analytics_metric_rows
        using (org_id = current_setting('app.current_org_id', true))
        with check (org_id = current_setting('app.current_org_id', true));

      create role ${rlsProbeRole} noinherit nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
      grant usage on schema ${schema} to ${rlsProbeRole};
      grant select on ${schema}.analytics_metric_rows to ${rlsProbeRole};
    `);
    await insertFixtureMetricRow(db, tenant, "row-a");
    await insertFixtureMetricRow(db, otherTenant, "row-b");

    // CI connects as the database owner/superuser, which bypasses RLS even
    // when FORCE RLS is set. The probe must query as a restricted non-owner.
    await db.query(`set local role ${rlsProbeRole}`);
    await db.query("select set_config('app.current_org_id', $1, true)", [tenant]);
    const visible = await db.query<{ id: string }>(`select id from ${schema}.analytics_metric_rows order by id`);
    if (visible.rows.map((row) => row.id).join() !== "row-a") throw new Error("Actual analytics_metric_rows RLS tenant isolation failed");
  } finally {
    // Probe rows and their temporary RLS policy must not reach the importer
    // assertion below, which intentionally requires zero normalized rows.
    await db.query("reset role").catch(() => undefined);
    await db.query("rollback");
  }

  const probeRows = await db.query<{ total: number }>(`select count(*)::int as total from ${schema}.analytics_metric_rows`);
  const probePolicy = await db.query("select 1 from pg_policies where schemaname = $1 and tablename = 'analytics_metric_rows' and policyname = 'tenant_isolation'", [schema]);
  const probeRole = await db.query("select 1 from pg_roles where rolname = $1", [rlsProbeRole]);
  if (probeRows.rows[0]?.total !== 0 || probePolicy.rows.length !== 0 || probeRole.rows.length !== 0) {
    throw new Error("Fixture RLS probe rollback left rows, policy, or restricted role behind");
  }

  await db.query("select pg_advisory_lock(hashtext($1))", [advisoryKey]);
  const locked = await competingClient.query<{ locked: boolean }>("select pg_try_advisory_xact_lock(hashtext($1)) as locked", [advisoryKey]);
  if (locked.rows[0]?.locked !== false) throw new Error("Actual analytics advisory lock contract failed");
  await db.query("select pg_advisory_unlock(hashtext($1))", [advisoryKey]);
}

async function insertFixtureMetricRow(db: Client, orgId: string, id: string): Promise<void> {
  await db.query("select set_config('app.current_org_id', $1, true)", [orgId]);
  await db.query(`
    insert into ${schema}.analytics_metric_rows (
      id, org_id, source, widget_key, row_key, row_hash,
      requested_date_range, requested_aggregation, dimensions, metrics, raw_row,
      first_seen_run_id, last_seen_run_id
    )
    values ($1, $2, 'sisense', 'fixture-tracks', $3, $4, 'Last 30 days', 'Daily', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'fixture-run', 'fixture-run')
  `, [id, orgId, `key-${id}`, `hash-${id}`]);
}

async function createImporterTables(db: Client): Promise<void> {
  await db.query(`
    create table ${schema}.orgs (id text primary key);
    create table ${schema}.analytics_import_runs (
      id text primary key, org_id text not null, source text not null,
      artist_id text, release_id text, track_id text, mode text not null default 'sync',
      requested_date_range text, requested_aggregation text, status text not null default 'running',
      started_at timestamp default now(), completed_at timestamp,
      files_downloaded integer default 0, rows_imported integer default 0,
      rows_inserted integer default 0, rows_updated integer default 0, rows_unchanged integer default 0,
      error text, metadata jsonb
    );
    create table ${schema}.analytics_import_files (
      id text primary key, org_id text not null, run_id text not null, source text not null,
      dashboard_url text, widget_key text not null, widget_title text,
      artist_id text, release_id text, track_id text,
      requested_date_range text, requested_aggregation text, file_name text not null, local_path text,
      storage_bucket text, storage_key text, storage_status text not null default 'not_requested',
      storage_uploaded_at timestamptz, storage_error text,
      sha256 text not null, byte_size integer not null, row_count integer default 0, headers jsonb,
      created_at timestamp default now(),
      constraint analytics_import_files_storage_status_check check (storage_status in ('not_requested', 'pending', 'uploaded', 'failed'))
    );
    create table ${schema}.analytics_metric_rows (
      id text primary key, org_id text not null, source text not null, widget_key text not null,
      artist_id text, release_id text, track_id text, row_key text not null, row_hash text not null,
      requested_date_range text not null, requested_aggregation text not null,
      dimensions jsonb not null, metrics jsonb not null, raw_row jsonb not null,
      first_seen_run_id text, last_seen_run_id text, first_seen_at timestamp default now(), last_seen_at timestamp default now(),
      unique (org_id, source, widget_key, requested_aggregation, requested_date_range, row_key)
    );
    create table ${schema}.analytics_metric_changes (
      id text primary key, org_id text not null, run_id text not null, metric_row_id text not null,
      source text not null, widget_key text not null, artist_id text, release_id text, track_id text, row_key text not null,
      change_type text not null, previous_hash text, current_hash text, previous_raw_row jsonb, current_raw_row jsonb,
      changed_at timestamp default now()
    );
  `);
}

async function runImporter(args: string[], environment: Record<string, string>): Promise<{ status: number | null; output: string }> {
  const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, "scripts/sisense-sync.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}
