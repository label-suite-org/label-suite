import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { deleteBudgetLine } from "../../../server/budget-mutations";

export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const id = params.id;
    if (!id) return json({ error: "id required" }, 400);
    return json(await deleteBudgetLine(orgId, id));
  } catch (err) {
    return handleApiError(err);
  }
};
