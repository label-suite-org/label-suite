import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresJobStore } from "./postgres-store";

const ORG_ID = "true-nature";
const TEST_PREFIX = "test-job-store-";
const dbUrl = process.env.DATABASE_URL ?? "";
const isProductionLike = /neon\.tech|truenature|winona|label-suite/i.test(dbUrl);
const describeDb = dbUrl && (!isProductionLike || process.env.JOB_STORE_TEST_DB === "1") ? describe : describe.skip;

let pool: Pool;
let store: PostgresJobStore;

function testJobId(name: string) {
  return `${TEST_PREFIX}${name}-${crypto.randomUUID()}`;
}

async function cleanup() {
  if (!pool) return;
  await pool.query("DELETE FROM label_suite.job_runs WHERE id LIKE $1", [`${TEST_PREFIX}%`]);
}

async function insertExpiredFinalAttempt(jobId: string) {
  await pool.query(
    `INSERT INTO label_suite.job_runs (
      id, org_id, job_type, trigger, status, schema_version, attempt, max_attempts,
      payload, available_at, started_at, heartbeat_at, lease_owner, lease_expires_at,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'running', 1, 5, 5, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)`,
    [
      jobId,
      ORG_ID,
      "validation_sweep",
      "scheduled",
      JSON.stringify({ reason: "test" }),
      new Date("1900-01-01T00:00:00.000Z"),
      new Date("2026-07-28T11:50:00.000Z"),
      new Date("2026-07-28T11:59:00.000Z"),
      "worker-1",
      new Date("2026-07-28T11:59:30.000Z"),
      new Date("2026-07-28T11:40:00.000Z"),
      new Date("2026-07-28T11:59:00.000Z"),
    ],
  );

  await pool.query(
    `INSERT INTO label_suite.job_attempts (
      id, job_id, org_id, attempt, worker_id, status, started_at, heartbeat_at
    ) VALUES ($1, $2, $3, 5, $4, 'running', $5, $6)`,
    [
      `${jobId}-attempt-5`,
      jobId,
      ORG_ID,
      "worker-1",
      new Date("2026-07-28T11:50:00.000Z"),
      new Date("2026-07-28T11:59:00.000Z"),
    ],
  );
}

async function insertQueuedJob(jobId: string, idempotencyKey: string) {
  await pool.query(
    `INSERT INTO label_suite.job_runs (
      id, org_id, job_type, trigger, status, schema_version, attempt, max_attempts,
      payload, available_at, idempotency_key, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'queued', 1, 0, 5, $5::jsonb, $6, $7, $8, $9)`,
    [
      jobId,
      ORG_ID,
      "validation_sweep",
      "scheduled",
      JSON.stringify({ reason: "queued" }),
      new Date("1900-01-01T00:00:00.000Z"),
      idempotencyKey,
      new Date("2026-07-28T11:45:00.000Z"),
      new Date("2026-07-28T11:45:00.000Z"),
    ],
  );
}

describeDb("PostgresJobStore claim", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    store = new PostgresJobStore(pool);
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    if (pool) await pool.end();
  });

  it("fails a final-attempt expired lease instead of reclaiming it", async () => {
    const jobId = testJobId("final-expired");
    await insertExpiredFinalAttempt(jobId);

    await expect(store.claim("worker-2", 60_000)).resolves.toBeNull();

    const jobResult = await pool.query(
      `SELECT status, error, error_metadata, lease_owner, lease_expires_at, finished_at, completed_at
       FROM label_suite.job_runs
       WHERE id = $1`,
      [jobId],
    );
    expect(jobResult.rows[0]).toMatchObject({
      status: "failed",
      error: "Lease expired before completion",
      error_metadata: {
        name: "LeaseExpired",
        code: "LEASE_EXPIRED",
        retryable: false,
      },
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(jobResult.rows[0]?.finished_at).toBeTruthy();
    expect(jobResult.rows[0]?.completed_at).toBeTruthy();

    const attemptResult = await pool.query(
      `SELECT status, error_metadata, finished_at
       FROM label_suite.job_attempts
       WHERE job_id = $1 AND attempt = 5`,
      [jobId],
    );
    expect(attemptResult.rows[0]).toMatchObject({
      status: "failed",
      error_metadata: {
        name: "LeaseExpired",
        code: "LEASE_EXPIRED",
        retryable: false,
      },
    });
    expect(attemptResult.rows[0]?.finished_at).toBeTruthy();
  });

  it("claims the next queued job after terminally expiring the stale final attempt", async () => {
    const expiredJobId = testJobId("final-before-claim");
    const queuedJobId = testJobId("queued-next");
    await insertExpiredFinalAttempt(expiredJobId);
    await insertQueuedJob(queuedJobId, `scheduled:${queuedJobId}`);

    const claimed = await store.claim("worker-2", 60_000);

    expect(claimed).toMatchObject({
      id: queuedJobId,
      orgId: ORG_ID,
      status: "running",
      attempt: 1,
      maxAttempts: 5,
      trigger: "scheduled",
      leaseOwner: "worker-2",
      idempotencyKey: `scheduled:${queuedJobId}`,
    });

    const expiredJobResult = await pool.query(
      `SELECT status, error_metadata, lease_owner, lease_expires_at
       FROM label_suite.job_runs
       WHERE id = $1`,
      [expiredJobId],
    );
    expect(expiredJobResult.rows[0]).toMatchObject({
      status: "failed",
      error_metadata: {
        name: "LeaseExpired",
        code: "LEASE_EXPIRED",
        retryable: false,
      },
      lease_owner: null,
      lease_expires_at: null,
    });

    const queuedJobResult = await pool.query(
      `SELECT status, attempt, lease_owner, idempotency_key
       FROM label_suite.job_runs
       WHERE id = $1`,
      [queuedJobId],
    );
    expect(queuedJobResult.rows[0]).toMatchObject({
      status: "running",
      attempt: 1,
      lease_owner: "worker-2",
      idempotency_key: `scheduled:${queuedJobId}`,
    });

    const attemptsResult = await pool.query(
      `SELECT job_id, attempt, worker_id, status, error_metadata
       FROM label_suite.job_attempts
       WHERE job_id IN ($1, $2)
       ORDER BY job_id, attempt`,
      [expiredJobId, queuedJobId],
    );
    expect(attemptsResult.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job_id: expiredJobId,
          attempt: 5,
          worker_id: "worker-1",
          status: "failed",
          error_metadata: {
            name: "LeaseExpired",
            code: "LEASE_EXPIRED",
            retryable: false,
          },
        }),
        expect.objectContaining({
          job_id: queuedJobId,
          attempt: 1,
          worker_id: "worker-2",
          status: "running",
        }),
      ]),
    );
  });
});
