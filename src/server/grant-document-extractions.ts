import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, desc, eq, ne } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import { grant_application_documents, grant_document_extractions, documents, grant_applications } from "../db/schema";
import { db } from "../lib/db";
import { getStorageBucket, getStorageClient, tenantStorageKey } from "./storage";
import { NotFoundError } from "./errors";

export const EXTRACTION_TEXT_LIMIT = 50_000;
export const EXTRACTION_PREVIEW_LIMIT = 1_000;
export const GRANT_DOCUMENT_EXTRACTION_STATUSES = ["pending", "ready", "failed"] as const;
export type GrantDocumentExtractionStatus = typeof GRANT_DOCUMENT_EXTRACTION_STATUSES[number];

export type GrantDocumentExtractionRecord = {
  id: string;
  orgId: string;
  documentId: string;
  sourceStorageKey: string;
  sourceHash: string;
  status: GrantDocumentExtractionStatus;
  extractedText: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type PdfParseResult = { text?: string; numpages?: number; info?: Record<string, unknown> };
type PdfParser = (bytes: Uint8Array) => Promise<PdfParseResult>;

const defaultPdfParser: PdfParser = async (bytes) => {
  const parser = new PDFParse({ data: bytes });
  try {
    const [text, info] = await Promise.all([parser.getText(), parser.getInfo()]);
    return { text: text.text, numpages: text.total, info: info.info as Record<string, unknown> | undefined };
  } finally {
    await parser.destroy();
  }
};

export async function extractPdfTextFromBytes(
  bytes: Uint8Array,
  options: { parse?: PdfParser } = {},
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (!header.startsWith("%PDF-")) throw new Error("Only PDF documents can be extracted");
  const parsed = await (options.parse ?? defaultPdfParser)(bytes);
  const text = String(parsed.text ?? "").slice(0, EXTRACTION_TEXT_LIMIT);
  return {
    text,
    metadata: {
      info: parsed.info ?? {},
      ...(typeof parsed.numpages === "number" ? { numpages: parsed.numpages } : {}),
    },
  };
}

export type GrantDocumentExtractionDeps = {
  readObject?: (orgId: string, storageKey: string) => Promise<Uint8Array>;
  parse?: PdfParser;
};

export async function extractGrantDocument(
  orgId: string,
  documentId: string,
  deps: GrantDocumentExtractionDeps = {},
): Promise<GrantDocumentExtractionRecord> {
  const [document] = await db.select({
    id: documents.id,
    fileLink: documents.file_link,
  }).from(documents).innerJoin(grant_application_documents, and(
    eq(grant_application_documents.document_id, documents.id),
    eq(grant_application_documents.org_id, orgId),
  )).innerJoin(grant_applications, and(
    eq(grant_applications.id, grant_application_documents.application_id),
    eq(grant_applications.org_id, orgId),
  )).where(and(eq(documents.id, documentId), eq(documents.org_id, orgId))).limit(1);
  if (!document?.fileLink) throw new NotFoundError("Linked grant document has no storage object");

  let bytes: Uint8Array;
  try {
    bytes = await (deps.readObject ?? readStorageObject)(orgId, document.fileLink);
  } catch (error) {
    const sourceHash = `unavailable:${createHash("sha256").update(document.fileLink).digest("hex")}`;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Storage object could not be read";
    const now = new Date();
    const [row] = await db.insert(grant_document_extractions).values({ id: crypto.randomUUID(), org_id: orgId, document_id: documentId, source_storage_key: document.fileLink, source_hash: sourceHash, status: "failed", extracted_text: null, metadata: null, error: message, created_at: now, updated_at: now })
      .onConflictDoUpdate({
        target: [grant_document_extractions.org_id, grant_document_extractions.document_id, grant_document_extractions.source_hash],
        set: { source_storage_key: document.fileLink, status: "failed", extracted_text: null, metadata: null, error: message, updated_at: now },
      }).returning();
    return serializeExtraction(row);
  }
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const [existing] = await db.select().from(grant_document_extractions).where(and(
    eq(grant_document_extractions.org_id, orgId), eq(grant_document_extractions.document_id, documentId), eq(grant_document_extractions.source_hash, sourceHash),
  )).orderBy(desc(grant_document_extractions.updated_at)).limit(1);
  if (existing?.status === "ready") return serializeExtraction(existing);

  const now = new Date();
  // Claim the unique source row atomically. A concurrent retry either inserts
  // this row or observes the row inserted by its peer; neither can create a
  // duplicate or turn a completed extraction into an insert error.
  const [inserted] = await db.insert(grant_document_extractions).values({
    id: crypto.randomUUID(), org_id: orgId, document_id: documentId, source_storage_key: document.fileLink, source_hash: sourceHash,
    status: "pending" as const, extracted_text: null, metadata: null, error: null, created_at: now, updated_at: now,
  }).onConflictDoNothing({
    target: [grant_document_extractions.org_id, grant_document_extractions.document_id, grant_document_extractions.source_hash],
  }).returning();
  const [claimed] = inserted ? [inserted] : await db.select().from(grant_document_extractions).where(and(
    eq(grant_document_extractions.org_id, orgId), eq(grant_document_extractions.document_id, documentId), eq(grant_document_extractions.source_hash, sourceHash),
  )).limit(1);
  if (!claimed) throw new Error("Extraction row could not be claimed");
  if (claimed.status === "ready") return serializeExtraction(claimed);
  const [pending] = await db.update(grant_document_extractions).set({
    source_storage_key: document.fileLink, status: "pending", extracted_text: null, metadata: null, error: null, updated_at: now,
  }).where(and(eq(grant_document_extractions.id, claimed.id), ne(grant_document_extractions.status, "ready"))).returning();
  if (!pending) {
    const [ready] = await db.select().from(grant_document_extractions).where(eq(grant_document_extractions.id, claimed.id)).limit(1);
    if (ready?.status === "ready") return serializeExtraction(ready);
  }
  const id = claimed.id;

  try {
    const result = await extractPdfTextFromBytes(bytes, { parse: deps.parse });
    const [row] = await db.update(grant_document_extractions).set({
      status: "ready", extracted_text: result.text, metadata: result.metadata, error: null, updated_at: new Date(),
    }).where(eq(grant_document_extractions.id, id)).returning();
    return serializeExtraction(row);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "PDF extraction failed";
    const [row] = await db.update(grant_document_extractions).set({ status: "failed", error: message, updated_at: new Date() }).where(eq(grant_document_extractions.id, id)).returning();
    return serializeExtraction(row);
  }
}

export async function listGrantDocumentExtractions(orgId: string, documentId: string) {
  const rows = await db.select().from(grant_document_extractions).where(and(eq(grant_document_extractions.org_id, orgId), eq(grant_document_extractions.document_id, documentId))).orderBy(desc(grant_document_extractions.updated_at));
  return rows.map(serializeExtraction);
}

export function previewExtractedText(text: string | null): string | null {
  return text ? text.slice(0, EXTRACTION_PREVIEW_LIMIT) : null;
}

function serializeExtraction(row: typeof grant_document_extractions.$inferSelect): GrantDocumentExtractionRecord {
  return {
    id: row.id, orgId: row.org_id, documentId: row.document_id, sourceStorageKey: row.source_storage_key, sourceHash: row.source_hash,
    status: row.status as GrantDocumentExtractionStatus, extractedText: row.extracted_text ?? null,
    metadata: row.metadata ?? null, error: row.error ?? null, createdAt: row.created_at?.toISOString() ?? new Date(0).toISOString(), updatedAt: row.updated_at?.toISOString() ?? new Date(0).toISOString(),
  };
}

async function readStorageObject(orgId: string, storageKey: string): Promise<Uint8Array> {
  const response = await getStorageClient().send(new GetObjectCommand({ Bucket: getStorageBucket(), Key: tenantStorageKey(orgId, storageKey) }));
  if (!response.Body) throw new Error("Storage object has no body");
  return response.Body.transformToByteArray();
}
