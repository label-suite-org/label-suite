import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { budget_line_items, grant_applications } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { idSchema } from "./validation";

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 10;

export interface StorageObjectInput {
  key: string;
  contentType?: string | null;
  preventOverwrite?: boolean;
}

export interface StorageUploadInput extends StorageObjectInput {
  body: Uint8Array;
  cacheControl?: string | null;
  preventOverwrite?: boolean;
}

export interface StorageObjectRef {
  key: string;
  url: string | null;
}

export const attachmentContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("budget_line"), id: idSchema }),
  z.object({ type: z.literal("grant_application"), id: idSchema }),
]);

export type AttachmentContext = z.infer<typeof attachmentContextSchema>;
export type AttachmentContextLookup = (
  orgId: string,
  type: AttachmentContext["type"],
  id: string,
) => Promise<boolean>;

let client: S3Client | null = null;

export function getStorageClient(): S3Client {
  if (client) return client;

  const endpoint = getR2Endpoint();
  client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return client;
}

export function getStorageBucket(): string {
  return requireEnv("R2_BUCKET");
}

export async function createUploadUrl(
  input: StorageObjectInput,
  orgId: string,
  expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<StorageObjectRef & { uploadUrl: string; requiredHeaders?: Record<string, string> }> {
  const key = tenantStorageKey(orgId, input.key);
  const command = new PutObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
    ContentType: input.contentType ?? undefined,
    IfNoneMatch: input.preventOverwrite ? "*" : undefined,
  });

  return {
    key,
    url: getPublicObjectUrl(key),
    uploadUrl: await getSignedUrl(getStorageClient(), command, { expiresIn }),
    ...(input.preventOverwrite ? { requiredHeaders: { "If-None-Match": "*" } } : {}),
  };
}

export async function createDownloadUrl(
  key: string,
  orgId: string,
  expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getStorageBucket(),
    Key: tenantStorageKey(orgId, key),
  });

  return getSignedUrl(getStorageClient(), command, { expiresIn });
}

export async function uploadStorageObject(
  input: StorageUploadInput,
  orgId: string,
): Promise<StorageObjectRef> {
  const key = tenantStorageKey(orgId, input.key);
  const command = new PutObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
    Body: input.body,
    ContentType: input.contentType ?? undefined,
    CacheControl: input.cacheControl ?? undefined,
    IfNoneMatch: input.preventOverwrite ? "*" : undefined,
  });

  try {
    await getStorageClient().send(command);
  } catch (error) {
    if (input.preventOverwrite && isStoragePreconditionFailure(error)) {
      throw new ConflictError("Storage object already exists");
    }
    throw error;
  }

  return {
    key,
    url: getPublicObjectUrl(key),
  };
}

export async function authorizeAttachmentContext(
  orgId: string,
  rawContext: AttachmentContext,
  lookup: AttachmentContextLookup = lookupAttachmentContext,
): Promise<AttachmentContext> {
  const context = attachmentContextSchema.parse(rawContext);
  if (!await lookup(orgId, context.type, context.id)) {
    throw new NotFoundError("Attachment context not found in active workspace");
  }
  return context;
}

export function generateAttachmentStorageKey(context: AttachmentContext, filename: string): string {
  const parsed = attachmentContextSchema.parse(context);
  const folder = attachmentContextFolder(parsed);
  const safeFilename = filename
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-") || "file";
  return `${folder}/attachments/${crypto.randomUUID()}-${safeFilename}`;
}

export function assertAttachmentStorageKey(
  orgId: string,
  context: AttachmentContext,
  key: string,
): string {
  const expectedPrefix = `${tenantStorageKey(orgId, attachmentContextFolder(context))}/attachments/`;
  const normalized = normalizeStorageKey(key);
  if (!normalized.startsWith(expectedPrefix) || normalized.length === expectedPrefix.length) {
    throw new Error("Storage key does not match attachment context");
  }
  return normalized;
}

export type StorageObjectExists = (storageKey: string) => Promise<boolean>;

export async function assertStorageObjectIsNew(
  key: string,
  orgId: string,
  exists: StorageObjectExists = storageObjectExists,
): Promise<void> {
  const storageKey = tenantStorageKey(orgId, key);
  if (await exists(storageKey)) throw new ConflictError("Storage object already exists");
}

async function storageObjectExists(storageKey: string): Promise<boolean> {
  try {
    await getStorageClient().send(new HeadObjectCommand({ Bucket: getStorageBucket(), Key: storageKey }));
  } catch (error) {
    if (isStorageNotFound(error)) return false;
    throw error;
  }
  return true;
}

export async function assertStorageObjectExists(storageKey: string): Promise<void> {
  if (!await storageObjectExists(normalizeStorageKey(storageKey))) throw new NotFoundError("Storage object not found");
}

export async function deleteStorageObject(key: string, orgId: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: getStorageBucket(),
    Key: tenantStorageKey(orgId, key),
  });

  await getStorageClient().send(command);
}

export function getPublicObjectUrl(key: string): string | null {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL || process.env.PUBLIC_R2_PUBLIC_URL;
  if (!baseUrl) return null;

  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponentPath(normalizeStorageKey(key))}`;
}

export function normalizeStorageKey(key: string): string {
  const normalized = key
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid storage key");
  }

  return normalized;
}

export function tenantStorageKey(orgId: string, key: string): string {
  const safeOrgId = normalizeStorageSegment(orgId);
  const normalized = normalizeStorageKey(key);
  if (normalized === safeOrgId || normalized.startsWith(`${safeOrgId}/`)) {
    return normalized;
  }
  return `${safeOrgId}/${normalized}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for storage`);
  }

  return value;
}

function getR2Endpoint(): string {
  const endpoint = process.env.R2_ENDPOINT;
  if (endpoint) return endpoint;

  const accountId = requireEnv("R2_ACCOUNT_ID");
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function normalizeStorageSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!normalized) {
    throw new Error("Invalid storage org");
  }
  return normalized;
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function attachmentContextFolder(context: AttachmentContext): string {
  const id = normalizeStorageSegment(context.id);
  return context.type === "budget_line" ? `budget-lines/${id}` : `grant-applications/${id}`;
}

async function lookupAttachmentContext(
  orgId: string,
  type: AttachmentContext["type"],
  id: string,
): Promise<boolean> {
  const table = type === "budget_line" ? budget_line_items : grant_applications;
  const rows = await db.select({ id: table.id }).from(table).where(and(
    eq(table.org_id, orgId),
    eq(table.id, id),
  )).limit(1);
  return rows.length > 0;
}

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

function isStoragePreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}
