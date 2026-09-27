import type { Pool, PoolClient, QueryResultRow } from "pg";
import { retryDelayMs, sanitizeJobError } from "./core";
import type { DurableJob, EnqueueJobOptions, JobStore, JobTrigger, QueueHealth } from "./types";

type Queryable = Pick<Pool, "query">;
type Connectable = Pick<Pool, "connect">;

export class PostgresJobStore implements JobStore {
  constructor(private readonly pool: Queryable & Connectable) {}

  async enqueue(options: EnqueueJobOptions): Promise<DurableJob> {
    const serializedPayload = JSON.stringify(options.payload ?? {});
    if (Buffer.byteLength(serializedPayload, "utf8") > 64 * 1_024) {
      throw new Error("Job payload exceeds the 64 KiB limit");
    }
    const id = `job_${crypto.randomUUID()}`;
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 5, 100));
    const schemaVersion = Math.max(1, options.schemaVersion ?? 1);
    const result = await this.pool.query(
      `INSERT INTO label_suite.job_runs (
        id, org_id, job_type, trigger, status, schema_version, attempt, max_attempts,
        payload, available_at, idempotency_key
      ) VALUES ($1, $2, $3, $4, 'queued', $5, 0, $6, $7::jsonb, $8, $9)
      ON CONFLICT (org_id, job_type, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      DO UPDATE SET updated_at = label_suite.job_runs.updated_at
      RETURNING *`,
      [
        id,
        options.orgId,
        options.jobType,
        options.trigger,
        schemaVersion,
        maxAttempts,
        serializedPayload,
        options.availableAt ?? new Date(),
        options.idempotencyKey ?? null,
      ],
    );
    return mapJob(result.rows[0]);
  }

  async claim(workerId: string, leaseMs: number): Promise<DurableJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await markExpiredAttempts(client);
      const result = await client.query(
        `WITH candidate AS (
          SELECT id
          FROM label_suite.job_runs
          WHERE attempt < max_attempts
            AND (
              (status = 'queued' AND available_at <= now())
              OR (status = 'running' AND lease_expires_at <= now())
            )
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE label_suite.job_runs AS job
        SET status = 'running',
            attempt = job.attempt + 1,
            started_at = COALESCE(job.started_at, now()),
            heartbeat_at = now(),
            lease_owner = $1,
            lease_expires_at = now() + ($2 * interval '1 millisecond'),
            error = NULL,
            error_metadata = NULL,
            updated_at = now()
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*`,
        [workerId, normalizeLeaseMs(leaseMs)],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `INSERT INTO label_suite.job_attempts
          (id, job_id, org_id, attempt, worker_id, status, heartbeat_at)
         VALUES ($1, $2, $3, $4, $5, 'running', now())`,
        [`attempt_${crypto.randomUUID()}`, row.id, row.org_id, row.attempt, workerId],
      );
      await client.query("COMMIT");
      return mapJob(row);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(job: DurableJob, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `WITH refreshed AS (
        UPDATE label_suite.job_runs
        SET heartbeat_at = now(),
            lease_expires_at = now() + ($4 * interval '1 millisecond'),
            updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'running' AND lease_owner = $3
        RETURNING id
      )
      UPDATE label_suite.job_attempts
      SET heartbeat_at = now()
      WHERE job_id IN (SELECT id FROM refreshed) AND attempt = $5
      RETURNING job_id`,
      [job.id, job.orgId, workerId, normalizeLeaseMs(leaseMs), job.attempt],
    );
    return result.rowCount === 1;
  }

  async succeed(job: DurableJob, workerId: string, resultValue: Record<string, unknown>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE label_suite.job_runs
         SET status = 'succeeded', result = $4::jsonb, error = NULL,
             error_metadata = NULL, finished_at = now(), completed_at = now(),
             lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND org_id = $2 AND status = 'running' AND lease_owner = $3
         RETURNING id`,
        [job.id, job.orgId, workerId, JSON.stringify(resultValue)],
      );
      if (result.rowCount === 1) {
        await finishAttempt(client, job, "succeeded", null);
      }
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(job: DurableJob, workerId: string, error: unknown): Promise<boolean> {
    const client = await this.pool.connect();
    const sanitized = sanitizeJobError(error);
    const retryable = sanitized.metadata.retryable !== false;
    const willRetry = retryable && job.attempt < job.maxAttempts;
    const nextAvailableAt = new Date(Date.now() + retryDelayMs(job.attempt));
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE label_suite.job_runs
         SET status = $4,
             available_at = CASE WHEN $4 = 'queued' THEN $5 ELSE available_at END,
             error = $6,
             error_metadata = $7::jsonb,
             finished_at = CASE WHEN $4 = 'failed' THEN now() ELSE NULL END,
             completed_at = CASE WHEN $4 = 'failed' THEN now() ELSE NULL END,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND org_id = $2 AND status = 'running' AND lease_owner = $3
         RETURNING id`,
        [
          job.id,
          job.orgId,
          workerId,
          willRetry ? "queued" : "failed",
          nextAvailableAt,
          sanitized.message,
          JSON.stringify(sanitized.metadata),
        ],
      );
      if (result.rowCount === 1) {
        await finishAttempt(client, job, "failed", sanitized.metadata);
      }
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (trackingError) {
      await rollback(client);
      throw trackingError;
    } finally {
      client.release();
    }
  }

  async health(orgId?: string): Promise<QueueHealth> {
    const [queueResult, workerResult] = await Promise.all([
      this.pool.query(
        `SELECT
        count(*) FILTER (WHERE status = 'queued')::int AS queued,
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        min(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at,
        count(*) FILTER (
          WHERE status = 'running' AND lease_expires_at <= now()
       )::int AS expired_leases
       FROM label_suite.job_runs
       WHERE ($1::text IS NULL OR org_id = $1)`,
        [orgId ?? null],
      ),
      this.pool.query(
        `SELECT count(*)::int AS active_workers
         FROM label_suite.job_workers
         WHERE status = 'running' AND last_seen_at >= now() - interval '45 seconds'`,
      ),
    ]);
    const row = queueResult.rows[0];
    return {
      queued: Number(row.queued),
      running: Number(row.running),
      failed: Number(row.failed),
      oldestQueuedAt: row.oldest_queued_at ? new Date(row.oldest_queued_at) : null,
      expiredLeases: Number(row.expired_leases),
      activeWorkers: Number(workerResult.rows[0]?.active_workers ?? 0),
    };
  }

  async workerHeartbeat(workerId: string, status: "running" | "stopped"): Promise<void> {
    await this.pool.query(
      `INSERT INTO label_suite.job_workers
        (id, status, started_at, last_seen_at, stopped_at, updated_at)
       VALUES ($1, $2, now(), now(), CASE WHEN $2 = 'stopped' THEN now() ELSE NULL END, now())
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           last_seen_at = now(),
           stopped_at = CASE WHEN EXCLUDED.status = 'stopped' THEN now() ELSE NULL END,
           updated_at = now()`,
      [workerId, status],
    );
  }

  async list(orgId: string, limit = 50): Promise<DurableJob[]> {
    const result = await this.pool.query(
      `SELECT *
       FROM label_suite.job_runs
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [orgId, Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map(mapJob);
  }
}

async function markExpiredAttempts(client: PoolClient) {
  await client.query(
    `WITH expired AS (
      SELECT attempt.id AS attempt_id, job.id AS job_id
      FROM label_suite.job_attempts AS attempt
      JOIN label_suite.job_runs AS job
        ON attempt.job_id = job.id
      WHERE attempt.attempt = job.attempt
        AND attempt.status = 'running'
        AND job.status = 'running'
        AND job.lease_expires_at <= now()
        AND job.attempt >= job.max_attempts
    ), updated_jobs AS (
      UPDATE label_suite.job_runs AS job
      SET status = 'failed',
        error = 'Lease expired before completion',
        error_metadata = jsonb_build_object('name', 'LeaseExpired', 'code', 'LEASE_EXPIRED', 'retryable', false),
        finished_at = COALESCE(job.finished_at, now()),
        completed_at = COALESCE(job.completed_at, now()),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = now()
      WHERE job.id IN (SELECT job_id FROM expired)
      RETURNING job.id
    )
    UPDATE label_suite.job_attempts
    SET status = 'failed',
        finished_at = now(),
        error_metadata = jsonb_build_object('name', 'LeaseExpired', 'code', 'LEASE_EXPIRED', 'retryable', false)
    WHERE id IN (SELECT attempt_id FROM expired)
      AND EXISTS (SELECT 1 FROM updated_jobs);`,
  );

  await client.query(
    `UPDATE label_suite.job_attempts AS attempt
     SET status = 'lease_expired',
         finished_at = now(),
         error_metadata = jsonb_build_object('name', 'LeaseExpired', 'code', 'LEASE_EXPIRED', 'retryable', false)
     FROM label_suite.job_runs AS job
     WHERE attempt.job_id = job.id
       AND attempt.attempt = job.attempt
       AND attempt.status = 'running'
       AND job.attempt < job.max_attempts
       AND job.status = 'running'
       AND job.lease_expires_at <= now()`,
  );
}

async function finishAttempt(
  client: PoolClient,
  job: DurableJob,
  status: "succeeded" | "failed",
  errorMetadata: Record<string, unknown> | null,
) {
  await client.query(
    `UPDATE label_suite.job_attempts
     SET status = $3, finished_at = now(), error_metadata = $4::jsonb
     WHERE job_id = $1 AND attempt = $2`,
    [job.id, job.attempt, status, errorMetadata ? JSON.stringify(errorMetadata) : null],
  );
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

function normalizeLeaseMs(value: number) {
  return Math.max(1_000, Math.min(value, 60 * 60_000));
}

function mapJob(row: QueryResultRow): DurableJob {
  if (!row) throw new Error("Job query returned no row");
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    jobType: String(row.job_type),
    trigger: row.trigger as JobTrigger,
    status: row.status,
    schemaVersion: Number(row.schema_version),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    payload: isRecord(row.payload) ? row.payload : {},
    result: isRecord(row.result) ? row.result : null,
    error: typeof row.error === "string" ? row.error : null,
    errorMetadata: isRecord(row.error_metadata) ? row.error_metadata : null,
    availableAt: new Date(row.available_at),
    startedAt: row.started_at ? new Date(row.started_at) : null,
    heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
    leaseOwner: typeof row.lease_owner === "string" ? row.lease_owner : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
