import type { APIRoute } from "astro";
import { handleApiError, json } from "../../server/api";
import { jobStore, publicJob } from "../../server/jobs";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const job = await jobStore.enqueue({
      orgId,
      jobType: "validation_sweep",
      trigger: "api",
      idempotencyKey: `api:${crypto.randomUUID()}`,
    });
    return json({ job: publicJob(job) }, 202);
  } catch (err) {
    return handleApiError(err);
  }
};
