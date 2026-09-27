import { sql } from "drizzle-orm";
import { db } from "../lib/db";

/**
 * Run catalog validation after readiness-affecting mutations.
 *
 * This is intentionally best-effort: the user mutation has already succeeded.
 * The minute-bucketed key coalesces a burst of related writes without preventing
 * later sweeps.
 */
export async function triggerCatalogSweep(orgId: string, reason: string): Promise<void> {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const idempotencyKey = `post-write:${minuteBucket}`;
  try {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        INSERT INTO label_suite.job_runs (
          id, org_id, job_type, trigger, status, schema_version, attempt,
          max_attempts, payload, available_at, idempotency_key
        ) VALUES (
          ${`job_${crypto.randomUUID()}`}, ${orgId}, 'validation_sweep',
          'post_write', 'queued', 1, 0, 5, ${JSON.stringify({ reason })}::jsonb,
          now(), ${idempotencyKey}
        )
        ON CONFLICT (org_id, job_type, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO UPDATE SET updated_at = label_suite.job_runs.updated_at
      `);
    });
  } catch (error) {
    console.error(`Could not enqueue catalog sweep for ${orgId} after ${reason}`, error);
  }
}
