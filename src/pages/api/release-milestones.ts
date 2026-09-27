import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { createReleaseMilestone, createReleaseMilestoneSchema, getReleaseTimeline, updateReleaseMilestone, updateReleaseMilestoneSchema } from "../../server/release-timeline";
import { requireCapability, requireOrgId } from "../../server/tenant";

export const prerender = false;
export const GET: APIRoute = async ({ url, locals }) => {
  try {
    const releaseId = url.searchParams.get("release_id");
    if (!releaseId) return json({ error: "release_id is required" }, 400);
    return json(await getReleaseTimeline(requireOrgId(locals), releaseId));
  } catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ request, locals }) => {
  try { return json(await createReleaseMilestone(requireCapability(locals, "operations.mutate"), await parseJson(request, createReleaseMilestoneSchema)), 201); } catch (error) { return handleApiError(error); }
};
export const PUT: APIRoute = async ({ request, locals }) => {
  try { return json(await updateReleaseMilestone(requireCapability(locals, "operations.mutate"), await parseJson(request, updateReleaseMilestoneSchema))); } catch (error) { return handleApiError(error); }
};
