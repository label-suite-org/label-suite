/**
 * Live integration fixture for the local, disposable analytics_sandbox
 * database. It only accepts the dedicated URL and leaves the database itself
 * in place for the CI release gate to own.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { resolveAnalyticsSandboxConfig, type AnalyticsSandboxConfig } from "./analytics-sandbox-config";

async function main(): Promise<void> {
  const databaseUrl = process.env.ANALYTICS_SANDBOX_DB_URL ?? "";
  const orgId = `analytics-fixture-${randomUUID().replaceAll("-", "")}`;
  const sentinelOrgId = `analytics-sentinel-${randomUUID().replaceAll("-", "")}`;
  const config = resolveAnalyticsSandboxConfig({
    ANALYTICS_SANDBOX: "1",
    ANALYTICS_SANDBOX_DISPOSABLE: "1",
    ANALYTICS_SANDBOX_DB_URL: databaseUrl,
    ANALYTICS_SANDBOX_ORG_ID: orgId,
  });
  const client = new Client({ connectionString: config.databaseUrl });
  const contender = new Client({ connectionString: config.databaseUrl });
  let clientsConnected = false;
  let databaseVerified = false;

  try {
  await client.connect();
  await contender.connect();
  clientsConnected = true;

  await verifyDatabaseName(client);
  databaseVerified = true;
  await createFixtureOrganizations(client, config.orgId, sentinelOrgId);
  const sentinelBefore = await readSentinelOrganization(client, sentinelOrgId);
  await verifyAdvisoryLock(client, contender, config.orgId);

  await runSandboxSeed(config);
  const first = await readFixtureState(client, config.orgId);
  assertExactFixtureState(first);
  assertNoDuplicateIds(first);

  await runSandboxSeed(config);
  const second = await readFixtureState(client, config.orgId);
  assertExactFixtureState(second);
  assertNoDuplicateIds(second);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("Analytics sandbox seed is not idempotent across exact owned IDs.");
  }

  await runAnalyticsQueryProbe(config);

  await verifySentinelOrganization(client, sentinelBefore);
  console.log("analytics sandbox integration fixture passed");
  } finally {
    try {
      if (clientsConnected) {
        if (databaseVerified) {
          await removeTemporaryOrganizationRows(client, config.orgId);
          await removeTemporaryOrganizationRows(client, sentinelOrgId);
        }
      }
    } finally {
      await contender.end().catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

type FixtureTable = "artists" | "releases" | "tracks" | "analytics_import_runs" | "analytics_metric_rows";

interface TableState {
  count: number;
  ids: string[];
}

interface SentinelOrganization {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

type FixtureState = Record<FixtureTable, TableState>;

const expectedCounts: Record<FixtureTable, number> = {
  artists: 3,
  releases: 3,
  tracks: 5,
  analytics_import_runs: 1,
  analytics_metric_rows: 78,
};

async function verifyDatabaseName(db: Client): Promise<void> {
  const result = await db.query<{ database_name: string }>("select current_database() as database_name");
  if (result.rows[0]?.database_name !== "analytics_sandbox") {
    throw new Error("Refusing analytics sandbox integration target: connected database is not analytics_sandbox.");
  }
}

async function createFixtureOrganizations(db: Client, fixtureOrgId: string, sentinelId: string): Promise<void> {
  await db.query(
    "insert into label_suite.orgs (id, name, slug, plan) values ($1, $2, $3, $4), ($5, $6, $7, $8)",
    [
      fixtureOrgId, "Analytics sandbox fixture", fixtureOrgId, "internal",
      sentinelId, "Analytics sandbox sentinel", sentinelId, "internal",
    ],
  );
}

async function verifyAdvisoryLock(db: Client, competingClient: Client, fixtureOrgId: string): Promise<void> {
  const advisoryKey = `label-suite:${fixtureOrgId}:sisense`;
  await db.query("begin");
  await competingClient.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [advisoryKey]);
    const result = await competingClient.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
      [advisoryKey],
    );
    if (result.rows[0]?.locked !== false) {
      throw new Error("Analytics sandbox advisory lock was unexpectedly acquired by a competing transaction.");
    }
  } finally {
    await competingClient.query("rollback").catch(() => undefined);
    await db.query("rollback").catch(() => undefined);
  }
}

async function runAnalyticsQueryProbe(config: AnalyticsSandboxConfig): Promise<void> {
  const result = await runChild(process.execPath, ["--import", "tsx", "scripts/analytics-sandbox-query-probe.ts"], {
    DATABASE_URL: config.databaseUrl,
    ANALYTICS_SANDBOX_ORG_ID: config.orgId,
  });
  if (result.status !== 0) {
    throw new Error(`Analytics sandbox query probe failed: ${result.output}`);
  }
}

async function runChild(command: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}

async function runSandboxSeed(config: AnalyticsSandboxConfig): Promise<void> {
  const result = await runChild(process.execPath, ["--import", "tsx", "scripts/seed-analytics-sandbox.ts"], {
    ANALYTICS_SANDBOX: "1",
    ANALYTICS_SANDBOX_DISPOSABLE: "1",
    ANALYTICS_SANDBOX_DB_URL: config.databaseUrl,
    ANALYTICS_SANDBOX_ORG_ID: config.orgId,
  });

  if (result.status !== 0) {
    throw new Error(`Analytics sandbox seed command failed: ${result.output}`);
  }
}

async function readFixtureState(db: Client, fixtureOrgId: string): Promise<FixtureState> {
  const prefix = `sandbox-v1-${fixtureOrgId}:%`;
  const entries = await Promise.all((Object.keys(expectedCounts) as FixtureTable[]).map(async (table) => {
    const result = await db.query<{ count: number; ids: string[] }>(`
      select count(*)::int as count, coalesce(array_agg(id order by id), array[]::text[]) as ids
      from label_suite.${table}
      where org_id = $1 and id like $2
    `, [fixtureOrgId, prefix]);
    const row = result.rows[0];
    return [table, { count: row?.count ?? 0, ids: row?.ids ?? [] }] as const;
  }));

  return Object.fromEntries(entries) as FixtureState;
}

function assertExactFixtureState(state: FixtureState): void {
  for (const table of Object.keys(expectedCounts) as FixtureTable[]) {
    const expected = expectedCounts[table];
    const actual = state[table];
    if (actual.count !== expected || actual.ids.length !== expected) {
      throw new Error(`Analytics sandbox ${table} count mismatch: expected ${expected}, received ${actual.count}.`);
    }
  }
}

function assertNoDuplicateIds(state: FixtureState): void {
  for (const table of Object.keys(expectedCounts) as FixtureTable[]) {
    const ids = state[table].ids;
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Analytics sandbox ${table} contains duplicate deterministic IDs.`);
    }
  }
}

async function readSentinelOrganization(db: Client, sentinelId: string): Promise<SentinelOrganization> {
  const result = await db.query<SentinelOrganization>("select id, name, slug, plan from label_suite.orgs where id = $1", [sentinelId]);
  const sentinel = result.rows[0];
  if (result.rows.length !== 1 || !sentinel) {
    throw new Error("Analytics sandbox sentinel organization is missing.");
  }
  return sentinel;
}

async function verifySentinelOrganization(db: Client, before: SentinelOrganization): Promise<void> {
  const after = await readSentinelOrganization(db, before.id);
  if (
    after.id !== before.id
    || after.name !== before.name
    || after.slug !== before.slug
    || after.plan !== before.plan
  ) {
    throw new Error("Analytics sandbox sentinel organization was modified by the fixture seed.");
  }
}

async function removeTemporaryOrganizationRows(db: Client, fixtureOrgId: string): Promise<void> {
  await db.query("delete from label_suite.analytics_metric_changes where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.analytics_import_files where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.analytics_metric_rows where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.analytics_import_runs where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.tracks where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.releases where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.artists where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.audit_logs where org_id = $1", [fixtureOrgId]);
  await db.query("delete from label_suite.orgs where id = $1", [fixtureOrgId]);
}

await main();
