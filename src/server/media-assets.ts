import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { budget_projects, artists, media_assets, releases } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { assertArtistInOrg, assertReleaseInOrg } from "./projects";
import { hasOwn, idSchema, nullableText } from "./validation";

const mediaAssetBaseSchema = {
  asset_name: z.string().trim().min(1, "asset_name is required"),
  asset_type: nullableText,
  linked_artist_id: nullableText,
  linked_release_id: nullableText,
  project_id: nullableText,
  version: nullableText,
  approval_status: nullableText,
  delivery_status: nullableText,
  file_link: nullableText,
  notes: nullableText,
  date_uploaded: nullableText,
};

export const createMediaAssetSchema = z.object({
  id: idSchema.optional(),
  ...mediaAssetBaseSchema,
});

export const updateMediaAssetSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(mediaAssetBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteMediaAssetSchema = z.object({
  id: idSchema,
});

export type CreateMediaAssetInput = z.infer<typeof createMediaAssetSchema>;
export type UpdateMediaAssetInput = z.infer<typeof updateMediaAssetSchema>;
export type DeleteMediaAssetInput = z.infer<typeof deleteMediaAssetSchema>;

async function assertProjectInOrg(orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;

  const [project] = await db
    .select({ id: budget_projects.id })
    .from(budget_projects)
    .where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, projectId)))
    .limit(1);

  if (!project) {
    throw new NotFoundError("Project not found in active workspace");
  }
}

export async function listMediaAssets(orgId: string) {
  return db
    .select({
      id: media_assets.id,
      asset_name: media_assets.asset_name,
      asset_type: media_assets.asset_type,
      linked_artist_id: media_assets.linked_artist_id,
      linked_release_id: media_assets.linked_release_id,
      project_id: media_assets.project_id,
      version: media_assets.version,
      approval_status: media_assets.approval_status,
      delivery_status: media_assets.delivery_status,
      file_link: media_assets.file_link,
      notes: media_assets.notes,
      date_uploaded: media_assets.date_uploaded,
      artist_name: artists.name,
      release_title: releases.title,
      project_name: budget_projects.name,
    })
    .from(media_assets)
    .leftJoin(artists, and(eq(media_assets.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(media_assets.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(media_assets.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .where(eq(media_assets.org_id, orgId))
    .orderBy(desc(media_assets.created_at));
}

export async function listProjectMediaAssets(orgId: string, projectId: string) {
  return db
    .select({
      id: media_assets.id,
      asset_name: media_assets.asset_name,
      asset_type: media_assets.asset_type,
      linked_artist_id: media_assets.linked_artist_id,
      linked_release_id: media_assets.linked_release_id,
      project_id: media_assets.project_id,
      version: media_assets.version,
      approval_status: media_assets.approval_status,
      delivery_status: media_assets.delivery_status,
      file_link: media_assets.file_link,
      notes: media_assets.notes,
      date_uploaded: media_assets.date_uploaded,
      artist_name: artists.name,
      release_title: releases.title,
      project_name: budget_projects.name,
    })
    .from(media_assets)
    .leftJoin(artists, and(eq(media_assets.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(media_assets.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(media_assets.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .where(and(eq(media_assets.org_id, orgId), eq(media_assets.project_id, projectId)))
    .orderBy(desc(media_assets.created_at));
}

export async function listMediaAssetsForRelease(orgId: string, releaseId: string) {
  return db
    .select({
      id: media_assets.id,
      asset_name: media_assets.asset_name,
      asset_type: media_assets.asset_type,
      version: media_assets.version,
      approval_status: media_assets.approval_status,
      delivery_status: media_assets.delivery_status,
      file_link: media_assets.file_link,
      date_uploaded: media_assets.date_uploaded,
    })
    .from(media_assets)
    .where(and(eq(media_assets.org_id, orgId), eq(media_assets.linked_release_id, releaseId)))
    .orderBy(desc(media_assets.created_at));
}

export async function createMediaAsset(orgId: string, input: CreateMediaAssetInput) {
  const id = input.id ?? crypto.randomUUID();
  await Promise.all([
    assertProjectInOrg(orgId, input.project_id as string | null | undefined),
    assertArtistInOrg(orgId, input.linked_artist_id as string | null | undefined),
    assertReleaseInOrg(orgId, input.linked_release_id as string | null | undefined),
  ]);

  await db.insert(media_assets).values({
    id,
    org_id: orgId,
    asset_name: input.asset_name,
    asset_type: input.asset_type ?? null,
    linked_artist_id: input.linked_artist_id ?? null,
    linked_release_id: input.linked_release_id ?? null,
    project_id: input.project_id ?? null,
    version: input.version ?? null,
    approval_status: input.approval_status ?? "pending",
    delivery_status: input.delivery_status ?? "not_sent",
    file_link: input.file_link ?? null,
    notes: input.notes ?? null,
    date_uploaded: input.date_uploaded ?? null,
  }).onConflictDoNothing({ target: media_assets.id });

  return { id, ok: true };
}

export async function updateMediaAsset(orgId: string, input: UpdateMediaAssetInput) {
  const updates: Partial<typeof media_assets.$inferInsert> = { updated_at: new Date() };
  await Promise.all([
    hasOwn(input, "project_id") ? assertProjectInOrg(orgId, input.project_id as string | null | undefined) : undefined,
    hasOwn(input, "linked_artist_id") ? assertArtistInOrg(orgId, input.linked_artist_id as string | null | undefined) : undefined,
    hasOwn(input, "linked_release_id") ? assertReleaseInOrg(orgId, input.linked_release_id as string | null | undefined) : undefined,
  ]);

  if (hasOwn(input, "asset_name")) updates.asset_name = input.asset_name as string;
  if (hasOwn(input, "asset_type")) updates.asset_type = input.asset_type as string | null;
  if (hasOwn(input, "linked_artist_id")) updates.linked_artist_id = input.linked_artist_id as string | null;
  if (hasOwn(input, "linked_release_id")) updates.linked_release_id = input.linked_release_id as string | null;
  if (hasOwn(input, "project_id")) updates.project_id = input.project_id as string | null;
  if (hasOwn(input, "version")) updates.version = input.version as string | null;
  if (hasOwn(input, "approval_status")) updates.approval_status = input.approval_status as string | null;
  if (hasOwn(input, "delivery_status")) updates.delivery_status = input.delivery_status as string | null;
  if (hasOwn(input, "file_link")) updates.file_link = input.file_link as string | null;
  if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;
  if (hasOwn(input, "date_uploaded")) updates.date_uploaded = input.date_uploaded as string | null;

  const updated = await db
    .update(media_assets)
    .set(updates)
    .where(and(eq(media_assets.id, input.id), eq(media_assets.org_id, orgId)))
    .returning({ id: media_assets.id });

  if (!updated.length) {
    throw new NotFoundError("Media asset not found");
  }

  return { ok: true };
}

export async function deleteMediaAsset(orgId: string, input: DeleteMediaAssetInput) {
  const deleted = await db
    .delete(media_assets)
    .where(and(eq(media_assets.id, input.id), eq(media_assets.org_id, orgId)))
    .returning({ id: media_assets.id });

  if (!deleted.length) {
    throw new NotFoundError("Media asset not found");
  }

  return { ok: true };
}
