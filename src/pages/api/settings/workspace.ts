import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability, requireOrgId } from "../../../server/tenant";
import {
  getWorkspaceSettings,
  getWorkspaceSettingsQuerySchema,
  updateWorkspaceSettings,
  updateWorkspaceSettingsSchema,
} from "../../../server/settings";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    const query = getWorkspaceSettingsQuerySchema.parse({
      sequenceYear: url.searchParams.get("sequenceYear") ?? undefined,
    });
    const result = await getWorkspaceSettings(orgId, query.sequenceYear);
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "workspace.manage_settings");
    const input = await parseJson(request, updateWorkspaceSettingsSchema);
    const result = await updateWorkspaceSettings(orgId, input);
    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};
