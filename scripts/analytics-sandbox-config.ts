export const SANDBOX_FIXTURE_VERSION = "analytics-sandbox-v1";

const SANDBOX_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "postgres",
  "postgresql",
  "database",
  "analytics-sandbox-postgres",
]);
const SANDBOX_DATABASE_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SANDBOX_ORG_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export interface AnalyticsSandboxConfig {
  databaseUrl: string;
  orgId: string;
  fixtureVersion: typeof SANDBOX_FIXTURE_VERSION;
}

export function resolveAnalyticsSandboxConfig(env: NodeJS.ProcessEnv): AnalyticsSandboxConfig {
  if (env.ANALYTICS_SANDBOX !== "1") {
    refuse("ANALYTICS_SANDBOX must equal 1.");
  }
  if (env.ANALYTICS_SANDBOX_DISPOSABLE !== "1") {
    refuse("ANALYTICS_SANDBOX_DISPOSABLE must equal 1.");
  }

  const orgId = env.ANALYTICS_SANDBOX_ORG_ID ?? "";
  if (!SANDBOX_ORG_ID.test(orgId)) {
    refuse("ANALYTICS_SANDBOX_ORG_ID must match ^[a-z0-9][a-z0-9_-]{1,63}$.");
  }

  const databaseUrl = env.ANALYTICS_SANDBOX_DB_URL ?? "";
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    refuse("ANALYTICS_SANDBOX_DB_URL must be a valid PostgreSQL URL.");
  }

  let databasePath: string;
  try {
    databasePath = decodeURIComponent(target.pathname);
  } catch {
    refuse("ANALYTICS_SANDBOX_DB_URL must use valid percent encoding.");
  }

  if (
    !SANDBOX_DATABASE_PROTOCOLS.has(target.protocol)
    || !SANDBOX_DATABASE_HOSTS.has(target.hostname.toLowerCase())
    || target.search !== ""
    || target.hash !== ""
    || databasePath !== "/analytics_sandbox"
  ) {
    refuse("require an allowlisted local PostgreSQL analytics_sandbox database.");
  }

  return { databaseUrl, orgId, fixtureVersion: SANDBOX_FIXTURE_VERSION };
}

function refuse(message: string): never {
  throw new Error(`Refusing analytics sandbox target: ${message}`);
}
