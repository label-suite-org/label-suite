import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { budget_line_documents, documents, budget_line_items } from "../db/schema";
import { db } from "../lib/db";
import { idSchema } from "./validation";

// ─── Schema ────────────────────────────────────────────
export const linkDocumentSchema = z.object({
  document_id: idSchema,
  link_type: z.enum(["invoice", "receipt", "quote", "contract"]),
});

export type LinkDocumentInput = z.infer<typeof linkDocumentSchema>;

// ─── Link document to line ─────────────────────────────
export async function linkDocumentToLine(
  orgId: string,
  budgetLineItemId: string,
  input: LinkDocumentInput,
) {
  // Verify the line exists
  const lines = await db
    .select({ id: budget_line_items.id })
    .from(budget_line_items)
    .where(and(eq(budget_line_items.id, budgetLineItemId), eq(budget_line_items.org_id, orgId)));
  if (!lines.length) throw new Error(`Budget line not found: ${budgetLineItemId}`);

  // Verify the document exists
  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, input.document_id), eq(documents.org_id, orgId)));
  if (!docs.length) throw new Error(`Document not found: ${input.document_id}`);

  const id = crypto.randomUUID();
  await db.insert(budget_line_documents).values({
    id,
    org_id: orgId,
    budget_line_item_id: budgetLineItemId,
    document_id: input.document_id,
    link_type: input.link_type,
  });

  return { ok: true, id };
}

// ─── List documents linked to a line ───────────────────
export async function listDocumentsForLine(orgId: string, budgetLineItemId: string) {
  return db
    .select({
      id: budget_line_documents.id,
      budget_line_item_id: budget_line_documents.budget_line_item_id,
      document_id: budget_line_documents.document_id,
      link_type: budget_line_documents.link_type,
      created_at: budget_line_documents.created_at,
      document_name: documents.name,
      document_type: documents.doc_type,
      document_status: documents.status,
      document_file_link: documents.file_link,
    })
    .from(budget_line_documents)
    .innerJoin(
      documents,
      and(eq(budget_line_documents.document_id, documents.id), eq(documents.org_id, orgId)),
    )
    .where(
      and(
        eq(budget_line_documents.budget_line_item_id, budgetLineItemId),
        eq(budget_line_documents.org_id, orgId),
      ),
    )
    .orderBy(asc(budget_line_documents.created_at));
}

// ─── Get document counts per line ──────────────────────
export async function getDocumentCountsForLines(
  orgId: string,
  lineIds: string[],
): Promise<Record<string, number>> {
  if (!lineIds.length) return {};

  const result: Record<string, number> = {};
  for (const id of lineIds) result[id] = 0;

  const allRows = await db
    .select({
      budget_line_item_id: budget_line_documents.budget_line_item_id,
    })
    .from(budget_line_documents)
    .where(eq(budget_line_documents.org_id, orgId));

  for (const row of allRows) {
    if (result[row.budget_line_item_id] !== undefined) {
      result[row.budget_line_item_id] = (result[row.budget_line_item_id] ?? 0) + 1;
    }
  }

  return result;
}

// ─── Delete a document link ────────────────────────────
export async function deleteDocumentLink(orgId: string, linkId: string) {
  const deleted = await db
    .delete(budget_line_documents)
    .where(and(eq(budget_line_documents.id, linkId), eq(budget_line_documents.org_id, orgId)))
    .returning({ id: budget_line_documents.id });

  if (!deleted.length) {
    throw new Error(`Document link not found: ${linkId}`);
  }

  return { ok: true };
}
