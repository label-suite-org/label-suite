import type { APIRoute } from "astro";
import { getGrantsWorkspace } from "../../server/grants-workspace";
import { handleApiError, json } from "../../server/api";
import { requireOrgId } from "../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    return json(await getGrantsWorkspace(requireOrgId(locals)));
  } catch (error) {
    return handleApiError(error);
  }
};
