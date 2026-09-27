import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { artists, releases, budget_projects, contacts, documents, media_assets, media_asset_files, resource_upload_intents } from "../db/schema";
import { db } from "../lib/db";
import { users } from "../db/auth-schema";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { getStorageClient, tenantStorageKey } from "./storage";

export const nativeResourceKind = z.enum(["assets", "documents"]);
export type NativeResourceKind = z.infer<typeof nativeResourceKind>;

export function nativePrivateAssetBucket(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.R2_ASSETS_PRIVATE_BUCKET?.trim();
  if (!bucket || bucket === env.R2_BUCKET?.trim()) throw new HttpError("Private file storage is unavailable", 503);
  return bucket;
}

export async function listNativeResources(orgId: string, kind: NativeResourceKind, query: string | null, cursor: string | null, rawContext?: unknown) {
  const table = kind === "assets" ? media_assets : documents;
  const name = kind === "assets" ? media_assets.asset_name : documents.name;
  const status = kind === "assets" ? media_assets.approval_status : documents.status;
  const context = rawContext === undefined ? undefined : nativeResourceContextSchema.parse(rawContext);
  if (context) await resourceParent(orgId, context);
  const term = query?.trim().slice(0, 120);
  const rows = await db.select({ id: table.id, name, status, revision: sql<string>`${table.updated_at}::text` })
    .from(table).where(and(eq(table.org_id, orgId), context ? eq(resourceContextColumn(kind, context.kind), context.id) : undefined, cursor ? sql`${table.id} > ${cursor}` : undefined,
      term ? sql`position(lower(${term}) in lower(${name})) > 0` : undefined))
    .orderBy(asc(table.id)).limit(26);
  const items = rows.slice(0, 25);
  return { kind, items, next_cursor: rows.length > 25 ? items.at(-1)!.id : null };
}

export async function getNativeResource(orgId: string, kind: NativeResourceKind, id: string) {
  const [record] = kind === "assets"
    ? await db.select({ id: media_assets.id, name: media_assets.asset_name, type: media_assets.asset_type, status: media_assets.approval_status,
      delivery_status: media_assets.delivery_status, revision: sql<string>`${media_assets.updated_at}::text`, notes: media_assets.notes })
      .from(media_assets).where(and(eq(media_assets.org_id, orgId), eq(media_assets.id, id)))
    : await db.select({ id: documents.id, name: documents.name, type: documents.doc_type, status: documents.status,
      delivery_status: sql<null>`null`, revision: sql<string>`${documents.updated_at}::text`, notes: documents.notes })
      .from(documents).where(and(eq(documents.org_id, orgId), eq(documents.id, id)));
  if (!record) throw new NotFoundError("Resource not found");
  const rows = await db.select({ id: media_asset_files.id, name: media_asset_files.file_name,
    content_type: media_asset_files.content_type, size: media_asset_files.file_size,
    source_table: media_asset_files.source_postgres_table, source_id: media_asset_files.source_postgres_record_id,
    provenance: sql<string | null>`${resource_upload_intents.request}->>'provenance'`,
    sha256: sql<string | null>`${resource_upload_intents.request}->>'sha256'`,
    capture_method: sql<string | null>`${resource_upload_intents.request}->>'capture_method'`, uploader: users.name,
    captured_at: media_asset_files.created_at, bucket: media_asset_files.storage_bucket, key: media_asset_files.storage_key })
    .from(media_asset_files)
    .leftJoin(resource_upload_intents, and(eq(resource_upload_intents.org_id, orgId), eq(resource_upload_intents.status, "completed"),
      eq(resource_upload_intents.resource_id, id), sql`${resource_upload_intents.request}->>'kind' = ${kind}`,
      eq(resource_upload_intents.storage_bucket, media_asset_files.storage_bucket), eq(resource_upload_intents.storage_key, media_asset_files.storage_key)))
    .leftJoin(users, eq(users.id, resource_upload_intents.actor_user_id))
    .where(and(eq(media_asset_files.org_id, orgId), kind === "assets"
      ? or(eq(media_asset_files.media_asset_id, id), and(eq(media_asset_files.source_postgres_table, "media_assets"), eq(media_asset_files.source_postgres_record_id, id)))
      : and(eq(media_asset_files.source_postgres_table, "documents"), eq(media_asset_files.source_postgres_record_id, id))))
    .orderBy(asc(media_asset_files.id)).limit(51);
  const configuredBucket = process.env.R2_ASSETS_PRIVATE_BUCKET?.trim();
  const privateReady = Boolean(configuredBucket && configuredBucket !== process.env.R2_BUCKET?.trim());
  const contexts = await nativeResourceContexts(orgId, kind, id);
  return { kind, record, contexts, files: rows.slice(0, 50).map(({ bucket, key, ...file }) => {
    const available = privateReady && bucket === configuredBucket && tenantStorageKey(orgId, key) === key;
    return { ...file, preview_available: available,
      preview_reason: available ? null : "This file has no verified private storage binding." };
  }),
    has_more_files: rows.length > 50,
    notice: "Attachments do not imply approval or publication. Existing external file links are not private previews." };
}

