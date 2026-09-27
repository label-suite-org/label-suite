import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { applyReleaseWorkback, workbackSchema } from "../../server/release-workback";
import { requireCapability } from "../../server/tenant";

export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await applyReleaseWorkback(orgId, await parseJson(request, workbackSchema)));
  } catch (error) { return handleApiError(error); }
};
