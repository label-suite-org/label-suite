import { createHash, randomUUID } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { documents, grant_applications, grant_application_documents, media_assets, media_asset_files, org_memberships, resource_upload_intents as intents } from "../db/schema";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { nativePrivateAssetBucket, nativeResourceContextSchema, nativeResourceKind, resourceContextColumn, resourceParent } from "./native-assets";
import { getStorageClient, tenantStorageKey } from "./storage";
import { assertGrantDocumentSignature, MAX_UPLOAD_BYTES } from "./upload-security";
import { recordAuditEvent } from "./integrations";
import { hasCapability } from "./native-capabilities";

const fileTypes: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", mp4: "video/mp4" };
export const resourceUploadSchema = z.object({
  client_request_id: z.uuid(), kind: nativeResourceKind, name: z.string().trim().min(1).max(300),
  context: z.union([nativeResourceContextSchema, z.object({ kind: z.literal("grant_application"), id: z.string().trim().min(1) }).strict()]), provenance: z.string().trim().min(1).max(2000),
  capture_method: z.enum(["files", "camera", "scan"]), file_name: z.string().trim().min(1).max(255).refine(name => !/[\\/\x00-\x1f]/.test(name)),
  content_type: z.string().min(1), size: z.number().int().positive().max(MAX_UPLOAD_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((input, ctx) => {
  if (input.context.kind === "grant_application" && input.kind !== "documents") ctx.addIssue({ code: "custom", message: "Grant evidence must be a document" });
  const extension = input.file_name.split(".").at(-1)!.toLowerCase();
  if (fileTypes[extension] !== input.content_type) ctx.addIssue({ code: "custom", message: "Unsupported file type or filename" });
  if (input.capture_method === "camera" && !["image/jpeg", "image/png"].includes(input.content_type)) ctx.addIssue({ code: "custom", message: "Camera capture requires an image" });
  if (input.capture_method === "scan" && input.content_type !== "application/pdf") ctx.addIssue({ code: "custom", message: "Scanned documents require PDF" });
});
type UploadRequest = z.infer<typeof resourceUploadSchema>;
type Intent = typeof intents.$inferSelect;

async function authorizeUpload(orgId: string, actor: string, request?: UploadRequest, client: Pick<typeof db, "select"> = db, lock = false) {
  const query = client.select({ role: org_memberships.role }).from(org_memberships)
    .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, actor)));
  const [membership] = await (lock ? query.for("share") : query);
  if (!membership) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
  const role = membership.role;
  if (role !== "owner" && role !== "operator" && role !== "fundraiser") throw new HttpError("Insufficient permissions", 403);
  if (request ? !hasCapability(role, request.context.kind === "grant_application" ? "grant_documents.mutate" : "operations.mutate")
    : !hasCapability(role, "operations.mutate") && !hasCapability(role, "grant_documents.mutate")) throw new HttpError("Insufficient permissions", 403);
}
async function uploadParent(orgId: string, request: UploadRequest, client: Pick<typeof db, "select"> = db, lock = false) {
  if (request.context.kind !== "grant_application") {
    resourceContextColumn(request.kind, request.context.kind);
    return resourceParent(orgId, request.context, client);
  }
  const query = client.select({ id: grant_applications.id }).from(grant_applications)
    .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, request.context.id)));
  const [application] = await (lock ? query.for("update") : query);
  if (!application) throw new NotFoundError("Grant application not found in this workspace");
  return application;
}
function projection(intent: Intent) {
  const request = resourceUploadSchema.parse(intent.request);
  return { id: intent.id, status: intent.status, request, resource_id: intent.resource_id };
}

export async function prepareResourceUpload(orgId: string, actor: string, raw: unknown) {
  const request = resourceUploadSchema.parse(raw);
  await authorizeUpload(orgId, actor, request);
  await uploadParent(orgId, request);
  const bucket = nativePrivateAssetBucket();
  const id = randomUUID();
  await db.insert(intents).values({ id, org_id: orgId, actor_user_id: actor, client_request_id: request.client_request_id,
    request, storage_bucket: bucket, storage_key: tenantStorageKey(orgId, `private-resource-uploads/${id}`) })
    .onConflictDoNothing({ target: [intents.org_id, intents.actor_user_id, intents.client_request_id] });
  const [intent] = await db.select().from(intents).where(and(eq(intents.org_id, orgId), eq(intents.actor_user_id, actor), eq(intents.client_request_id, request.client_request_id)));
  if (JSON.stringify(resourceUploadSchema.parse(intent.request)) !== JSON.stringify(request)) throw new ConflictError("This upload request already exists with different content or context");
  return projection(intent);
}

