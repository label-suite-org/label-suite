import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { jobStore, publicJob } from "../../../server/jobs";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const jobs = await jobStore.list(orgId, Number.isFinite(requestedLimit) ? requestedLimit : 50);
    return json({ jobs: jobs.map(publicJob) });
  } catch (error) {
    return handleApiError(error);
  }
};
