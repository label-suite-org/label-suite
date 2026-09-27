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
    const form = await (await boundedMultipartRequest(request)).formData();
    const contextValue = form.get("context");
    const fileValue = form.get("file");

    if (!(fileValue instanceof File)) {
      throw new HttpError("File is required", 400);
    }
    if (fileValue.size > MAX_UPLOAD_BYTES) {
      throw new HttpError("File is too large. Maximum upload size is 25 MB.", 413);
    }

    const keyValue = form.get("key");
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
