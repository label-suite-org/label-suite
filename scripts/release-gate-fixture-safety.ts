const ALLOWED_RELEASE_GATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "postgres",
  "database",
]);
const LOCAL_RELEASE_GATE_DATABASE = /^label_suite_release_gate(?:_[a-z0-9]+(?:_[a-z0-9]+)*)?$/;
const REFUSAL = "Refusing release-gate fixture target";

export interface ReleaseGateFixtureTarget {
  databaseUrl?: string;
  fixtureDisposable?: string;
  userEmail?: string;
  userPassword?: string;
  ci?: string;
  analyticsFixtureDb?: string;
  analyticsFixtureDisposable?: string;
}

export interface ValidatedReleaseGateFixtureTarget {
  mode: "ci" | "local";
  host: string;
  database: string;
}

export function assertDisposableReleaseGateTarget(
  input: ReleaseGateFixtureTarget,
): ValidatedReleaseGateFixtureTarget {
  if (input.fixtureDisposable !== "1") {
    throw new Error(`${REFUSAL}: RELEASE_GATE_FIXTURE_DISPOSABLE=1 is required.`);
  }
  if (!input.userEmail?.trim() || !input.userPassword?.trim()) {
    throw new Error(`${REFUSAL}: explicit nonempty E2E_USER_EMAIL and E2E_USER_PASSWORD are required.`);
  }

  let target: URL;
  try {
    target = new URL(input.databaseUrl ?? "");
  } catch {
    throw new Error(`${REFUSAL}: DATABASE_URL must be a valid PostgreSQL URL.`);
  }

  let database: string;
  try {
    database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  } catch {
    throw new Error(`${REFUSAL}: DATABASE_URL contains an invalid database name.`);
  }
  const host = target.hostname.toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(target.protocol)
    || !ALLOWED_RELEASE_GATE_HOSTS.has(host)
    || !database
  ) {
    throw new Error(`${REFUSAL}: require PostgreSQL, an allowlisted local host, and an explicit disposable database.`);
  }

  if (input.ci === "true") {
    if (
      database !== "label_suite"
      || input.analyticsFixtureDb !== "1"
      || input.analyticsFixtureDisposable !== "1"
    ) {
      throw new Error(`${REFUSAL}: CI requires the exact label_suite database and both analytics fixture markers.`);
    }
    return { mode: "ci", host, database };
  }

  if (!LOCAL_RELEASE_GATE_DATABASE.test(database)) {
    throw new Error(`${REFUSAL}: local runs require a label_suite_release_gate database name.`);
  }
  return { mode: "local", host, database };
}
