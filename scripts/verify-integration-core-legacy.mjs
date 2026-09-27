import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migration = readFileSync(new URL("../drizzle/0058_integration_core_schema.sql", import.meta.url), "utf8");
const suffix = `${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
const schemas = [
  `integration_recovery_clean_${suffix}`,
  `integration_recovery_legacy_${suffix}`,
  `integration_recovery_invalid_${suffix}`,
];

function qi(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function rewriteMigration(schema) {
  return migration
    .replaceAll('"label_suite"', qi(schema))
    .replaceAll("'label_suite'", `'${schema}'`)
    .replace(/\blabel_suite\b/g, schema);
}

async function runMigration(client, schema) {
  for (const statement of rewriteMigration(schema).split(/--> statement-breakpoint/g)) {
    if (statement.trim()) await client.query(statement);
  }
}

async function setupBase(client, schema, legacy, confidenceValues = [null, 0, 0.7, 0.9, 1]) {
  const s = qi(schema);
  await client.query(`CREATE SCHEMA ${s}`);
  await client.query(`
    CREATE TABLE ${s}.orgs (id text PRIMARY KEY);
    INSERT INTO ${s}.orgs (id) VALUES ('true-nature'), ('other-org');
    CREATE TABLE ${s}."user" (id text PRIMARY KEY);
    INSERT INTO ${s}."user" (id) VALUES ('legacy-user');
    CREATE TABLE ${s}.audit_logs (
      id text PRIMARY KEY, org_id text, actor_user_id text, request_id text,
      action text, entity_type text, entity_id text, before_data jsonb,
      after_data jsonb, created_at timestamp
    );
    CREATE FUNCTION ${s}.current_org_id() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.current_org_id', true), '') $$;
    CREATE FUNCTION ${s}.enforce_same_org_references() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
    CREATE FUNCTION ${s}.write_audit_log() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
  `);
  if (!legacy) return;

  await client.query(`
    CREATE TABLE ${s}.integration_connections (
      id text PRIMARY KEY, org_id text NOT NULL, provider_key text NOT NULL,
      label text NOT NULL, status text NOT NULL DEFAULT 'connected',
      auth_type text NOT NULL, settings jsonb, auth_ref text,
      last_import_at timestamp, created_by text NOT NULL,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );
    INSERT INTO ${s}.integration_connections
      (id, org_id, provider_key, label, auth_type, settings, auth_ref, last_import_at, created_by)
    VALUES ('legacy-connection', 'true-nature', 'legacy_provider', 'Legacy', 'oauth', NULL,
      'legacy://auth/samply', '2026-07-27 10:00:00', 'legacy-user');

    CREATE TABLE ${s}.external_object_links (
      id text PRIMARY KEY, org_id text NOT NULL, connection_id text NOT NULL,
      provider_key text NOT NULL, external_object_type text NOT NULL,
      external_object_id text NOT NULL, external_object_url text,
      label_suite_object_type text NOT NULL, label_suite_object_id text NOT NULL,
      match_method text NOT NULL, match_confidence real,
      status text NOT NULL DEFAULT 'active', metadata jsonb, created_by text,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );
    CREATE TABLE ${s}.sync_jobs (
      id text PRIMARY KEY, org_id text NOT NULL, connection_id text NOT NULL,
      provider_key text NOT NULL, job_type text NOT NULL,
      status text NOT NULL, started_at timestamp DEFAULT now(),
      finished_at timestamp, records_seen integer DEFAULT 0, records_created integer DEFAULT 0,
      records_updated integer DEFAULT 0, records_skipped integer DEFAULT 0, records_failed integer DEFAULT 0,
      triggered_by text, error_summary text, created_at timestamp DEFAULT now(),
      dry_run boolean NOT NULL DEFAULT false
    );
    CREATE TABLE ${s}.data_quality_issues (
      id text PRIMARY KEY, org_id text NOT NULL, connection_id text,
      sync_job_id text, source text NOT NULL, issue_type text NOT NULL,
      dedupe_hash text NOT NULL, priority text NOT NULL, status text DEFAULT 'open' NOT NULL,
      label_suite_object_type text, label_suite_object_id text,
      external_object_type text, external_object_id text, details jsonb NOT NULL,
      resolved_at timestamp, resolved_by text, created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
    CREATE TABLE ${s}.audit_events (
      id text PRIMARY KEY, org_id text NOT NULL, actor_user_id text,
      actor_type text NOT NULL, event_type text NOT NULL,
      object_type text NOT NULL, object_id text NOT NULL, metadata jsonb NOT NULL,
      created_at timestamp DEFAULT now()
    );
  `);

  for (let index = 0; index < confidenceValues.length; index += 1) {
    const value = confidenceValues[index];
    await client.query(
      `INSERT INTO ${s}.external_object_links
        (id, org_id, connection_id, provider_key, external_object_type,
         external_object_id, label_suite_object_type, label_suite_object_id, match_method, match_confidence)
       VALUES ($1, 'true-nature', 'legacy-connection', 'legacy_provider', 'release', $2,
         'release', $2, 'manual', $3)`,
      [`legacy-link-${index}`, `external-${index}`, value],
    );
  }
  await client.query(`
    UPDATE ${s}.external_object_links
    SET external_object_url = 'https://legacy.example/releases/external-1',
        metadata = '{"legacy":true}', created_by = 'legacy-user'
    WHERE id = 'legacy-link-1';
    INSERT INTO ${s}.sync_jobs
      (id, org_id, connection_id, provider_key, job_type, status, records_seen,
       records_created, records_updated, records_skipped, records_failed, triggered_by, dry_run)
    VALUES ('legacy-job', 'true-nature', 'legacy-connection', 'legacy_provider',
      'pull', 'queued', NULL, NULL, NULL, 2, NULL, 'legacy-user', true);
    INSERT INTO ${s}.data_quality_issues
      (id, org_id, connection_id, sync_job_id, source, issue_type, dedupe_hash, priority, details,
       resolved_at, resolved_by)
    VALUES ('legacy-quality', 'true-nature', 'legacy-connection', 'legacy-job',
      'legacy', 'missing_release', 'legacy-dedupe', 'P2', '{}', '2026-07-28 12:00:00', 'legacy-user');
    INSERT INTO ${s}.audit_events
      (id, org_id, actor_user_id, actor_type, event_type, object_type, object_id, metadata)
    VALUES
      ('audit-1', 'true-nature', 'legacy-user', 'user', 'integration.link.changed', 'integration_link', 'legacy-link-1', '{"source":"legacy"}'),
      ('audit-2', 'true-nature', NULL, 'user', 'integration.link.changed', 'integration_link', 'legacy-link-2', '{"source":"legacy"}');
  `);
  await client.query(`
    ALTER TABLE ${s}.integration_connections
      ADD CONSTRAINT integration_connections_org_id_orgs_id_fk
      FOREIGN KEY (org_id) REFERENCES ${s}.orgs(id),
      ADD CONSTRAINT integration_connections_created_by_user_id_fk
      FOREIGN KEY (created_by) REFERENCES ${s}."user"(id);
    CREATE INDEX integration_connections_org_id_idx ON ${s}.integration_connections (org_id);
    CREATE INDEX integration_connections_org_provider_idx ON ${s}.integration_connections (org_id, provider_key);
    ALTER TABLE ${s}.external_object_links
      ADD CONSTRAINT external_object_links_org_id_orgs_id_fk
      FOREIGN KEY (org_id) REFERENCES ${s}.orgs(id);
    ALTER TABLE ${s}.external_object_links
      ADD CONSTRAINT external_object_links_connection_id_integration_connections_id_fk
      FOREIGN KEY (connection_id) REFERENCES ${s}.integration_connections(id),
      ADD CONSTRAINT external_object_links_created_by_user_id_fk
      FOREIGN KEY (created_by) REFERENCES ${s}."user"(id);
    ALTER TABLE ${s}.sync_jobs
      ADD CONSTRAINT sync_jobs_org_id_orgs_id_fk
      FOREIGN KEY (org_id) REFERENCES ${s}.orgs(id),
      ADD CONSTRAINT sync_jobs_connection_id_integration_connections_id_fk
      FOREIGN KEY (connection_id) REFERENCES ${s}.integration_connections(id),
      ADD CONSTRAINT sync_jobs_triggered_by_user_id_fk
      FOREIGN KEY (triggered_by) REFERENCES ${s}."user"(id);
    CREATE INDEX sync_jobs_org_created_idx ON ${s}.sync_jobs (org_id, created_at);
    CREATE INDEX sync_jobs_connection_created_idx ON ${s}.sync_jobs (connection_id, created_at);
    ALTER TABLE ${s}.data_quality_issues
      ADD CONSTRAINT data_quality_issues_org_id_orgs_id_fk
      FOREIGN KEY (org_id) REFERENCES ${s}.orgs(id),
      ADD CONSTRAINT data_quality_issues_connection_id_integration_connections_id_fk
      FOREIGN KEY (connection_id) REFERENCES ${s}.integration_connections(id),
      ADD CONSTRAINT data_quality_issues_sync_job_id_sync_jobs_id_fk
      FOREIGN KEY (sync_job_id) REFERENCES ${s}.sync_jobs(id),
      ADD CONSTRAINT data_quality_issues_resolved_by_user_id_fk
      FOREIGN KEY (resolved_by) REFERENCES ${s}."user"(id);
    CREATE UNIQUE INDEX data_quality_issues_dedupe_hash_unique_idx
      ON ${s}.data_quality_issues (dedupe_hash);
    CREATE INDEX data_quality_issues_org_source_status_idx
      ON ${s}.data_quality_issues (org_id, source, status);
    CREATE INDEX data_quality_issues_org_status_priority_idx
      ON ${s}.data_quality_issues (org_id, status, priority);
    ALTER TABLE ${s}.audit_events
      ADD CONSTRAINT audit_events_org_id_orgs_id_fk
      FOREIGN KEY (org_id) REFERENCES ${s}.orgs(id),
      ADD CONSTRAINT audit_events_actor_user_id_user_id_fk
      FOREIGN KEY (actor_user_id) REFERENCES ${s}."user"(id);
    CREATE INDEX audit_events_org_created_idx ON ${s}.audit_events (org_id, created_at);
    CREATE UNIQUE INDEX external_object_links_external_unique_idx
      ON ${s}.external_object_links (org_id, connection_id, external_object_type, external_object_id);
    CREATE INDEX external_object_links_object_idx
      ON ${s}.external_object_links (org_id, label_suite_object_type, label_suite_object_id);
  `);
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0]?.value;
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

async function assertIndexesAndConstraints(client, schema) {
  const indexCount = await scalar(client, `
    SELECT count(*)::integer AS value
    FROM pg_indexes
    WHERE schemaname = $1
      AND indexname = ANY($2::text[])
  `, [schema, [
    "integration_connections_org_provider_label_unique_idx",
    "external_object_links_external_unique_idx",
    "sync_jobs_org_connection_idempotency_unique_idx",
    "data_quality_issues_org_idempotency_unique_idx",
  ]]);
  expectEqual(indexCount, 4, `${schema} canonical indexes`);

  const expectedConstraints = {
    integration_connections: 4,
    external_object_links: 5,
    sync_jobs: 5,
    data_quality_issues: 5,
    audit_events: 3,
  };
  for (const [table, minimum] of Object.entries(expectedConstraints)) {
    const validatedCount = await scalar(client, `
      SELECT count(*)::integer AS value
      FROM pg_constraint
      WHERE conrelid = $1::regclass AND convalidated AND contype IN ('f', 'c')
    `, [`${schema}.${table}`]);
    if (validatedCount < minimum) throw new Error(`${schema}.${table} constraints are not validated: ${validatedCount}`);
  }
}

async function assertLegacyRows(client, schema) {
  const s = qi(schema);
  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM ${s}.integration_connections)::integer AS connections,
      (SELECT count(*) FROM ${s}.external_object_links)::integer AS links,
      (SELECT count(*) FROM ${s}.sync_jobs)::integer AS jobs,
      (SELECT count(*) FROM ${s}.data_quality_issues)::integer AS quality,
      (SELECT count(*) FROM ${s}.audit_events)::integer AS audits
  `);
  expectEqual(counts.rows[0].connections, 3, `${schema} connection rows after bridge writes`);
  expectEqual(counts.rows[0].links, 5, `${schema} link rows`);
  expectEqual(counts.rows[0].jobs, 1, `${schema} sync rows`);
  expectEqual(counts.rows[0].quality, 1, `${schema} quality rows`);
  expectEqual(counts.rows[0].audits, 2, `${schema} audit rows`);

  const connection = await client.query(`
    SELECT provider_id, provider_key, settings::text AS settings, auth_type, auth_ref,
      to_char(last_import_at, 'YYYY-MM-DD HH24:MI:SS') AS last_import_at
    FROM ${s}.integration_connections WHERE id = 'legacy-connection'
  `);
  if (!connection.rows[0].provider_id.startsWith("provider_legacy_")) throw new Error(`${schema} provider backfill missing`);
  expectEqual(connection.rows[0].provider_key, "legacy_provider", `${schema} provider key`);
  expectEqual(connection.rows[0].settings, "{}", `${schema} connection settings`);
  expectEqual(connection.rows[0].auth_type, "oauth", `${schema} connection auth type`);
  expectEqual(connection.rows[0].auth_ref, "legacy://auth/samply", `${schema} auth ref preservation`);
  expectEqual(connection.rows[0].last_import_at, "2026-07-27 10:00:00", `${schema} last import preservation`);

  const confidence = await client.query(`
    SELECT id, match_confidence FROM ${s}.external_object_links ORDER BY id
  `);
  const expectedConfidence = [null, 0, 70, 90, 100];
  confidence.rows.forEach((row, index) => expectEqual(row.match_confidence, expectedConfidence[index], `${schema} confidence ${row.id}`));
  const external = await client.query(`
    SELECT external_object_url, metadata::text AS metadata, created_by, match_method
    FROM ${s}.external_object_links WHERE id = 'legacy-link-1'
  `);
  expectEqual(external.rows[0].external_object_url, "https://legacy.example/releases/external-1", `${schema} external URL preservation`);
  expectEqual(external.rows[0].metadata, '{"legacy": true}', `${schema} external metadata preservation`);
  expectEqual(external.rows[0].created_by, "legacy-user", `${schema} external creator preservation`);
  expectEqual(external.rows[0].match_method, "manual", `${schema} external match method preservation`);
  const matchMethodDefinition = await client.query(`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'external_object_links' AND column_name = 'match_method'
  `, [schema]);
  expectEqual(matchMethodDefinition.rows[0].is_nullable, "NO", `${schema} match method nullability`);
  expectEqual(matchMethodDefinition.rows[0].column_default, null, `${schema} match method default`);

  const sync = await client.query(`
    SELECT records_seen, records_created, records_updated, records_failed,
      records_skipped, triggered_by, idempotency_key, updated_at, dry_run
    FROM ${s}.sync_jobs WHERE id = 'legacy-job'
  `);
  for (const field of ["records_seen", "records_created", "records_updated", "records_failed"]) {
    expectEqual(sync.rows[0][field], 0, `${schema} ${field} backfill`);
  }
  expectEqual(sync.rows[0].records_skipped, 2, `${schema} records_skipped preservation`);
  expectEqual(sync.rows[0].idempotency_key, "06bc10235cd263215fdf91cb70293a5c", `${schema} sync idempotency backfill`);
  expectEqual(sync.rows[0].triggered_by, "legacy-user", `${schema} sync trigger preservation`);
  if (!sync.rows[0].updated_at || !sync.rows[0].dry_run) throw new Error(`${schema} sync legacy fields were not preserved`);

  const syncColumns = await client.query(`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'sync_jobs'
      AND column_name = ANY($2::text[])
  `, [schema, ["status", "started_at", "dry_run", "records_seen", "records_created", "records_updated", "records_skipped", "records_failed"]]);
  const syncDefinitions = Object.fromEntries(syncColumns.rows.map((row) => [row.column_name, row]));
  expectEqual(syncDefinitions.status.column_default, null, `${schema} legacy sync status default`);
  if (!syncDefinitions.started_at.column_default?.includes("now()")) throw new Error(`${schema} sync started_at default changed`);
  expectEqual(syncDefinitions.dry_run.is_nullable, "NO", `${schema} sync dry_run nullability`);
  if (!syncDefinitions.dry_run.column_default?.includes("false")) throw new Error(`${schema} sync dry_run default changed`);
  for (const field of ["records_seen", "records_created", "records_updated", "records_failed"]) {
    expectEqual(syncDefinitions[field].is_nullable, "NO", `${schema} ${field} nullability`);
    if (!syncDefinitions[field].column_default?.includes("0")) throw new Error(`${schema} ${field} default changed`);
  }
  expectEqual(syncDefinitions.records_skipped.is_nullable, "YES", `${schema} records_skipped nullability`);
  if (!syncDefinitions.records_skipped.column_default?.includes("0")) throw new Error(`${schema} records_skipped default changed`);

  const quality = await client.query(`
    SELECT idempotency_key, dedupe_hash, priority, details::text AS details,
      to_char(resolved_at, 'YYYY-MM-DD HH24:MI:SS') AS resolved_at, resolved_by
    FROM ${s}.data_quality_issues WHERE id = 'legacy-quality'
  `);
  expectEqual(quality.rows[0].idempotency_key, "legacy-dedupe", `${schema} quality idempotency backfill`);
  expectEqual(quality.rows[0].dedupe_hash, "legacy-dedupe", `${schema} dedupe hash preservation`);
  expectEqual(quality.rows[0].priority, "P2", `${schema} quality priority preservation`);
  expectEqual(quality.rows[0].details, "{}", `${schema} quality details normalization`);
  expectEqual(quality.rows[0].resolved_by, "legacy-user", `${schema} quality resolver preservation`);
  expectEqual(quality.rows[0].resolved_at, "2026-07-28 12:00:00", `${schema} quality resolution time preservation`);
  const qualityColumns = await client.query(`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'data_quality_issues'
      AND column_name = ANY($2::text[])
  `, [schema, ["details", "status"]]);
  const qualityDefinitions = Object.fromEntries(qualityColumns.rows.map((row) => [row.column_name, row]));
  expectEqual(qualityDefinitions.details.is_nullable, "NO", `${schema} quality details nullability`);
  if (!qualityDefinitions.details.column_default?.includes("{}")) throw new Error(`${schema} quality details default changed`);
  expectEqual(qualityDefinitions.status.is_nullable, "NO", `${schema} quality status nullability`);
  if (!qualityDefinitions.status.column_default?.includes("open")) throw new Error(`${schema} quality status default changed`);

  const audits = await client.query(`
    SELECT id, actor_user_id, actor_type, object_id, metadata::text AS metadata, before, after
    FROM ${s}.audit_events ORDER BY id
  `);
  expectEqual(audits.rows[0].id, "audit-1", `${schema} first audit id`);
  expectEqual(audits.rows[1].id, "audit-2", `${schema} second audit id`);
  expectEqual(audits.rows[0].object_id, "legacy-link-1", `${schema} first audit object`);
  expectEqual(audits.rows[1].object_id, "legacy-link-2", `${schema} second audit object`);
  expectEqual(audits.rows[0].actor_user_id, "legacy-user", `${schema} audit actor preservation`);
  if (audits.rows.some((row) => row.actor_type !== "user")) throw new Error(`${schema} audit actor type changed`);
  expectEqual(audits.rows[0].metadata, '{"source": "legacy"}', `${schema} audit metadata`);
  if (audits.rows.some((row) => row.before !== null || row.after !== null)) throw new Error(`${schema} audit payloads changed`);

  const types = await client.query(`
    SELECT column_name, udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'external_object_links' AND column_name = 'match_confidence'
  `, [schema]);
  expectEqual(types.rows[0]?.udt_name, "int4", `${schema} confidence type`);
  const noFalseProvider = await scalar(client, `SELECT count(*)::integer AS value FROM ${s}.integration_providers WHERE key = 'legacy_unknown'`);
  expectEqual(noFalseProvider, 0, `${schema} false legacy provider count`);
  await assertIndexesAndConstraints(client, schema);
}

