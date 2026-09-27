import type { DurableJob } from "./types";

const SECRET_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key)/gi;
const SECRET_VALUE_PATTERN = /\b(authorization|cookie|password|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi;
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;

export function retryDelayMs(attempt: number, baseMs = 1_000, maximumMs = 15 * 60_000): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}

export function sanitizeJobError(error: unknown): {
  message: string;
  metadata: Record<string, unknown>;
} {
  const source = error instanceof Error ? error : new Error(String(error));
  const message = source.message
    .replace(URL_CREDENTIALS_PATTERN, "$1[redacted]@")
    .replace(SECRET_VALUE_PATTERN, "[redacted]")
    .replace(SECRET_PATTERN, "[redacted]")
    .slice(0, 1_000);

  const candidate = error as { code?: unknown; retryable?: unknown };
  return {
    message: message || "Job failed",
    metadata: {
      name: source.name.slice(0, 100),
      ...(typeof candidate?.code === "string" ? { code: candidate.code.slice(0, 100) } : {}),
      retryable: candidate?.retryable !== false,
    },
  };
}

export function publicJob(job: DurableJob) {
  return {
    id: job.id,
    org_id: job.orgId,
    job_type: job.jobType,
    trigger: job.trigger,
    status: job.status,
    schema_version: job.schemaVersion,
    attempt: job.attempt,
    max_attempts: job.maxAttempts,
    error: job.error,
    error_metadata: job.errorMetadata,
    available_at: job.availableAt,
    started_at: job.startedAt,
    heartbeat_at: job.heartbeatAt,
    finished_at: job.finishedAt,
    lease_owner: job.leaseOwner,
    lease_expires_at: job.leaseExpiresAt,
    idempotency_key: job.idempotencyKey,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}
