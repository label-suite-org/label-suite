import { and, eq } from "drizzle-orm";
import { job_runs } from "../db/schema";
import { db } from "../lib/db";
import { sanitizeJobError } from "./jobs/core";

type JobRunClient = Pick<typeof db, "insert" | "update">;

export type JobRunTrigger = "api" | "manual" | "post_write" | "scheduled";

export interface TrackedJobOptions {
  orgId: string;
  jobType: string;
  trigger: JobRunTrigger;
  payload?: Record<string, unknown>;
}

export async function runTrackedJob<T extends Record<string, unknown>>(
  options: TrackedJobOptions,
  job: () => Promise<T>,
  client: JobRunClient = db,
): Promise<T> {
  const runId = `job_${crypto.randomUUID()}`;

  await client.insert(job_runs).values({
    id: runId,
    org_id: options.orgId,
    job_type: options.jobType,
    trigger: options.trigger,
    status: "running",
    attempt: 1,
    max_attempts: 1,
    payload: options.payload,
    available_at: new Date(),
    started_at: new Date(),
  });

  try {
    const result = await job();
    const completedAt = new Date();

    await client
      .update(job_runs)
      .set({
        status: "succeeded",
        result,
        error: null,
        error_metadata: null,
        finished_at: completedAt,
        completed_at: completedAt,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: completedAt,
      })
      .where(and(eq(job_runs.id, runId), eq(job_runs.org_id, options.orgId)));

    return result;
  } catch (error) {
    const completedAt = new Date();
    const sanitized = sanitizeJobError(error);

    try {
      await client
        .update(job_runs)
        .set({
          status: "failed",
          error: sanitized.message,
          error_metadata: sanitized.metadata,
          finished_at: completedAt,
          completed_at: completedAt,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: completedAt,
        })
        .where(and(eq(job_runs.id, runId), eq(job_runs.org_id, options.orgId)));
    } catch (trackingError) {
      console.error(`Failed to record failure for job run ${runId}`, trackingError);
    }

    throw error;
  }
}
