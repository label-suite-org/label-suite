import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { listWorkspaceMembers } from "../../../server/member-invitations";
import { requireOrgId } from "../../../server/tenant";

export const GET: APIRoute = async ({ locals }) => {
  try {
    return json(await listWorkspaceMembers(requireOrgId(locals)));
  } catch (error) {
    return handleApiError(error);
  }
};
