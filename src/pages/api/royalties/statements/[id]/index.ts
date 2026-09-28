import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { getNativeRoyaltyStatement } from "../../../../../server/native-royalties";
import { requireOrgId } from "../../../../../server/tenant";
import { idSchema } from "../../../../../server/validation";
export const prerender = false;
export const GET: APIRoute = async ({ locals, url, params }) => {
  try {
    const orgId = requireOrgId(locals);
    if (locals.membershipRole === "payee") throw new HttpError("Insufficient permissions", 403);
    return json(await getNativeRoyaltyStatement(orgId, idSchema.parse(params.id), url.searchParams.get("offset") ?? 0));
  } catch (error) { return handleApiError(error); }
};
