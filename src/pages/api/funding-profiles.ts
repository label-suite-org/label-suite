import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { createProjectFundingProfile, createProjectFundingProfileSchema, listProjectFundingProfiles } from "../../server/grants-workspace";
import { requireCapability, requireOrgId } from "../../server/tenant";
import { requireSameOrigin } from "../../server/request-security";

export const GET: APIRoute = async ({ locals }) => {
  try { return json(await listProjectFundingProfiles(requireOrgId(locals))); }
  catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ request, locals }) => {
  try { requireSameOrigin(request); return json(await createProjectFundingProfile(requireCapability(locals, "fundraising.mutate"), await parseJson(request, createProjectFundingProfileSchema)), 201); }
  catch (error) { return handleApiError(error); }
};
export const PUT = POST;
