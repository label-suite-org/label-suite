const DISPOSABLE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "postgres",
  "postgresql",
  "database",
  "analytics-fixture-postgres",
]);
const DISPOSABLE_DATABASE = /^analytics_fixture(?:_|$)/i;
const DISPOSABLE_SCHEMA = /^analytics_fixture_[a-z0-9_]+$/i;
const POSTGRES_USER = /^[a-z_][a-z0-9_.-]*$/i;

export interface ForcedFailureFixtureTarget {
  databaseUrl?: string;
  schema?: string;
  fixtureDb?: string;
  fixtureDisposable?: string;
}

export interface MigratedAnalyticsFixtureTarget {
  databaseUrl?: string;
  fixtureDb?: string;
  fixtureDisposable?: string;
}

interface CanonicalPostgresTarget {
  hostname: string;
  databaseName: string;
  username: string;
  port: string;
}

function canonicalPostgresTarget(databaseUrl: string | undefined, refusal: string): CanonicalPostgresTarget {
  let target: URL;
  let databaseName: string;
  let username: string;
  try {
    target = new URL(databaseUrl ?? "");
    databaseName = decodeURIComponent(target.pathname).replace(/^\/+/, "");
    username = decodeURIComponent(target.username);
  } catch {
    throw new Error(refusal);
  }

  const port = target.port || "5432";
  if (
    !["postgres:", "postgresql:"].includes(target.protocol)
    || target.search !== ""
    || target.hash !== ""
    || !target.hostname
    || !databaseName
    || !POSTGRES_USER.test(username)
    || (port !== "5432" && !(port === "55432" && target.hostname === "127.0.0.1"))
  ) {
    throw new Error(refusal);
  }
  return {
    hostname: target.hostname.toLowerCase(),
    databaseName,
    username,
    port,
  };
}

/**
 * The failure seam is deliberately write-capable, so marker variables alone
 * are insufficient. Require both a local fixture host/database and its unique
 * fixture schema before allowing it to run.
 */
export function assertDisposableForcedFailureTarget(input: ForcedFailureFixtureTarget): void {
  if (input.fixtureDb !== "1" || input.fixtureDisposable !== "1") {
    throw new Error("SISENSE_TEST_FAIL_AFTER_RAW_STAGING requires ANALYTICS_FIXTURE_DB=1 and ANALYTICS_FIXTURE_DISPOSABLE=1.");
  }
  assertDisposableAnalyticsFixtureTarget(input);
}

export function assertDisposableAnalyticsFixtureTarget(input: Pick<ForcedFailureFixtureTarget, "databaseUrl" | "schema">): void {
  const target = canonicalPostgresTarget(
    input.databaseUrl,
    "Refusing fixture target: DATABASE_URL must be a canonical PostgreSQL URL without query parameters or fragments for an allowlisted disposable analytics_fixture database.",
  );
  if (
    !DISPOSABLE_HOSTS.has(target.hostname)
    || !DISPOSABLE_DATABASE.test(target.databaseName)
    || !DISPOSABLE_SCHEMA.test(input.schema ?? "")
  ) {
    throw new Error("Refusing fixture target: require an allowlisted local host, analytics_fixture database, and analytics_fixture_<id> schema.");
  }
}

/**
 * The Spotify fixture exercises the shipped adapter's schema-qualified SQL,
 * so it must use a fully migrated disposable database instead of a shadow
 * schema. Keep both opt-in markers and the same local host/database allowlist.
 */
export function assertDisposableMigratedAnalyticsFixtureTarget(input: MigratedAnalyticsFixtureTarget): void {
  if (input.fixtureDb !== "1" || input.fixtureDisposable !== "1") {
    throw new Error("Migrated analytics fixtures require ANALYTICS_FIXTURE_DB=1 and ANALYTICS_FIXTURE_DISPOSABLE=1.");
  }

  const target = canonicalPostgresTarget(
    input.databaseUrl,
    "Refusing migrated fixture target: ANALYTICS_FIXTURE_DB_URL must be a canonical PostgreSQL URL without query parameters or fragments for an allowlisted disposable analytics_fixture database.",
  );
  if (
    !DISPOSABLE_HOSTS.has(target.hostname)
    || !DISPOSABLE_DATABASE.test(target.databaseName)
  ) {
    throw new Error("Refusing migrated fixture target: require an allowlisted local host and analytics_fixture database.");
  }
}
