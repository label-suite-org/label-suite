import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { requireOrgId } from "../../../../server/tenant";
import { getFundingSourceHistory } from "../../../../server/budget-mutations";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const id = params.id;
    if (!id) return json({ error: "id required" }, 400);
    return json(await getFundingSourceHistory(orgId, id));
  } catch (err) {
    return handleApiError(err);
  }
};
