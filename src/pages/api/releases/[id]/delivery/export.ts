import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import {
  exportReleaseDelivery,
  listReleaseDeliveryAttempts,
  manualDeliveryExportSchema,
} from "../../../../../server/delivery-exports";
import { HttpError } from "../../../../../server/errors";
import { requireCapability, requireOrgId } from "../../../../../server/tenant";
import { requireSameOrigin } from "../../../../../server/request-security";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireOrgId(locals);
    if (!params.id) throw new HttpError("Release is required", 400);
    return json({ attempts: await listReleaseDeliveryAttempts(orgId, params.id) });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "operations.mutate");
    if (!params.id) throw new HttpError("Release is required", 400);
    const input = await parseJson(request, manualDeliveryExportSchema);
    const result = await exportReleaseDelivery(orgId, params.id, input, locals.user?.id ?? null);
    return json(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
};
