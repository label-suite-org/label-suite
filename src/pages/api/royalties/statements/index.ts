import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { getNativeRoyaltyPage } from "../../../../server/native-royalties";
import { requireOrgId } from "../../../../server/tenant";
export const prerender = false;
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    if (locals.membershipRole === "payee") throw new HttpError("Insufficient permissions", 403);
    return json(await getNativeRoyaltyPage(orgId, { section: "statements", offset: url.searchParams.get("offset") ?? 0 }));
  } catch (error) { return handleApiError(error); }
};
