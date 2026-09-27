import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { requireCapability } from "../../../../server/tenant";
import { createVarianceRequest, createVarianceRequestSchema } from "../../../../server/budget-mutations";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const lineId = params.id;
    if (!lineId) return json({ error: "id required" }, 400);
    const body = await parseJson(request, createVarianceRequestSchema);
    return json(await createVarianceRequest(orgId, { ...body, line_id: lineId }), 201);
  } catch (err) {
    return handleApiError(err);
  }
};
