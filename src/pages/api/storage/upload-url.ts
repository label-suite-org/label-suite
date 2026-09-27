import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { attachmentContextSchema } from "../../../server/storage";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const contextUploadSchema = z.object({
  context: attachmentContextSchema,
  filename: z.string().trim().min(1, "filename is required"),
  contentType: z.string().trim().min(1).optional(),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES, "File is too large. Maximum upload size is 25 MB."),
}).strict();
const legacyUploadSchema = z.object({
  key: z.string().trim().min(1).transform((key) => key),
  contentType: z.string().trim().min(1).optional(),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES, "File is too large. Maximum upload size is 25 MB."),
}).strict();
const createUploadUrlRequestSchema = z.union([contextUploadSchema, legacyUploadSchema]);

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const input = await parseJson(request, createUploadUrlRequestSchema);
    if ("key" in input) {
      requireCapability(locals, "operations.mutate");
      throw new HttpError("Presigned uploads are disabled; use the server upload endpoint", 410);
    }
    throw new HttpError("Context uploads must use the server upload endpoint", 403);
  } catch (err) {
    return handleApiError(err);
  }
};
