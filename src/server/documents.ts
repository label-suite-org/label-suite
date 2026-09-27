import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { budget_projects, artists, contacts, documents, grant_application_documents, releases } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { assertArtistInOrg, assertContactInOrg, assertReleaseInOrg } from "./projects";
import { hasOwn, idSchema, nullableText } from "./validation";

const documentBaseSchema = {
  name: z.string().trim().min(1, "name is required"),
  doc_type: nullableText,
  release_id: nullableText,
  artist_id: nullableText,
  contact_id: nullableText,
  project_id: nullableText,
  status: nullableText,
  file_link: nullableText,
  notes: nullableText,
};

export const createDocumentSchema = z.object({
  id: idSchema.optional(),
  ...documentBaseSchema,
});

export const updateDocumentSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(documentBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteDocumentSchema = z.object({
  id: idSchema,
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;

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

export async function listDocuments(orgId: string) {
  return db
    .select({
      id: documents.id,
      name: documents.name,
      doc_type: documents.doc_type,
      release_id: documents.release_id,
      artist_id: documents.artist_id,
      contact_id: documents.contact_id,
      project_id: documents.project_id,
      status: documents.status,
      file_link: documents.file_link,
      notes: documents.notes,
      release_title: releases.title,
      artist_name: artists.name,
      contact_name: contacts.name,
      project_name: budget_projects.name,
      grant_application_count: sql<number>`(
        select count(*)::int from ${grant_application_documents}
        where ${grant_application_documents.document_id} = ${documents.id}
          and ${grant_application_documents.org_id} = ${orgId}
      )`,
    })
    .from(documents)
    .leftJoin(releases, and(eq(documents.release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(documents.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(contacts, and(eq(documents.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(documents.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .where(eq(documents.org_id, orgId))
    .orderBy(desc(documents.created_at));
}

export async function listDocumentsForRelease(orgId: string, releaseId: string) {
  return db
    .select({
      id: documents.id,
      name: documents.name,
      doc_type: documents.doc_type,
      status: documents.status,
      file_link: documents.file_link,
      created_at: documents.created_at,
    })
    .from(documents)
    .where(and(eq(documents.org_id, orgId), eq(documents.release_id, releaseId)))
    .orderBy(desc(documents.created_at));
}

export async function listProjectDocuments(orgId: string, projectId: string) {
  return db
    .select({
      id: documents.id,
      name: documents.name,
      doc_type: documents.doc_type,
      release_id: documents.release_id,
      artist_id: documents.artist_id,
      contact_id: documents.contact_id,
      project_id: documents.project_id,
      status: documents.status,
      file_link: documents.file_link,
      notes: documents.notes,
      release_title: releases.title,
      artist_name: artists.name,
      contact_name: contacts.name,
      project_name: budget_projects.name,
    })
    .from(documents)
    .leftJoin(releases, and(eq(documents.release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(documents.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(contacts, and(eq(documents.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(documents.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .where(and(eq(documents.org_id, orgId), eq(documents.project_id, projectId)))
    .orderBy(desc(documents.created_at));
}

export async function createDocument(orgId: string, input: CreateDocumentInput) {
  const id = input.id ?? crypto.randomUUID();
  await Promise.all([
    assertProjectInOrg(orgId, input.project_id as string | null | undefined),
    assertArtistInOrg(orgId, input.artist_id as string | null | undefined),
    assertReleaseInOrg(orgId, input.release_id as string | null | undefined),
    assertContactInOrg(orgId, input.contact_id as string | null | undefined),
  ]);

  await db.insert(documents).values({
    id,
    org_id: orgId,
    name: input.name,
    doc_type: input.doc_type ?? null,
    release_id: input.release_id ?? null,
    artist_id: input.artist_id ?? null,
    contact_id: input.contact_id ?? null,
    project_id: input.project_id ?? null,
    status: input.status ?? "draft",
    file_link: input.file_link ?? null,
    notes: input.notes ?? null,
  }).onConflictDoNothing({ target: documents.id });

  return { id, ok: true };
}

export async function updateDocument(orgId: string, input: UpdateDocumentInput) {
  const updates: Partial<typeof documents.$inferInsert> = { updated_at: new Date() };
  await Promise.all([
    hasOwn(input, "project_id") ? assertProjectInOrg(orgId, input.project_id as string | null | undefined) : undefined,
    hasOwn(input, "artist_id") ? assertArtistInOrg(orgId, input.artist_id as string | null | undefined) : undefined,
    hasOwn(input, "release_id") ? assertReleaseInOrg(orgId, input.release_id as string | null | undefined) : undefined,
    hasOwn(input, "contact_id") ? assertContactInOrg(orgId, input.contact_id as string | null | undefined) : undefined,
  ]);

  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "doc_type")) updates.doc_type = input.doc_type as string | null;
  if (hasOwn(input, "release_id")) updates.release_id = input.release_id as string | null;
  if (hasOwn(input, "artist_id")) updates.artist_id = input.artist_id as string | null;
  if (hasOwn(input, "contact_id")) updates.contact_id = input.contact_id as string | null;
  if (hasOwn(input, "project_id")) updates.project_id = input.project_id as string | null;
  if (hasOwn(input, "status")) updates.status = input.status as string | null;
  if (hasOwn(input, "file_link")) updates.file_link = input.file_link as string | null;
  if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;

  const updated = await db
    .update(documents)
    .set(updates)
    .where(and(eq(documents.id, input.id), eq(documents.org_id, orgId)))
    .returning({ id: documents.id });

  if (!updated.length) {
    throw new NotFoundError("Document not found");
  }

  return { ok: true };
}

export async function deleteDocument(orgId: string, input: DeleteDocumentInput) {
  const deleted = await db
    .delete(documents)
    .where(and(eq(documents.id, input.id), eq(documents.org_id, orgId)))
    .returning({ id: documents.id });

  if (!deleted.length) {
    throw new NotFoundError("Document not found");
  }

  return { ok: true };
}
