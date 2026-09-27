import { beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  list: vi.fn(),
  health: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("./jobs", () => ({
  jobStore: jobs,
  publicJob: (job: unknown) => job,
}));

describe("job inspection route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.list.mockResolvedValue([]);
    jobs.health.mockResolvedValue({
      queued: 0,
      running: 0,
      failed: 0,
      expiredLeases: 0,
      activeWorkers: 1,
      oldestQueuedAt: null,
    });
    jobs.enqueue.mockResolvedValue({ id: "job-1", orgId: "org-1", status: "queued" });
  });

  it("allows operators to inspect only their workspace jobs", { timeout: 15_000 }, async () => {
    const { GET } = await import("../pages/api/jobs/index");
    const request = new Request("https://labels.example/api/jobs?limit=10");
    const response = await GET({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(200);
    expect(jobs.list).toHaveBeenCalledWith("org-1", 10);
  });

  it("denies read-only members access to job diagnostics", async () => {
    const { GET } = await import("../pages/api/jobs/health");
    const request = new Request("https://labels.example/api/jobs/health");
    const response = await GET({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(response.status).toBe(403);
    expect(jobs.health).not.toHaveBeenCalled();
  });

  it("queues API sweeps instead of executing them in the request", async () => {
    const { POST } = await import("../pages/api/sweep");
    const request = new Request("https://labels.example/api/sweep", {
      method: "POST",
      headers: { origin: "https://labels.example" },
    });
    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(202);
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      jobType: "validation_sweep",
      trigger: "api",
    }));
  });

  it("makes worker health a strict deployment gate when configured", async () => {
    const previous = process.env.REQUIRE_WORKER_HEALTH;
    process.env.REQUIRE_WORKER_HEALTH = "true";
    jobs.health.mockResolvedValueOnce({
      queued: 0,
      running: 0,
      failed: 0,
      expiredLeases: 0,
      activeWorkers: 0,
      oldestQueuedAt: null,
    });
    try {
      const { GET } = await import("../pages/api/health");
      const response = await GET({} as never);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "degraded",
        web: "ok",
        database: "ok",
        worker: "unavailable",
      });
    } finally {
      if (previous === undefined) delete process.env.REQUIRE_WORKER_HEALTH;
      else process.env.REQUIRE_WORKER_HEALTH = previous;
    }
  });

  it("does not block deployments when worker health is not required", async () => {
    const previous = process.env.REQUIRE_WORKER_HEALTH;
    process.env.REQUIRE_WORKER_HEALTH = "false";
    jobs.health.mockResolvedValueOnce({
      queued: 0,
      running: 0,
      failed: 0,
      expiredLeases: 0,
      activeWorkers: 0,
      oldestQueuedAt: null,
    });
    try {
      const { GET } = await import("../pages/api/health");
      const response = await GET({} as never);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "degraded",
        web: "ok",
        database: "ok",
        worker: "unavailable",
      });
    } finally {
      if (previous === undefined) delete process.env.REQUIRE_WORKER_HEALTH;
      else process.env.REQUIRE_WORKER_HEALTH = previous;
    }
  });
});
