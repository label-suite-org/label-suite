import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import {
  createBudgetLine,
  createBudgetLineSchema,
  updateBudgetLine,
  updateBudgetLineSchema,
} from "../../../server/budget-mutations";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const body = await parseJson(request, createBudgetLineSchema);
    return json(await createBudgetLine(orgId, body), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const body = await parseJson(request, updateBudgetLineSchema);
    return json(await updateBudgetLine(orgId, body));
  } catch (err) {
    return handleApiError(err);
  }
};
