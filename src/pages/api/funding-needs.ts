import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { createFundingNeed, createFundingNeedSchema, updateFundingNeed, updateFundingNeedSchema } from "../../server/grants-workspace";
import { requireCapability } from "../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await createFundingNeed(orgId, await parseJson(request, createFundingNeedSchema)), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "fundraising.mutate");
    return json(await updateFundingNeed(orgId, await parseJson(request, updateFundingNeedSchema)));
  } catch (error) {
    return handleApiError(error);
  }
};
