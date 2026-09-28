import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { getRoyaltyPipelineSummary } from "../../../server/royalty-ledger";
import { requireOrgId } from "../../../server/tenant";
export const prerender = false;
export const GET: APIRoute = async ({locals}) => {
  try {
    const orgId = requireOrgId(locals);
    if (locals.membershipRole === "payee") throw new HttpError("Insufficient permissions",403);
    return json(await getRoyaltyPipelineSummary(orgId));
  } catch (error) { return handleApiError(error); }
};
