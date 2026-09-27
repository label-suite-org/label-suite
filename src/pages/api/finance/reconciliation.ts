import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  importFinanceTransaction,
  importFinanceTransactionSchema,
  listFinanceExceptions,
} from "../../../server/finance-reconciliation";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    return json({ exceptions: await listFinanceExceptions(requireOrgId(locals)) });
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
