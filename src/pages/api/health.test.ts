import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  jobHealth: vi.fn(),
  analyticsHealth: vi.fn(),
}));

vi.mock("../../server/jobs", () => ({
  jobStore: { health: dependencies.jobHealth },
}));

vi.mock("../../server/analytics-data-quality", () => ({
  getAnalyticsIngestionServiceHealth: dependencies.analyticsHealth,
  unknownAnalyticsIngestionServiceHealth: () => ({ status: "unknown", freshness: "unknown", coverage: "unknown" }),
}));

describe("public health route", () => {
  const originalRequireWorker = process.env.REQUIRE_WORKER_HEALTH;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.jobHealth.mockResolvedValue({ activeWorkers: 1 });
    dependencies.analyticsHealth.mockResolvedValue({ status: "ok", freshness: "current", coverage: "complete" });
    delete process.env.REQUIRE_WORKER_HEALTH;
  });

  afterEach(() => {
    if (originalRequireWorker === undefined) delete process.env.REQUIRE_WORKER_HEALTH;
    else process.env.REQUIRE_WORKER_HEALTH = originalRequireWorker;
  });

  it("keeps the legacy aggregate while exposing structured healthy readiness", async () => {
    const { GET } = await import("./health");
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      web: "ok",
      database: "ok",
      worker: "ok",
      application: { status: "ok" },
      analytics: { status: "ok", freshness: "current", coverage: "complete" },
    });
  });

  it("keeps analytics degradation informational for transport readiness", async () => {
    dependencies.analyticsHealth.mockResolvedValueOnce({ status: "degraded", freshness: "stale", coverage: "partial" });
    const { GET } = await import("./health");
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      application: { status: "ok" },
      analytics: { status: "degraded", freshness: "stale", coverage: "partial" },
    });
  });

  it("keeps unknown analytics readiness informational for transport readiness", async () => {
    dependencies.analyticsHealth.mockResolvedValueOnce({ status: "unknown", freshness: "unknown", coverage: "unknown" });
    const { GET } = await import("./health");
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      application: { status: "ok" },
      analytics: { status: "unknown", freshness: "unknown", coverage: "unknown" },
    });
  });

  it("isolates an unexpected analytics probe rejection from application readiness", async () => {
    dependencies.analyticsHealth.mockRejectedValueOnce(new Error("analytics probe unavailable"));
    const { GET } = await import("./health");
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: "ok",
      worker: "ok",
      application: { status: "ok" },
      analytics: { status: "unknown", freshness: "unknown", coverage: "unknown" },
    });
  });

  it("returns 200 for an optional unavailable worker and 503 when that worker is required", async () => {
    dependencies.jobHealth.mockResolvedValueOnce({ activeWorkers: 0 });
    const { GET } = await import("./health");
    const optional = await GET({} as never);
    expect(optional.status).toBe(200);
    await expect(optional.json()).resolves.toMatchObject({ status: "degraded", application: { status: "degraded" }, worker: "unavailable" });

    process.env.REQUIRE_WORKER_HEALTH = "true";
    dependencies.jobHealth.mockResolvedValueOnce({ activeWorkers: 0 });
    const required = await GET({} as never);
    expect(required.status).toBe(503);
    await expect(required.json()).resolves.toMatchObject({ status: "degraded", application: { status: "unhealthy" }, worker: "unavailable" });
  });

  it("fails closed for database failure and masks analytics as unknown", async () => {
    dependencies.jobHealth.mockRejectedValueOnce(new Error("database unavailable"));
    const { GET } = await import("./health");
    const response = await GET({} as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unhealthy",
      database: "unavailable",
      worker: "unknown",
      application: { status: "unhealthy" },
      analytics: { status: "unknown", freshness: "unknown", coverage: "unknown" },
    });
  });
});
