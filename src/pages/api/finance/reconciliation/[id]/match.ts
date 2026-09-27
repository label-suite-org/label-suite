import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { matchFinanceTransaction, matchFinanceTransactionSchema } from "../../../../../server/finance-reconciliation";
import { requireSameOrigin } from "../../../../../server/request-security";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    if (!params.id) return json({ error: "Finance transaction is required" }, 400);
    return json({ match: await matchFinanceTransaction(orgId, params.id, await parseJson(request, matchFinanceTransactionSchema), locals.user?.id ?? null) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
};
