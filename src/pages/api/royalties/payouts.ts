import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getMasterPayoutPreview } from "../../../server/royalties-dashboard";
import { requireCapability } from "../../../server/tenant";

import { requireSameOrigin } from "../../../server/request-security";
import { HttpError } from "../../../server/errors";
import { recordPayoutBatch, recordPayoutBatchSchema } from "../../../server/royalty-payout-recording";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    return json(await getMasterPayoutPreview(orgId));
  } catch (err) {
    return handleApiError(err);
  }
};

export const POST: APIRoute = async ({request,locals}) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "royalties.mutate");
    if (!locals.user?.id) throw new HttpError("Sign in to record a payout",401);
    const result = await recordPayoutBatch(orgId,locals.user.id,await parseJson(request,recordPayoutBatchSchema));
    return json(result,result.duplicate ? 200 : 201);
  } catch (error) { return handleApiError(error); }
};
