import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { ensureReleaseSamplyReview } from "../../../../server/samply-release";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const releaseId = params.id;
    if (!releaseId) {
      return json({ error: "Release id is required" }, 400);
    }

    const result = await ensureReleaseSamplyReview(orgId, releaseId);
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};
