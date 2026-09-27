import type { APIRoute } from "astro";
import { dashboardPreferencesInputSchema } from "../../../lib/dashboard-preferences";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  getDashboardPreferences,
  resetDashboardPreferences,
  saveDashboardPreferences,
  type DashboardPreferenceOwner,
} from "../../../server/dashboard-preferences";
import { HttpError } from "../../../server/errors";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const { orgId, userId } = personalContext(locals);
    return json(await getDashboardPreferences({ orgId, userId }));
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const { orgId, userId } = personalMutationContext(locals);
    const input = await parseJson(request, dashboardPreferencesInputSchema);
    return json(await saveDashboardPreferences({ orgId, userId }, input));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ locals }) => {
  try {
    const { orgId, userId } = personalMutationContext(locals);
    return json(await resetDashboardPreferences({ orgId, userId }));
  } catch (error) {
    return handleApiError(error);
  }
};

function personalContext(locals: App.Locals): DashboardPreferenceOwner {
  const orgId = requireOrgId(locals);
  const userId = locals.user?.id;
  if (!userId) throw new HttpError("Signed-in user is required", 401);
  return { orgId, userId };
}

function personalMutationContext(locals: App.Locals): DashboardPreferenceOwner {
  const orgId = requireCapability(locals, "dashboard.manage_personal");
  const userId = locals.user?.id;
  if (!userId) throw new HttpError("Signed-in user is required", 401);
  return { orgId, userId };
}
