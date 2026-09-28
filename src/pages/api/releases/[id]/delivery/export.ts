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

export const GET: APIRoute = async ({ locals, params, url }) => {
  try {
    const orgId = requireOrgId(locals);
    if (!params.id) throw new HttpError("Release is required", 400);
    const attempts = await listReleaseDeliveryAttempts(orgId, params.id);
    const attemptId = url.searchParams.get("attempt");
    if (attemptId !== null) {
      const attempt = attempts.find(item => item.id === attemptId);
      if (!attempt) throw new HttpError("Delivery export not found", 404);
      return new Response(JSON.stringify(attempt.payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="delivery-v${attempt.payload_version}.${attempt.patch_version}.json"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return json({ attempts });
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
