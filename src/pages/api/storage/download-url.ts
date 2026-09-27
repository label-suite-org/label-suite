import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { createDownloadUrl, normalizeStorageKey } from "../../../server/storage";
import { requireOrgId } from "../../../server/tenant";

export const prerender = false;

const schema = z.object({
  key: z.string().trim().min(1, "key is required").transform(normalizeStorageKey),
  expiresIn: z.number().int().min(60).max(3600).optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const input = await parseJson(request, schema);
    const url = await createDownloadUrl(input.key, orgId, input.expiresIn);
    return json({ url });
  } catch (err) {
    return handleApiError(err);
  }
};
