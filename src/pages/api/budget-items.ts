import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createBudgetItem,
  createBudgetItemSchema,
  updateBudgetItem,
  updateBudgetItemSchema,
} from "../../server/budget-items";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const input = await parseJson(request, createBudgetItemSchema);
    return json(await createBudgetItem(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const input = await parseJson(request, updateBudgetItemSchema);
    return json(await updateBudgetItem(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
