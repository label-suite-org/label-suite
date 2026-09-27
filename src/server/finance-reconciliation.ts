import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  data_quality_issues,
  finance_transaction_matches,
  finance_transactions,
} from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import {
  compareDecimalStrings,
  deriveFinanceExceptionIdempotencyKey,
  hashRawFinanceEvidence,
  normalizeFinanceTransaction,
} from "./finance-reconciliation-core";
import { idSchema, requiredText } from "./validation";

const transactionInputSchema = z.object({
  source_provider: requiredText,
  account_label: requiredText,
  external_transaction_id: z.string().trim().nullable().optional(),
  occurred_at: z.coerce.date(),
  posted_at: z.coerce.date().nullable().optional(),
  amount: z.string().trim(),
  currency: z.string().trim(),
  direction: z.enum(["credit", "debit"]),
  description: z.string().trim().nullable().optional(),
  raw_evidence: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().trim().optional(),
}).strict();

export const importFinanceTransactionSchema = transactionInputSchema;
export const matchFinanceTransactionSchema = z.object({
  match_type: z.enum(["royalty_receipt", "payout_batch", "budget_spend"]),
  target_id: idSchema,
  allocated_amount: z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/, "allocated_amount must be a positive decimal with up to 8 fractional digits").refine((value) => Number(value) > 0, "allocated_amount must be positive"),
  rationale: requiredText,
}).strict();
export const reverseFinanceMatchSchema = z.object({
  id: idSchema,
  reversal_reason: requiredText,
}).strict();

function decimalUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((fraction + "0".repeat(8)).slice(0, 8));
}

export async function importFinanceTransaction(orgId: string, raw: z.input<typeof transactionInputSchema>, importedBy: string | null = null) {
  const input = transactionInputSchema.parse(raw);
  const normalized = normalizeFinanceTransaction({
    ...input,
    occurred_at: input.occurred_at.toISOString(),
    posted_at: input.posted_at?.toISOString() ?? null,
    external_transaction_id: input.external_transaction_id ?? null,
    description: input.description ?? null,
    idempotency_key: input.idempotency_key,
  });
  const [row] = await db
    .insert(finance_transactions)
    .values({
      id: `fin_tx_${hashRawFinanceEvidence({ orgId, idempotency_key: normalized.idempotency_key }).slice(0, 32)}`,
      org_id: orgId,
      source_provider: normalized.source_provider,
      account_label: normalized.account_label,
      external_transaction_id: normalized.external_transaction_id,
      occurred_at: new Date(normalized.occurred_at),
      posted_at: normalized.posted_at ? new Date(normalized.posted_at) : null,
      amount: normalized.amount,
      currency: normalized.currency,
      direction: normalized.direction,
      description: normalized.description,
      raw_evidence: normalized.raw_evidence,
      raw_source_hash: hashRawFinanceEvidence(normalized.raw_evidence),
      idempotency_key: normalized.idempotency_key,
      status: "unmatched",
      imported_by: importedBy,
      updated_at: new Date(),
    })
    .onConflictDoNothing({
      target: [finance_transactions.org_id, finance_transactions.source_provider, finance_transactions.account_label, finance_transactions.idempotency_key],
    })
    .returning();

  if (row) {
    await db.insert(data_quality_issues).values({
      id: `dq_finance_${row.id}`,
      org_id: orgId,
      source: "finance_reconciliation",
      issue_type: "unmatched_transaction",
      idempotency_key: deriveFinanceExceptionIdempotencyKey(row.id),
      priority: "P2",
      status: "open",
      label_suite_object_type: "finance_transaction",
      label_suite_object_id: row.id,
      details: { source_provider: row.source_provider, account_label: row.account_label, amount: row.amount, currency: row.currency },
      updated_at: new Date(),
    }).onConflictDoNothing({ target: [data_quality_issues.org_id, data_quality_issues.idempotency_key] });
  }

  const [existing] = row ? [row] : await db.select().from(finance_transactions).where(and(
    eq(finance_transactions.org_id, orgId),
    eq(finance_transactions.source_provider, normalized.source_provider),
    eq(finance_transactions.account_label, normalized.account_label),
    eq(finance_transactions.idempotency_key, normalized.idempotency_key),
  )).limit(1);
  if (!existing) throw new NotFoundError("Finance transaction not found after idempotent import");
  return existing;
}

