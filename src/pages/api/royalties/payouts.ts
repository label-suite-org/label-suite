import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { getMasterPayoutPreview } from "../../../server/royalties-dashboard";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    return json(await getMasterPayoutPreview(orgId));
  } catch (err) {
    return handleApiError(err);
  }
};
