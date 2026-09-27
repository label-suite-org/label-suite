import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import {
  createFundingSource,
  createFundingSourceSchema,
  updateFundingSource,
  updateFundingSourceSchema,
} from "../../../server/budget-mutations";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const body = await parseJson(request, createFundingSourceSchema);
    return json(await createFundingSource(orgId, body), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "budgets.mutate");
    const body = await parseJson(request, updateFundingSourceSchema);
    return json(await updateFundingSource(orgId, body));
  } catch (err) {
    return handleApiError(err);
  }
};
