import type { APIRoute } from "astro";
import { z } from "zod";
import { optimizeStoredImage } from "../../../server/image-storage";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  assertAttachmentStorageKey,
  attachmentContextSchema,
  authorizeAttachmentContext,
  normalizeStorageKey,
} from "../../../server/storage";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

const contextRequestSchema = z.object({
  context: attachmentContextSchema,
  key: z.string().trim().min(1).transform(normalizeStorageKey),
}).strict();
const legacyRequestSchema = z.object({ key: z.string().trim().min(1).transform(normalizeStorageKey) }).strict();
const requestSchema = z.union([contextRequestSchema, legacyRequestSchema]);

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const input = await parseJson(request, requestSchema);
    if (!("context" in input)) {
      const orgId = requireCapability(locals, "operations.mutate");
      return json(await optimizeStoredImage(input.key, orgId));
    }
    const orgId = requireCapability(locals, "grant_documents.mutate");
    const context = await authorizeAttachmentContext(orgId, input.context);
    const key = assertAttachmentStorageKey(orgId, context, input.key);
    return json(await optimizeStoredImage(key, orgId));
  } catch (error) {
    return handleApiError(error);
  }
};
