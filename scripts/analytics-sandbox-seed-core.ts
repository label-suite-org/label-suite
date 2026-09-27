import type { AnalyticsSandboxConfig } from "./analytics-sandbox-config";
import { SANDBOX_ID_PREFIX, buildAnalyticsSandboxFixture } from "./analytics-sandbox-fixtures";

export interface SeedQueryClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface AnalyticsSandboxSeedSummary {
  fixtureVersion: "analytics-sandbox-v1";
  orgId: string;
  artists: 3;
  releases: 3;
  tracks: 5;
  metricRows: number;
  importRuns: 1;
}

const requiredTables = [
  "label_suite.orgs",
  "label_suite.artists",
  "label_suite.releases",
  "label_suite.tracks",
  "label_suite.analytics_import_runs",
  "label_suite.analytics_metric_rows",
  "label_suite.analytics_metric_changes",
  "label_suite.analytics_import_files",
] as const;

const missingMigrationMessage = "Analytics sandbox database is not migrated; run npm run db:migrate against analytics_sandbox.";
const writeFailureMessage = "Analytics sandbox write did not affect the expected record.";

export async function seedAnalyticsSandbox(
  client: SeedQueryClient,
  config: AnalyticsSandboxConfig,
): Promise<AnalyticsSandboxSeedSummary> {
  const fixture = buildAnalyticsSandboxFixture(config.orgId);
  const sandboxIdPattern = `${SANDBOX_ID_PREFIX}${config.orgId}:%`;

  try {
    await client.query("begin");
    for (const table of requiredTables) {
      const result = await client.query<{ table_ref: string | null }>("select to_regclass($1) as table_ref", [table]);
      if (result.rows[0]?.table_ref === null || result.rows.length === 0) throw new Error(missingMigrationMessage);
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`label-suite:${config.orgId}:sisense`]);
    const organization = await client.query<{ id: string }>("select id from label_suite.orgs where id = $1", [config.orgId]);
    if (organization.rows.length === 0) throw new Error(`Analytics sandbox organization does not exist: ${config.orgId}`);

    for (const artist of fixture.artists) {
      const result = await client.query<{ id: string }>(`
        insert into label_suite.artists (id, org_id, name, created_at, updated_at)
        values ($1, $2, $3, $4, $5)
        on conflict (id) do update
        set name = excluded.name, created_at = excluded.created_at, updated_at = excluded.updated_at
        where label_suite.artists.org_id = excluded.org_id
        returning id
      `, [artist.id, artist.org_id, artist.name, artist.created_at, artist.updated_at]);
      requireExpectedWrite(result, artist.id);
    }
    for (const release of fixture.releases) {
      const result = await client.query<{ id: string }>(`
        insert into label_suite.releases (id, org_id, title, artist_id, release_date, status, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update
        set title = excluded.title, artist_id = excluded.artist_id, release_date = excluded.release_date,
          status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at
        where label_suite.releases.org_id = excluded.org_id
        returning id
      `, [
        release.id,
        release.org_id,
        release.title,
        release.artist_id,
        release.release_date,
        release.status,
        release.created_at,
        release.updated_at,
      ]);
      requireExpectedWrite(result, release.id);
    }
    for (const track of fixture.tracks) {
      const result = await client.query<{ id: string }>(`
        insert into label_suite.tracks (id, org_id, title, release_id, position, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update
        set title = excluded.title, release_id = excluded.release_id, position = excluded.position,
          created_at = excluded.created_at, updated_at = excluded.updated_at
        where label_suite.tracks.org_id = excluded.org_id
        returning id
      `, [track.id, track.org_id, track.title, track.release_id, track.position, track.created_at, track.updated_at]);
      requireExpectedWrite(result, track.id);
    }

    await client.query(`
      delete from label_suite.analytics_metric_changes as changes
      using label_suite.analytics_metric_rows as metric_rows, label_suite.analytics_import_runs as import_runs
      where changes.org_id = $1
        and changes.metric_row_id = metric_rows.id
        and changes.run_id = import_runs.id
        and metric_rows.org_id = $1
        and metric_rows.id like $2
        and metric_rows.dimensions ->> '_sandbox_fixture' = $3
        and import_runs.org_id = $1
        and import_runs.id like $2
        and import_runs.metadata ->> 'sandbox_fixture' = $3
    `, [config.orgId, sandboxIdPattern, config.fixtureVersion]);
    await client.query(`
      delete from label_suite.analytics_import_files as files
      using label_suite.analytics_import_runs as import_runs
      where files.org_id = $1
        and files.run_id = import_runs.id
        and import_runs.org_id = $1
        and import_runs.id like $2
        and import_runs.metadata ->> 'sandbox_fixture' = $3
    `, [config.orgId, sandboxIdPattern, config.fixtureVersion]);
    await client.query(`
      delete from label_suite.analytics_metric_rows
      where org_id = $1 and id like $2 and dimensions ->> '_sandbox_fixture' = $3
    `, [config.orgId, sandboxIdPattern, config.fixtureVersion]);
    await client.query(`
      delete from label_suite.analytics_import_runs
      where org_id = $1 and id like $2 and metadata ->> 'sandbox_fixture' = $3
    `, [config.orgId, sandboxIdPattern, config.fixtureVersion]);

    for (const run of fixture.importRuns) {
      const result = await client.query<{ id: string }>(`
        insert into label_suite.analytics_import_runs (
          id, org_id, source, artist_id, release_id, track_id, mode, requested_date_range,
          requested_aggregation, status, started_at, completed_at, files_downloaded, rows_imported,
          rows_inserted, rows_updated, rows_unchanged, error, metadata
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) on conflict (id) do update
        set org_id = excluded.org_id, source = excluded.source, artist_id = excluded.artist_id,
          release_id = excluded.release_id, track_id = excluded.track_id, mode = excluded.mode,
          requested_date_range = excluded.requested_date_range,
          requested_aggregation = excluded.requested_aggregation, status = excluded.status,
          started_at = excluded.started_at, completed_at = excluded.completed_at,
          files_downloaded = excluded.files_downloaded, rows_imported = excluded.rows_imported,
          rows_inserted = excluded.rows_inserted, rows_updated = excluded.rows_updated,
          rows_unchanged = excluded.rows_unchanged, error = excluded.error, metadata = excluded.metadata
        where label_suite.analytics_import_runs.org_id = excluded.org_id
        returning id
      `, [
        run.id, run.org_id, run.source, run.artist_id, run.release_id, run.track_id, run.mode,
        run.requested_date_range, run.requested_aggregation, run.status, run.started_at,
        run.completed_at, run.files_downloaded, run.rows_imported, run.rows_inserted, run.rows_updated,
        run.rows_unchanged, run.error, run.metadata,
      ]);
      requireExpectedWrite(result, run.id);
    }
    for (const row of fixture.metricRows) {
      const result = await client.query<{ id: string }>(`
        insert into label_suite.analytics_metric_rows (
          id, org_id, source, widget_key, artist_id, release_id, track_id, row_key, row_hash,
          requested_date_range, requested_aggregation, dimensions, metrics, raw_row,
          first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        on conflict (id) do update
        set org_id = excluded.org_id, source = excluded.source, widget_key = excluded.widget_key,
          artist_id = excluded.artist_id, release_id = excluded.release_id, track_id = excluded.track_id,
          row_key = excluded.row_key, row_hash = excluded.row_hash,
          requested_date_range = excluded.requested_date_range,
          requested_aggregation = excluded.requested_aggregation, dimensions = excluded.dimensions,
          metrics = excluded.metrics, raw_row = excluded.raw_row,
          first_seen_run_id = excluded.first_seen_run_id, last_seen_run_id = excluded.last_seen_run_id,
          first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at
        where label_suite.analytics_metric_rows.org_id = excluded.org_id
        returning id
      `, [
        row.id, row.org_id, row.source, row.widget_key, row.artist_id, row.release_id, row.track_id,
        row.row_key, row.row_hash, row.requested_date_range, row.requested_aggregation, row.dimensions,
        row.metrics, row.raw_row, row.first_seen_run_id, row.last_seen_run_id, row.first_seen_at,
        row.last_seen_at,
      ]);
      requireExpectedWrite(result, row.id);
    }

    await client.query("commit");
    return {
      fixtureVersion: config.fixtureVersion,
      orgId: config.orgId,
      artists: 3,
      releases: 3,
      tracks: 5,
      metricRows: fixture.metricRows.length,
      importRuns: 1,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

function requireExpectedWrite(result: { rows: Array<{ id: string }> }, expectedId: string): void {
  if (result.rows.length !== 1 || result.rows[0]?.id !== expectedId) throw new Error(writeFailureMessage);
}
