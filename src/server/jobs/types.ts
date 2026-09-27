export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobTrigger = "api" | "manual" | "post_write" | "scheduled";

export interface DurableJob {
  id: string;
  orgId: string;
  jobType: string;
  trigger: JobTrigger;
  status: JobStatus;
  schemaVersion: number;
  attempt: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  errorMetadata: Record<string, unknown> | null;
  availableAt: Date;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueJobOptions {
  orgId: string;
  jobType: string;
  trigger: JobTrigger;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
  maxAttempts?: number;
  availableAt?: Date;
  idempotencyKey?: string;
}

export interface QueueHealth {
  queued: number;
  running: number;
  failed: number;
  oldestQueuedAt: Date | null;
  expiredLeases: number;
  activeWorkers: number;
}

export interface JobStore {
  enqueue(options: EnqueueJobOptions): Promise<DurableJob>;
  claim(workerId: string, leaseMs: number): Promise<DurableJob | null>;
  heartbeat(job: DurableJob, workerId: string, leaseMs: number): Promise<boolean>;
  succeed(job: DurableJob, workerId: string, result: Record<string, unknown>): Promise<boolean>;
  fail(job: DurableJob, workerId: string, error: unknown): Promise<boolean>;
  workerHeartbeat(workerId: string, status: "running" | "stopped"): Promise<void>;
}

export type JobHandler = (
  job: DurableJob,
  context: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

export type JobHandlerRegistry = Readonly<Record<string, JobHandler>>;
