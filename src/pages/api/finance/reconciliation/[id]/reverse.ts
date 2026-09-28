import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { reverseFinanceMatch, reverseFinanceMatchSchema } from "../../../../../server/finance-reconciliation";
import { requireSameOrigin } from "../../../../../server/request-security";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    if (!params.id) return json({ error: "Finance transaction is required" }, 400);
    return json({ match: await reverseFinanceMatch(orgId, await parseJson(request, reverseFinanceMatchSchema), locals.user?.id ?? null, params.id) });
  } catch (error) {
    return handleApiError(error);
  }
};
