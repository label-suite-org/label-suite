import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { HttpError } from "../../../../../server/errors";
import { requireSameOrigin } from "../../../../../server/request-security";
import { reversePayoutBatch, reversePayoutBatchSchema } from "../../../../../server/royalty-payout-recording";
import { requireCapability } from "../../../../../server/tenant";
import { idSchema } from "../../../../../server/validation";
export const prerender = false;
export const POST: APIRoute = async ({request,locals,params}) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals,"royalties.mutate");
    if (!locals.user?.id) throw new HttpError("Sign in to reverse a recording",401);
    const result = await reversePayoutBatch(orgId,locals.user.id,idSchema.parse(params.id),await parseJson(request,reversePayoutBatchSchema));
    return json(result,result.duplicate ? 200 : 201);
  } catch (error) { return handleApiError(error); }
};