export async function nativeResourceDownload(orgId: string, kind: NativeResourceKind, id: string, fileId: string) {
  await getNativeResource(orgId, kind, id);
  const [file] = await db.select().from(media_asset_files).where(and(eq(media_asset_files.org_id, orgId), eq(media_asset_files.id, fileId),
    kind === "assets" ? or(eq(media_asset_files.media_asset_id, id), and(eq(media_asset_files.source_postgres_table, "media_assets"), eq(media_asset_files.source_postgres_record_id, id)))
      : and(eq(media_asset_files.source_postgres_table, "documents"), eq(media_asset_files.source_postgres_record_id, id))));
  if (!file) throw new NotFoundError("File not found on this resource");
  const bucket = nativePrivateAssetBucket();
  if (file.storage_bucket !== bucket || tenantStorageKey(orgId, file.storage_key) !== file.storage_key) throw new HttpError("Private preview unavailable for this file", 409);
  try {
    await getStorageClient().send(new HeadObjectCommand({ Bucket: bucket, Key: file.storage_key }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) throw new NotFoundError("Stored file is missing. Refresh or restore its attachment.");
    throw error;
  }
  const expiresIn = 60;
  const url = await getSignedUrl(getStorageClient(), new GetObjectCommand({ Bucket: bucket, Key: file.storage_key,
    ResponseContentDisposition: "attachment", ResponseCacheControl: "private, no-store" }), { expiresIn });
  return { url, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(), name: file.file_name, content_type: file.content_type };
}

export const nativeResourceContextSchema = z.object({
  kind: z.enum(["artist", "release", "project", "contact"]), id: z.string().trim().min(1),
}).strict();
type ResourceContext = z.infer<typeof nativeResourceContextSchema>;
export const nativeResourceLinkSchema = z.object({
  action: z.enum(["link", "unlink"]), context: nativeResourceContextSchema,
  expected_revision: z.string().trim().min(1),
}).strict();

export function resourceContextColumn(kind: NativeResourceKind, context: ResourceContext["kind"]) {
  if (kind === "assets") {
    if (context === "contact") throw new HttpError("Assets do not have a canonical contact link", 400);
    return { artist: media_assets.linked_artist_id, release: media_assets.linked_release_id, project: media_assets.project_id }[context];
  }
  return { artist: documents.artist_id, release: documents.release_id, project: documents.project_id, contact: documents.contact_id }[context];
}

export async function resourceParent(orgId: string, context: ResourceContext, client: Pick<typeof db, "select"> = db) {
  const table = { artist: artists, release: releases, project: budget_projects, contact: contacts }[context.kind];
  const name = { artist: artists.name, release: releases.title, project: budget_projects.name, contact: contacts.name }[context.kind];
  const [parent] = await client.select({ id: table.id, name }).from(table)
    .where(and(eq(table.org_id, orgId), eq(table.id, context.id)));
  if (!parent) throw new NotFoundError("Context not found in this workspace");
  return { kind: context.kind, ...parent };
}

async function nativeResourceContexts(orgId: string, kind: NativeResourceKind, id: string) {
  const table = kind === "assets" ? media_assets : documents;
  const [row] = await db.select({ artist: resourceContextColumn(kind, "artist"), release: resourceContextColumn(kind, "release"),
    project: resourceContextColumn(kind, "project"), contact: kind === "documents" ? documents.contact_id : sql<null>`null` })
    .from(table).where(and(eq(table.org_id, orgId), eq(table.id, id)));
  const contexts: Array<{ kind: ResourceContext["kind"]; id: string; name: string }> = [];
  for (const parentKind of ["artist", "release", "project", "contact"] as const) {
    const parentId = row?.[parentKind];
    if (!parentId) continue;
    try { contexts.push(await resourceParent(orgId, { kind: parentKind, id: parentId })); }
    catch (error) { if (!(error instanceof NotFoundError)) throw error; } // Legacy foreign links must not expose identities.
  }
  return contexts;
}

export async function changeNativeResourceContext(orgId: string, kind: NativeResourceKind, id: string, raw: unknown, actorUserId: string) {
  const input = nativeResourceLinkSchema.parse(raw);
  const table = kind === "assets" ? media_assets : documents;
  const column = resourceContextColumn(kind, input.context.kind);
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ parent_id: column, revision: sql<string>`${table.updated_at}::text` })
      .from(table).where(and(eq(table.org_id, orgId), eq(table.id, id))).for("no key update");
    if (!current) throw new NotFoundError("Resource not found");
    if (current.revision !== input.expected_revision) throw new ConflictError("Resource changed. Refresh before linking or unlinking.");
    await resourceParent(orgId, input.context, tx);
    if (input.action === "link" && current.parent_id !== null) throw new ConflictError("Unlink the current context before adding a different link.");
    if (input.action === "unlink" && current.parent_id !== input.context.id) throw new ConflictError("This exact context is no longer linked.");
    const parentId = input.action === "link" ? input.context.id : null;
    const [saved] = await tx.update(table).set({ [column.name]: parentId,
      updated_at: sql`greatest(clock_timestamp(), ${table.updated_at} + interval '1 microsecond')` })
      .where(and(eq(table.org_id, orgId), eq(table.id, id))).returning({ revision: sql<string>`${table.updated_at}::text` });
    await recordAuditEvent(orgId, { actor_user_id: actorUserId, event_type: input.action === "link" ? "resource.linked" : "resource.unlinked",
      object_type: kind === "assets" ? "media_asset" : "document", object_id: id,
      before: { context_kind: input.context.kind, parent_id: current.parent_id, revision: current.revision },
      after: { context_kind: input.context.kind, parent_id: parentId, revision: saved.revision } }, tx);
  });
  return getNativeResource(orgId, kind, id);
}
