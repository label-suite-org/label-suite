import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { getPayoutBatch, payoutBatchIdSchema } from "../../../../../server/royalty-payout-recording";
import { requireCapability } from "../../../../../server/tenant";
export const prerender = false;
export const GET: APIRoute = async ({locals,params}) => {
  try { return json(await getPayoutBatch(requireCapability(locals, "royalties.mutate"),payoutBatchIdSchema.parse(params.id))); }
  catch (error) { return handleApiError(error); }
};
