import type { DurableJob, JobHandlerRegistry, JobStore } from "./types";
import { elapsed, errorClass, logEvent } from "../observability";

export interface WorkerOptions {
  workerId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  onError?: (error: unknown, job?: DurableJob) => void;
}

export async function runWorkerOnce(
  store: JobStore,
  handlers: JobHandlerRegistry,
  options: WorkerOptions,
): Promise<boolean> {
  const leaseMs = options.leaseMs ?? 60_000;
  const job = await store.claim(options.workerId, leaseMs);
  if (!job) return false;
  const startedAt = performance.now();
  logEvent({
    severity: "info",
    event: "job.started",
    jobId: job.id,
    jobType: job.jobType,
    orgId: job.orgId,
    outcome: "running",
    attempt: job.attempt,
  });

  const controller = new AbortController();
  const stopFromParent = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", stopFromParent, { once: true });
  const heartbeat = setInterval(async () => {
    try {
      const retained = await store.heartbeat(job, options.workerId, leaseMs);
      if (!retained) controller.abort(new Error("Job lease lost"));
    } catch (error) {
      options.onError?.(error, job);
      controller.abort(error);
    }
  }, Math.min(options.heartbeatMs ?? Math.floor(leaseMs / 3), Math.max(1_000, leaseMs - 1)));
  heartbeat.unref();

  try {
    const handler = handlers[job.jobType];
    if (!handler) {
      const error = new Error(`No handler registered for job type: ${job.jobType}`) as Error & { retryable: boolean };
      error.retryable = false;
      throw error;
    }
    const result = await handler(job, { signal: controller.signal });
    const recorded = await store.succeed(job, options.workerId, result);
    if (!recorded) throw new Error(`Could not complete ${job.id}: lease no longer owned`);
    logEvent({
      severity: "info",
      event: "job.completed",
      jobId: job.id,
      jobType: job.jobType,
      orgId: job.orgId,
      durationMs: elapsed(startedAt),
      outcome: "succeeded",
      attempt: job.attempt,
    });
  } catch (error) {
    try {
      await store.fail(job, options.workerId, error);
    } catch (trackingError) {
      options.onError?.(trackingError, job);
    }
    logEvent({
      severity: "error",
      event: "job.completed",
      jobId: job.id,
      jobType: job.jobType,
      orgId: job.orgId,
      durationMs: elapsed(startedAt),
      outcome: "failed",
      attempt: job.attempt,
      errorClass: errorClass(error),
    });
    options.onError?.(error, job);
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", stopFromParent);
  }
  return true;
}

export async function runWorkerLoop(
  store: JobStore,
  handlers: JobHandlerRegistry,
  options: WorkerOptions,
): Promise<void> {
  const pollMs = Math.max(100, options.pollMs ?? 1_000);
  const heartbeatMs = Math.max(1_000, Math.min(options.heartbeatMs ?? 15_000, 60_000));
  await store.workerHeartbeat(options.workerId, "running");
  const heartbeat = setInterval(() => {
    void store.workerHeartbeat(options.workerId, "running").catch((error) => options.onError?.(error));
  }, heartbeatMs);
  heartbeat.unref();
  try {
    while (!options.signal?.aborted) {
      const worked = await runWorkerOnce(store, handlers, options);
      if (!worked) await waitFor(pollMs, options.signal);
    }
  } finally {
    clearInterval(heartbeat);
    try {
      await store.workerHeartbeat(options.workerId, "stopped");
    } catch (error) {
      options.onError?.(error);
    }
  }
}

function waitFor(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