async function assertClean(client, schema) {
  const tableCount = await scalar(client, `
    SELECT count(*)::integer AS value FROM pg_tables
    WHERE schemaname = $1 AND tablename = ANY($2::text[])
  `, [schema, ["integration_providers", "integration_connections", "external_object_links", "sync_jobs", "raw_integration_events", "integration_errors", "data_quality_issues", "audit_events"]]);
  expectEqual(tableCount, 8, `${schema} clean core table count`);
  expectEqual(await scalar(client, `SELECT count(*)::integer AS value FROM ${qi(schema)}.integration_providers`), 3, `${schema} seeded provider count`);
}

async function exerciseBridge(client, schema) {
  const s = qi(schema);
  await client.query("SET app.current_org_id = 'true-nature'");
  await client.query(`
    INSERT INTO ${s}.integration_connections
      (id, org_id, provider_key, label, auth_type, created_by)
    VALUES ('legacy-write', 'true-nature', 'legacy_provider', 'Old writer', 'oauth', 'legacy-user');
  `);
  const providerId = await scalar(client, `SELECT id AS value FROM ${s}.integration_providers WHERE org_id = 'true-nature' AND key = 'legacy_provider'`);
  await client.query(`
    INSERT INTO ${s}.integration_connections
      (id, org_id, provider_id, label, created_by)
    VALUES ('new-write', 'true-nature', $1, 'New writer', 'legacy-user')
  `, [providerId]);
  const bridgeRows = await client.query(`
    SELECT id, provider_key, auth_type FROM ${s}.integration_connections
    WHERE id IN ('legacy-write', 'new-write') ORDER BY id
  `);
  expectEqual(bridgeRows.rows[0].provider_key, "legacy_provider", "legacy write provider key");
  expectEqual(bridgeRows.rows[1].provider_key, "legacy_provider", "new write provider key");
  expectEqual(bridgeRows.rows[1].auth_type, "oauth", "new write provider auth type");

  let rejected = false;
  try {
    await client.query(`
      INSERT INTO ${s}.integration_connections
        (id, org_id, provider_id, provider_key, label, auth_type, created_by)
      VALUES ('mismatch-write', 'true-nature', 'provider_samply', 'legacy_provider', 'Mismatch', 'api_key', 'legacy-user')
    `);
  } catch (error) {
    rejected = error?.message?.includes("provider_key/provider_id mismatch") === true;
  }
  if (!rejected) throw new Error("provider key/id mismatch was not rejected");

  rejected = false;
  try {
    await client.query(`
      INSERT INTO ${s}.integration_connections
        (id, org_id, provider_id, provider_key, label, auth_type, created_by)
      VALUES ('auth-mismatch-write', 'true-nature', $1, 'legacy_provider', 'Auth mismatch', 'api_key', 'legacy-user')
    `, [providerId]);
  } catch (error) {
    rejected = error?.message?.includes("auth_type/provider_id mismatch") === true;
  }
  if (!rejected) throw new Error("provider auth mismatch was not rejected");

  rejected = false;
  try {
    await client.query(`
      INSERT INTO ${s}.integration_connections
        (id, org_id, provider_id, label, created_by)
      VALUES ('cross-tenant-write', 'other-org', $1, 'Cross tenant', 'legacy-user')
    `, [providerId]);
  } catch (error) {
    rejected = error?.message?.includes("belongs to organization") === true;
  }
  if (!rejected) throw new Error("cross-tenant provider write was not rejected");
}

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const [clean, legacy, invalid] = schemas;
  await setupBase(client, clean, false);
  await runMigration(client, clean);
  await assertClean(client, clean);

  await setupBase(client, legacy, true);
  await runMigration(client, legacy);
  await exerciseBridge(client, legacy);
  await assertLegacyRows(client, legacy);
  await runMigration(client, legacy);
  await assertLegacyRows(client, legacy);

  await setupBase(client, invalid, true, [1.1]);
  let rejectedInvalid = false;
  try {
    await runMigration(client, invalid);
  } catch (error) {
    rejectedInvalid = error?.message?.includes("normalized range 0..1") === true;
  }
  if (!rejectedInvalid) throw new Error("out-of-domain legacy confidence was not rejected");

  console.log("integration core legacy fixture: clean, legacy, bridge, rejection, and idempotent rerun passed");
} finally {
  for (const schema of schemas.reverse()) {
    await client.query(`DROP SCHEMA IF EXISTS ${qi(schema)} CASCADE`);
  }
  await client.end();
}
