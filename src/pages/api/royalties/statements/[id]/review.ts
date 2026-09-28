import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { requireSameOrigin } from "../../../../../server/request-security";
import { reviewRoyaltyStatement, reviewRoyaltyStatementSchema } from "../../../../../server/royalty-statement-review";
import { requireCapability } from "../../../../../server/tenant";
import { idSchema } from "../../../../../server/validation";

export const prerender = false;
export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, reviewRoyaltyStatementSchema);
    return json(await reviewRoyaltyStatement(orgId, idSchema.parse(params.id), input.expected_updated_at));
  } catch (error) { return handleApiError(error); }
};
