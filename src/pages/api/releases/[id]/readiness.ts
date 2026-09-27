import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { correctReleaseField, getReleaseReadinessSnapshot, releaseCorrectionSchema } from "../../../../server/release-correction";
import { requireCapability, requireOrgId } from "../../../../server/tenant";
import { idSchema } from "../../../../server/validation";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    if (locals.membershipRole === "payee") throw new HttpError("Insufficient permissions", 403);
    return json(await getReleaseReadinessSnapshot(requireOrgId(locals), idSchema.parse(params.id)));
  } catch (error) { return handleApiError(error); }
};

export const PUT: APIRoute = async ({ request, params, locals }) => {
  try {
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, releaseCorrectionSchema);
    const snapshot = await correctReleaseField(orgId, idSchema.parse(params.id), locals.user.id, input);
    return json({ ok: true, ...snapshot });
  } catch (error) { return handleApiError(error); }
};
