import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { requireSameOrigin } from "../../../../../server/request-security";
import { reviewRoyaltyStatement, reviewRoyaltyStatementSchema } from "../../../../../server/royalty-statement-review";
import { requireCapability } from "../../../../../server/tenant";
import { idSchema, requiredText } from "../../../../../server/validation";

export const prerender = false;
export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "royalties.mutate");
    if (!locals.user?.id) throw new HttpError("Sign in to issue a statement", 401);
    const input = await parseJson(request, reviewRoyaltyStatementSchema.extend({ evidence_reference: requiredText.max(500) }));
    return json(await reviewRoyaltyStatement(orgId, idSchema.parse(params.id), input.expected_updated_at, { actorId: locals.user.id, reference: input.evidence_reference }));
  } catch (error) { return handleApiError(error); }
};
