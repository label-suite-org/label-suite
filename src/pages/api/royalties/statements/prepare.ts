import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { prepareRoyaltyStatements, prepareRoyaltyStatementsSchema } from "../../../../server/royalty-statements";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, prepareRoyaltyStatementsSchema);
    return json(await prepareRoyaltyStatements(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};