export async function listFinanceExceptions(orgId: string) {
  return db.select().from(data_quality_issues).where(and(
    eq(data_quality_issues.org_id, orgId),
    eq(data_quality_issues.source, "finance_reconciliation"),
    eq(data_quality_issues.status, "open"),
  )).orderBy(desc(data_quality_issues.created_at));
}

export async function matchFinanceTransaction(orgId: string, transactionId: string, raw: z.input<typeof matchFinanceTransactionSchema>, actorUserId: string | null = null) {
  const input = matchFinanceTransactionSchema.parse(raw);
  const [transaction] = await db.select().from(finance_transactions).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, transactionId))).limit(1);
  if (!transaction) throw new NotFoundError("Finance transaction not found in active workspace");
  const amountComparison = compareDecimalStrings(input.allocated_amount, transaction.amount);
  if (amountComparison <= 0) {
    const activeMatches = await db.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(
      eq(finance_transaction_matches.org_id, orgId),
      eq(finance_transaction_matches.transaction_id, transactionId),
      eq(finance_transaction_matches.status, "active"),
    ));
    const allocated = activeMatches.reduce((sum, match) => sum + decimalUnits(String(match.allocated_amount)), 0n);
    if (allocated + decimalUnits(input.allocated_amount) > decimalUnits(transaction.amount)) {
      throw new Error("Match allocation exceeds the transaction amount");
    }
  } else {
    throw new Error("Match allocation exceeds the transaction amount");
  }

  const [match] = await db.insert(finance_transaction_matches).values({
    id: `fin_match_${crypto.randomUUID()}`,
    org_id: orgId,
    transaction_id: transactionId,
    match_type: input.match_type,
    target_id: input.target_id,
    allocated_amount: input.allocated_amount,
    rationale: input.rationale,
    actor_user_id: actorUserId,
  }).returning();

  const activeMatches = await db.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(
    eq(finance_transaction_matches.org_id, orgId),
    eq(finance_transaction_matches.transaction_id, transactionId),
    eq(finance_transaction_matches.status, "active"),
  ));
  const allocated = activeMatches.reduce((sum, row) => sum + decimalUnits(String(row.allocated_amount)), 0n);
  await db.update(finance_transactions).set({ status: allocated === decimalUnits(transaction.amount) ? "matched" : "partially_matched", updated_at: new Date() }).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, transactionId)));
  await db.update(data_quality_issues).set({ status: allocated === decimalUnits(transaction.amount) ? "resolved" : "triaged", updated_at: new Date() }).where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.label_suite_object_id, transactionId), eq(data_quality_issues.source, "finance_reconciliation")));
  return match;
}

export async function reverseFinanceMatch(orgId: string, raw: z.input<typeof reverseFinanceMatchSchema>, actorUserId: string | null = null) {
  const input = reverseFinanceMatchSchema.parse(raw);
  const [match] = await db.select().from(finance_transaction_matches).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.id, input.id))).limit(1);
  if (!match) throw new NotFoundError("Finance match not found in active workspace");
  const [reversed] = await db.update(finance_transaction_matches).set({ status: "reversed", reversed_at: new Date(), reversed_by: actorUserId, reversal_reason: input.reversal_reason }).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.id, input.id), eq(finance_transaction_matches.status, "active"))).returning();
  if (!reversed) return match;
  const activeMatches = await db.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.transaction_id, match.transaction_id), eq(finance_transaction_matches.status, "active")));
  const allocated = activeMatches.reduce((sum, row) => sum + decimalUnits(String(row.allocated_amount)), 0n);
  const [transaction] = await db.select({ amount: finance_transactions.amount }).from(finance_transactions).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, match.transaction_id))).limit(1);
  await db.update(finance_transactions).set({ status: allocated === 0n ? "unmatched" : allocated === decimalUnits(String(transaction?.amount ?? "0")) ? "matched" : "partially_matched", updated_at: new Date() }).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, match.transaction_id)));
  await db.update(data_quality_issues).set({ status: allocated === 0n ? "open" : "triaged", updated_at: new Date() }).where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.label_suite_object_id, match.transaction_id), eq(data_quality_issues.source, "finance_reconciliation")));
  return reversed;
}
