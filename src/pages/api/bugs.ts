import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { updateBug, updateBugSchema } from "../../server/bugs";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateBugSchema);
    return json(await updateBug(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
