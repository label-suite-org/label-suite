import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { bulkCreateRoyalties, importRoyaltyRowsSchema } from "../../../server/royalties";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const input = await parseJson(request, importRoyaltyRowsSchema);
    const result = await bulkCreateRoyalties(orgId, input);
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};
