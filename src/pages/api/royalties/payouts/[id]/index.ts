import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../server/api";
import { getPayoutBatch } from "../../../../../server/royalty-payout-recording";
import { requireCapability } from "../../../../../server/tenant";
import { idSchema } from "../../../../../server/validation";
export const prerender = false;
export const GET: APIRoute = async ({locals,params}) => {
  try { return json(await getPayoutBatch(requireCapability(locals,"royalties.mutate"),idSchema.parse(params.id))); }
  catch (error) { return handleApiError(error); }
};