export async function getResourceUpload(orgId: string, actor: string, id: string) {
  await authorizeUpload(orgId, actor);
  const [intent] = await db.select().from(intents).where(and(eq(intents.id, id), eq(intents.org_id, orgId), eq(intents.actor_user_id, actor)));
  if (!intent) throw new NotFoundError("Upload not found");
  await authorizeUpload(orgId, actor, resourceUploadSchema.parse(intent.request));
  return projection(intent);
}

function validateBytes(request: UploadRequest, bytes: Uint8Array) {
  if (bytes.length !== request.size || createHash("sha256").update(bytes).digest("hex") !== request.sha256) throw new ConflictError("File bytes differ from the prepared upload");
  const ext = request.file_name.split(".").at(-1)!.toLowerCase();
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 12));
  if ((ext === "mp3" && !(header.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224))) ||
      (ext === "wav" && !(header.startsWith("RIFF") && header.slice(8, 12) === "WAVE")) ||
      (ext === "flac" && !header.startsWith("fLaC")) || (ext === "mp4" && header.slice(4, 8) !== "ftyp")) throw new HttpError("File content does not match its type", 415);
  assertGrantDocumentSignature(new File([Buffer.from(bytes)], request.file_name, { type: request.content_type }), bytes);
}

export async function completeResourceUpload(orgId: string, actor: string, id: string, bytes: Uint8Array) {
  await authorizeUpload(orgId, actor);
  const [intent] = await db.select().from(intents).where(and(eq(intents.id, id), eq(intents.org_id, orgId), eq(intents.actor_user_id, actor)));
  if (!intent) throw new NotFoundError("Upload not found");
  const request = resourceUploadSchema.parse(intent.request);
  await authorizeUpload(orgId, actor, request);
  validateBytes(request, bytes);
  if (intent.status === "completed") return projection(intent);
  await uploadParent(orgId, request);
  const bucket = nativePrivateAssetBucket();
  if (intent.storage_bucket !== bucket || tenantStorageKey(orgId, intent.storage_key) !== intent.storage_key) throw new ConflictError("Upload storage binding changed");
  const storage = getStorageClient();
  try {
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: intent.storage_key, Body: bytes,
      ContentType: request.content_type, CacheControl: "private, no-store", IfNoneMatch: "*",
      ContentMD5: createHash("md5").update(bytes).digest("base64"), Metadata: { sha256: request.sha256 } }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
    // A previous attempt may have stored bytes but failed its database commit.
  }
  let stored;
  try { stored = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: intent.storage_key })); }
  catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) throw new ConflictError("Stored upload is missing. Retry the same upload.");
    throw error;
  }
  if (stored.ContentLength !== request.size || stored.ContentType !== request.content_type || stored.Metadata?.sha256 !== request.sha256) throw new ConflictError("Stored upload does not match the prepared file");
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(intents).where(and(eq(intents.id, id), eq(intents.org_id, orgId), eq(intents.actor_user_id, actor))).for("update");
    await authorizeUpload(orgId, actor, request, tx, true);
    await uploadParent(orgId, request, tx, true);
    if (current.status === "completed") return projection(current);
    const resourceId = randomUUID();
    const contextColumn = request.context.kind === "grant_application" ? null : resourceContextColumn(request.kind, request.context.kind);
    if (request.kind === "assets") await tx.insert(media_assets).values({ id: resourceId, org_id: orgId, asset_name: request.name,
      [contextColumn!.name]: request.context.id, approval_status: "pending", delivery_status: "not_sent" });
    else await tx.insert(documents).values({ id: resourceId, org_id: orgId, name: request.name,
      ...(contextColumn ? { [contextColumn.name]: request.context.id } : {}), status: "draft" });
    if (request.context.kind === "grant_application") {
      await tx.insert(grant_application_documents).values({ id: randomUUID(), org_id: orgId, application_id: request.context.id,
        document_id: resourceId, link_type: "attachment", asset_role: "other", required: false, readiness_status: "draft" });
    }
    await tx.insert(media_asset_files).values({ id: randomUUID(), org_id: orgId, media_asset_id: request.kind === "assets" ? resourceId : null,
      source_postgres_table: request.kind === "assets" ? "media_assets" : "documents", source_postgres_record_id: resourceId,
      file_name: request.file_name, content_type: request.content_type, file_size: request.size,
      storage_bucket: bucket, storage_key: intent.storage_key });
    await recordAuditEvent(orgId, { actor_user_id: actor, event_type: "resource.uploaded", object_type: request.kind === "assets" ? "media_asset" : "document",
      object_id: resourceId, after: { name: request.name, context: request.context }, metadata: { upload_id: id, sha256: request.sha256,
        provenance: request.provenance, capture_method: request.capture_method } }, tx);
    const [completed] = await tx.update(intents).set({ status: "completed", resource_id: resourceId, updated_at: new Date() })
      .where(eq(intents.id, id)).returning();
    return projection(completed);
  });
}
