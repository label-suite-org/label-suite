import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import {
  assertStorageObjectIsNew,
  attachmentContextSchema,
  authorizeAttachmentContext,
  generateAttachmentStorageKey,
  uploadStorageObject,
} from "../../../server/storage";
import { requireCapability } from "../../../server/tenant";
import { assertGrantDocumentSignature, boundedMultipartRequest, MAX_UPLOAD_BYTES } from "../../../server/upload-security";
import { requireSameOrigin } from "../../../server/request-security";

export const prerender = false;
const MAX_MEDIA_UPLOAD_BYTES = 100 * 1024 * 1024;

const GRANT_DOCUMENT_TYPES = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".doc", new Set(["application/msword"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".xls", new Set(["application/vnd.ms-excel"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])],
  [".csv", new Set(["text/csv", "application/csv"])],
  [".txt", new Set(["text/plain"])],
  [".rtf", new Set(["application/rtf", "text/rtf"])],
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
]);

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const capabilityOrgId = requireCapability(locals, "grant_documents.mutate");
    const mediaUpload = new URL(request.url).searchParams.get("kind") === "media-asset";
    if (mediaUpload) requireCapability(locals, "operations.mutate");
    const maxFileBytes = mediaUpload ? MAX_MEDIA_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    const form = await (await boundedMultipartRequest(request, maxFileBytes + 1024 * 1024)).formData();
    const contextValue = form.get("context");
    const fileValue = form.get("file");

    if (!(fileValue instanceof File)) {
      throw new HttpError("File is required", 400);
    }
    if (fileValue.size > maxFileBytes) {
      throw new HttpError(`File is too large. Maximum upload size is ${mediaUpload ? 100 : 25} MB.`, 413);
    }

    const keyValue = form.get("key");
    if (mediaUpload && (contextValue !== null || typeof keyValue !== "string" || !keyValue.startsWith("media-assets/"))) {
      throw new HttpError("Media uploads require a media-assets storage key and no document context", 400);
    }
    if (typeof contextValue !== "string" || !contextValue.trim()) {
      if (typeof keyValue !== "string" || !keyValue.trim()) throw new HttpError("Storage key is required", 400);
      const orgId = requireCapability(locals, "operations.mutate");
      const bytes = new Uint8Array(await fileValue.arrayBuffer());
      return json(await uploadStorageObject({
        key: keyValue,
        contentType: fileValue.type || "application/octet-stream",
        body: bytes,
      }, orgId));
    }
    if (form.has("key")) throw new HttpError("Client-provided storage keys are not allowed in context mode", 400);
    const orgId = capabilityOrgId;
    assertAllowedGrantDocument(fileValue);
    let parsedContext: unknown;
    try { parsedContext = JSON.parse(contextValue); }
    catch { throw new HttpError("Attachment context must be valid JSON", 400); }
    const context = await authorizeAttachmentContext(orgId, attachmentContextSchema.parse(parsedContext));
    const key = generateAttachmentStorageKey(context, fileValue.name);
    await assertStorageObjectIsNew(key, orgId);
    const bytes = new Uint8Array(await fileValue.arrayBuffer());
    assertGrantDocumentSignature(fileValue, bytes);
    const result = await uploadStorageObject({
      key,
      contentType: fileValue.type || "application/octet-stream",
      body: bytes,
      preventOverwrite: true,
    }, orgId);

    return json(result);
  } catch (err) {
    return handleApiError(err);
  }
};

function assertAllowedGrantDocument(file: File): void {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  const allowedTypes = GRANT_DOCUMENT_TYPES.get(extension);
  const mime = file.type.trim().toLowerCase();
  if (!allowedTypes?.has(mime)) {
    throw new HttpError("File type is not allowed for supporting documents", 415);
  }
}
