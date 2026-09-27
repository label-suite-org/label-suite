import type { APIRoute } from "astro";
import { z } from "zod";
import { createBestImageDownloadUrl } from "../../../server/image-storage";
import { handleApiError, json, parseJson } from "../../../server/api";
import { createDownloadUrl, DEFAULT_SIGNED_URL_TTL_SECONDS, normalizeStorageKey } from "../../../server/storage";
import { requireOrgId } from "../../../server/tenant";

export const prerender = false;

const requestSchema = z.object({
  items: z.array(z.object({
    key: z.string().trim().min(1).transform(normalizeStorageKey),
    imageWidth: z.union([z.literal(96), z.literal(320), z.literal(800)]).optional(),
  })).min(1).max(100),
});

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const input = await parseJson(request, requestSchema);
    const uniqueItems = Array.from(new Map(
      input.items.map((item) => [`${item.key}|${item.imageWidth ?? "original"}`, item]),
    ).values());
    const items = await Promise.all(uniqueItems.map(async ({ key, imageWidth }) => {
      if (imageWidth) {
        const result = await createBestImageDownloadUrl(key, orgId, imageWidth);
        return { key, imageWidth, url: result.url, optimized: result.optimized };
      }
      return {
        key,
        url: await createDownloadUrl(key, orgId),
        optimized: false,
      };
    }));

    return json({
      items,
      expiresAt: Date.now() + DEFAULT_SIGNED_URL_TTL_SECONDS * 1000,
    });
  } catch (error) {
    return handleApiError(error);
  }
};
