import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { jobStore } from "../../../server/jobs";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await jobStore.health(orgId));
  } catch (error) {
    return handleApiError(error);
  }
};
