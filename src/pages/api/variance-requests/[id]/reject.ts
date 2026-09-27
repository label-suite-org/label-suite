import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { requireCapability } from "../../../../server/tenant";
import { rejectVarianceRequest } from "../../../../server/budget-mutations";
import { z } from "zod";
import { nullableText } from "../../../../server/validation";

const schema = z.object({ review_note: nullableText.optional() });

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "variance.decide");
    const body = await parseJson(request, schema);
    return json(await rejectVarianceRequest(orgId, { id: params.id!, review_note: body.review_note }));
  } catch (err) {
    return handleApiError(err);
  }
};
