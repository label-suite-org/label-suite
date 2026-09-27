import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { requireCapability } from "../../../../server/tenant";
import { updateFundingSourceStatus, updateFundingSourceStatusSchema } from "../../../../server/budget-mutations";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const id = params.id;
    if (!id) return json({ error: "id required" }, 400);
    const body = await parseJson(request, updateFundingSourceStatusSchema);
    return json(await updateFundingSourceStatus(orgId, { ...body, id }));
  } catch (err) {
    return handleApiError(err);
  }
};
