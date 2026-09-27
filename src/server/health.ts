import { readFileSync } from "node:fs";

export interface PublicHealthResponse {
  status: "ok" | "degraded" | "unhealthy";
  web: "ok";
  database: "ok" | "unavailable";
  worker: "ok" | "unavailable" | "unknown";
  application: {
    status: "ok" | "degraded" | "unhealthy";
  };
  analytics: {
    status: "ok" | "degraded" | "unknown";
    freshness: "current" | "stale" | "unknown";
    coverage: "complete" | "partial" | "empty" | "invalid" | "unknown";
  };
  revision: string | null;
}

export type PublicAnalyticsHealth = PublicHealthResponse["analytics"];

type HealthDependencies = Pick<PublicHealthResponse, "web" | "database" | "worker"> & {
  requireWorker?: boolean;
  analytics?: PublicAnalyticsHealth;
};

const revisionPattern = /^[0-9a-f]{40}$/;

function readEmbeddedRevision(): string | null {
  const revisionFile = process.env.APP_REVISION_FILE?.trim() || "/app/.release-revision";
  try {
    const revision = readFileSync(revisionFile, "utf8").trim();
    return revisionPattern.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

/** Build the public health payload without ever serializing runtime secrets. */
export function buildHealthResponse(
  dependencies: HealthDependencies,
): PublicHealthResponse {
  const revision = readEmbeddedRevision();
  const analytics = dependencies.analytics ?? {
    status: "unknown",
    freshness: "unknown",
    coverage: "unknown",
  };
  const application = {
    status: deriveApplicationStatus(dependencies.database, dependencies.worker, dependencies.requireWorker === true),
  };
  // Keep the existing top-level aggregate semantics for consumers that have
  // not adopted the structured application and analytics readiness fields.
  const status = dependencies.database === "unavailable"
    ? "unhealthy"
    : application.status !== "ok" || analytics.status !== "ok"
      ? "degraded"
      : "ok";

  return {
    status,
    web: dependencies.web,
    database: dependencies.database,
    worker: dependencies.worker,
    application,
    analytics,
    revision,
  };
}

function deriveApplicationStatus(
  database: PublicHealthResponse["database"],
  worker: PublicHealthResponse["worker"],
  requireWorker: boolean,
): PublicHealthResponse["application"]["status"] {
  if (database === "unavailable") return "unhealthy";
  if (worker === "unavailable") return requireWorker ? "unhealthy" : "degraded";
  return "ok";
}
