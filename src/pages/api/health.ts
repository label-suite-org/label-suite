import type { APIRoute } from "astro";
import { json } from "../../server/api";
import { jobStore } from "../../server/jobs";
import { buildHealthResponse } from "../../server/health";
import { getAnalyticsIngestionServiceHealth, unknownAnalyticsIngestionServiceHealth } from "../../server/analytics-data-quality";

export const prerender = false;

export const GET: APIRoute = async () => {
  const requireWorker = process.env.REQUIRE_WORKER_HEALTH === "true";
  try {
    const analytics = getAnalyticsIngestionServiceHealth().catch(() => unknownAnalyticsIngestionServiceHealth());
    const queue = await jobStore.health();
    const workerHealthy = queue.activeWorkers > 0;
    const health = buildHealthResponse({
      web: "ok",
      database: "ok",
      worker: workerHealthy ? "ok" : "unavailable",
      requireWorker,
      analytics: await analytics,
    });
    return json(health, health.application.status === "unhealthy" ? 503 : 200);
  } catch {
    return json(buildHealthResponse({
      web: "ok",
      database: "unavailable",
      worker: "unknown",
      requireWorker,
      analytics: unknownAnalyticsIngestionServiceHealth(),
    }), 503);
  }
};
