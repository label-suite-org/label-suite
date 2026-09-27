import { describe, expect, it, vi } from "vitest";
import { runWorkerLoop, runWorkerOnce } from "./worker";
import type { DurableJob, JobStore } from "./types";

const job: DurableJob = {
  id: "job-1",
  orgId: "org-1",
  jobType: "validation_sweep",
  trigger: "scheduled",
  status: "running",
  schemaVersion: 1,
  attempt: 1,
  maxAttempts: 5,
  payload: {},
  result: null,
  error: null,
  errorMetadata: null,
  availableAt: new Date(),
  startedAt: new Date(),
  heartbeatAt: new Date(),
  finishedAt: null,
  leaseOwner: "worker-1",
  leaseExpiresAt: new Date(Date.now() + 60_000),
  idempotencyKey: "scheduled:2026-07-26",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function storeWithClaim(claimed: DurableJob | null): JobStore {
  return {
    enqueue: vi.fn(),
    claim: vi.fn().mockResolvedValue(claimed),
    heartbeat: vi.fn().mockResolvedValue(true),
    succeed: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    workerHeartbeat: vi.fn().mockResolvedValue(undefined),
  };
}

describe("durable job worker", () => {
  it("claims and completes a registered handler exactly once", async () => {
    const store = storeWithClaim(job);
    const handler = vi.fn().mockResolvedValue({ checked: 12 });

    await expect(runWorkerOnce(store, { validation_sweep: handler }, { workerId: "worker-1" })).resolves.toBe(true);

    expect(handler).toHaveBeenCalledOnce();
    expect(store.succeed).toHaveBeenCalledWith(job, "worker-1", { checked: 12 });
    expect(store.fail).not.toHaveBeenCalled();
  });

  it("records handler failure for retry", async () => {
    const store = storeWithClaim(job);
    const failure = new Error("provider unavailable");

    await runWorkerOnce(
      store,
      { validation_sweep: vi.fn().mockRejectedValue(failure) },
      { workerId: "worker-1" },
    );

    expect(store.fail).toHaveBeenCalledWith(job, "worker-1", failure);
    expect(store.succeed).not.toHaveBeenCalled();
  });

  it("marks an unknown job type as non-retryable", async () => {
    const store = storeWithClaim({ ...job, jobType: "unknown" });
    await runWorkerOnce(store, {}, { workerId: "worker-1" });

    const error = vi.mocked(store.fail).mock.calls[0]?.[2] as Error & { retryable?: boolean };
    expect(error.message).toContain("No handler registered");
    expect(error.retryable).toBe(false);
  });

  it("stops an idle loop when shutdown is requested", async () => {
    const store = storeWithClaim(null);
    const controller = new AbortController();
    const loop = runWorkerLoop(store, {}, {
      workerId: "worker-1",
      pollMs: 100,
      signal: controller.signal,
    });
    controller.abort();
    await expect(loop).resolves.toBeUndefined();
  });
});
