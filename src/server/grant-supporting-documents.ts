import { and, asc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { documents, grant_application_documents, grant_applications } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { listGrantDocumentExtractions, previewExtractedText } from "./grant-document-extractions";
import { replaceGrantApplicationDocuments, replaceGrantApplicationDocumentsSchema } from "./grants-workspace-mutations";
import { assertStorageObjectExists } from "./storage";
import { idSchema } from "./validation";
import { grantDocumentRoleSchema } from "./grant-document-roles";
import { validateGrantSupportingStorageKey } from "./grant-supporting-storage";
export { buildApplicationWritingGuide, type ApplicationWritingGuideBlock } from "./grant-application-guidance";
export { GRANT_DOCUMENT_ROLES, type GrantDocumentRole } from "./grant-document-roles";
export { validateGrantSupportingStorageKey } from "./grant-supporting-storage";

export const linkGrantSupportingDocumentSchema = z.object({
  document_id: idSchema.optional(), storage_key: z.string().trim().min(1).optional(), name: z.string().trim().min(1).optional(),
  link_type: z.string().trim().min(1).optional(), asset_role: grantDocumentRoleSchema.optional(), required: z.boolean().optional(), readiness_status: z.enum(["missing", "draft", "ready", "stale", "not_required"]).optional(),
  replace_link_id: idSchema.optional(),
}).refine((value) => Boolean(value.document_id) !== Boolean(value.storage_key), { message: "Provide either document_id or storage_key" })
  .refine((value) => !value.storage_key || Boolean(value.name), { message: "name is required for uploaded documents" });
export const replaceGrantSupportingDocumentsSchema = replaceGrantApplicationDocumentsSchema.omit({ application_id: true });
export const unlinkGrantSupportingDocumentSchema = z.object({ link_id: idSchema }).strict();
export type GrantApplicationDocumentView = {
  id: string; document_id: string; name: string; file_link: string | null; asset_role: string; link_type: string;
  required: boolean; readiness_status: string; extraction_status: string | null; extraction_error: string | null;
  extracted_text_preview: string | null; extraction_id: string | null; source_hash: string | null;
};

export async function listGrantSupportingDocuments(orgId: string, applicationId: string) {
  await requireApplication(orgId, applicationId);
  const rows = await db.select({
    id: grant_application_documents.id, document_id: documents.id, name: documents.name, file_link: documents.file_link,
    asset_role: grant_application_documents.asset_role, link_type: grant_application_documents.link_type,
    required: grant_application_documents.required, readiness_status: grant_application_documents.readiness_status,
  }).from(grant_application_documents).innerJoin(documents, and(
    eq(grant_application_documents.document_id, documents.id), eq(documents.org_id, orgId),
  )).where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, applicationId)))
    .orderBy(asc(documents.name));
  const latest = await Promise.all(rows.map(async (row) => (await listGrantDocumentExtractions(orgId, row.document_id))[0] ?? null));
  return rows.map((row, index): GrantApplicationDocumentView => {
    const extraction = latest[index];
    return {
      ...row,
      extraction_status: extraction?.status ?? null,
      extraction_error: extraction?.error ?? null,
      extracted_text_preview: previewExtractedText(extraction?.extractedText ?? null),
      extraction_id: extraction?.id ?? null,
      source_hash: extraction?.sourceHash ?? null,
    };
  });
}

/** Organization-scoped picker; callers never need to submit an arbitrary document row. */
export async function listGrantDocumentLibrary(orgId: string, applicationId: string) {
  await requireApplication(orgId, applicationId);
  const linked = await db.select({ document_id: grant_application_documents.document_id })
    .from(grant_application_documents)
    .where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, applicationId)));
  const linkedIds = linked.map((row) => row.document_id);
  const query = db.select({ id: documents.id, name: documents.name, doc_type: documents.doc_type, status: documents.status, file_link: documents.file_link })
    .from(documents).where(linkedIds.length ? and(eq(documents.org_id, orgId), notInArray(documents.id, linkedIds)) : eq(documents.org_id, orgId));
  return query.orderBy(asc(documents.name));
}

export async function linkGrantSupportingDocument(orgId: string, applicationId: string, raw: z.input<typeof linkGrantSupportingDocumentSchema>) {
  const input = linkGrantSupportingDocumentSchema.parse(raw);
  await requireApplication(orgId, applicationId);
  const validatedStorageKey = input.storage_key ? validateGrantSupportingStorageKey(orgId, applicationId, input.storage_key) : null;
  if (validatedStorageKey) await assertStorageObjectExists(validatedStorageKey);
  return db.transaction(async (tx) => {
    let documentId = input.document_id;
    if (documentId) {
      const [document] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.org_id, orgId), eq(documents.id, documentId))).limit(1);
      if (!document) throw new NotFoundError("Document not found in active workspace");
    } else {
      documentId = crypto.randomUUID();
      await tx.insert(documents).values({ id: documentId, org_id: orgId, name: input.name!, doc_type: input.asset_role ?? "grant_support", status: "draft", file_link: validatedStorageKey! });
    }
    if (input.replace_link_id) {
      const rows = await tx.update(grant_application_documents).set({
        document_id: documentId, link_type: input.link_type ?? "attachment", asset_role: input.asset_role ?? "other",
        required: input.required ?? false, readiness_status: input.readiness_status ?? "draft",
      }).where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, applicationId), eq(grant_application_documents.id, input.replace_link_id)))
        .returning({ id: grant_application_documents.id });
      if (!rows.length) throw new NotFoundError("Supporting document link not found");
      return { id: rows[0].id, documentId };
    }
    const id = crypto.randomUUID();
    await tx.insert(grant_application_documents).values({
      id, org_id: orgId, application_id: applicationId, document_id: documentId,
      link_type: input.link_type ?? "attachment", asset_role: input.asset_role ?? "other",
      required: input.required ?? false, readiness_status: input.readiness_status ?? "draft",
    });
    return { id, documentId };
  });
}

export function replaceGrantSupportingDocuments(orgId: string, applicationId: string, raw: z.input<typeof replaceGrantSupportingDocumentsSchema>) {
  return replaceGrantApplicationDocuments(orgId, { ...replaceGrantSupportingDocumentsSchema.parse(raw), application_id: applicationId });
}

export async function unlinkGrantSupportingDocument(orgId: string, applicationId: string, linkId: string) {
  const rows = await db.delete(grant_application_documents).where(and(
    eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, applicationId), eq(grant_application_documents.id, linkId),
  )).returning({ id: grant_application_documents.id });
  if (!rows.length) throw new NotFoundError("Supporting document link not found");
  return { ok: true };
}

async function requireApplication(orgId: string, applicationId: string) {
  const [application] = await db.select({ id: grant_applications.id }).from(grant_applications).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, applicationId))).limit(1);
  if (!application) throw new NotFoundError("Grant application not found in active workspace");
}
