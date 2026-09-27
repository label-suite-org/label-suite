const DISPOSABLE_HOSTS = new Set(["localhost", "127.0.0.1", "postgres", "postgresql", "database"]);
const DISPOSABLE_DATABASE = /^royalty_lifecycle_test(?:_|$)/i;

export interface DisposableRoyaltyLifecycleTarget {
  databaseUrl?: string;
  testDatabase?: string;
  disposable?: string;
}

export function assertDisposableRoyaltyLifecycleTarget(input: DisposableRoyaltyLifecycleTarget): string {
  if (input.testDatabase !== "1" || input.disposable !== "1") {
    throw new Error("Refusing royalty lifecycle integration target: ROYALTY_LIFECYCLE_TEST_DATABASE=1 and ROYALTY_LIFECYCLE_TEST_DISPOSABLE=1 are required.");
  }

  let target: URL;
  try {
    target = new URL(input.databaseUrl ?? "");
  } catch {
    throw new Error("Refusing royalty lifecycle integration target: ROYALTY_LIFECYCLE_TEST_DATABASE_URL must be a valid local PostgreSQL URL.");
  }

  const databaseName = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol)
    || !DISPOSABLE_HOSTS.has(target.hostname.toLowerCase())
    || !DISPOSABLE_DATABASE.test(databaseName)
  ) {
    throw new Error("Refusing royalty lifecycle integration target: require an allowlisted local host and royalty_lifecycle_test database.");
  }

  return target.toString();
}
