import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  financeViewSchema, getFinanceReconciliationView,
  importFinanceTransaction,
  importFinanceTransactionSchema,
  listFinanceExceptions,
} from "../../../server/finance-reconciliation";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    const input = financeViewSchema.parse(Object.fromEntries(url.searchParams));
    return json({ ...await getFinanceReconciliationView(orgId,input), exceptions: await listFinanceExceptions(orgId) });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, importFinanceTransactionSchema);
    return json({ transaction: await importFinanceTransaction(orgId, input, locals.user?.id ?? null) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
};
