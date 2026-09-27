import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { replaceGrantApplicationRequirements, replaceGrantApplicationRequirementsSchema } from "../../../../server/grants-workspace";
import { requireSameOrigin } from "../../../../server/request-security";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const PUT: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "fundraising.mutate");
    const input = await parseJson(request, replaceGrantApplicationRequirementsSchema.omit({ application_id: true }));
    return json(await replaceGrantApplicationRequirements(orgId, { ...input, application_id: params.id ?? "" }));
  } catch (error) {
    return handleApiError(error);
  }
};
