import { and, desc, eq, inArray, ilike, or, sql, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { users } from "../db/auth-schema";
import { z } from "zod";
import {
  budget_line_items, budget_projects, royalty_imports, royalty_import_currency_totals,
  royalty_ledger_transactions, royalty_ledger_entries,
  data_quality_issues,
  finance_transaction_matches,
  finance_transactions,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
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
  amount: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,8})?$/).refine(value => /[1-9]/.test(value), "Amount must be positive"),
  currency: z.string().trim().regex(/^[a-zA-Z]{3}$/),
  direction: z.enum(["credit", "debit"]),
  description: z.string().trim().nullable().optional(),
  raw_evidence: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().trim().optional(),
}).strict();

export const importFinanceTransactionSchema = transactionInputSchema;
export const matchFinanceTransactionSchema = z.object({
  match_type: z.enum(["royalty_receipt", "payout_batch", "budget_spend"]),
  target_id: idSchema,
  allocated_amount: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,8})?$/, "allocated_amount must be a positive decimal with up to 8 fractional digits").refine((value) => Number(value) > 0, "allocated_amount must be positive"),
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
  return db.transaction(async tx => {
    const [row] = await tx
      .insert(finance_transactions)
      .values({
        id: `fin_tx_${hashRawFinanceEvidence({ orgId, source_provider: normalized.source_provider, account_label: normalized.account_label, idempotency_key: normalized.idempotency_key }).slice(0, 32)}`,
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
      await tx.insert(data_quality_issues).values({
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

    const [existing] = row ? [row] : await tx.select().from(finance_transactions).where(and(
      eq(finance_transactions.org_id, orgId),
      eq(finance_transactions.source_provider, normalized.source_provider),
      eq(finance_transactions.account_label, normalized.account_label),
      eq(finance_transactions.idempotency_key, normalized.idempotency_key),
    )).limit(1);
    if (!existing) throw new NotFoundError("Finance transaction not found after idempotent import");
    if (existing.raw_source_hash !== hashRawFinanceEvidence(normalized.raw_evidence)
      || compareDecimalStrings(existing.amount, normalized.amount) !== 0
      || existing.currency !== normalized.currency || existing.direction !== normalized.direction
      || existing.occurred_at.toISOString() !== normalized.occurred_at
      || existing.external_transaction_id !== normalized.external_transaction_id
      || (existing.posted_at?.toISOString() ?? null) !== normalized.posted_at
      || existing.description !== normalized.description) {
      throw new ConflictError("This import key already belongs to different transaction evidence");
    }
    return existing;
  });
}

export async function listFinanceExceptions(orgId: string) {
  return db.select().from(data_quality_issues).where(and(
    eq(data_quality_issues.org_id, orgId),
    eq(data_quality_issues.source, "finance_reconciliation"),
    inArray(data_quality_issues.status, ["open", "triaged"]),
  )).orderBy(desc(data_quality_issues.created_at));
}

export async function matchFinanceTransaction(orgId: string, transactionId: string, raw: z.input<typeof matchFinanceTransactionSchema>, actorUserId: string | null = null) {
  const input = matchFinanceTransactionSchema.parse(raw);
  return db.transaction(async tx => {
    const [transaction] = await tx.select().from(finance_transactions).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, transactionId))).for("update");
    if (!transaction) throw new NotFoundError("Finance transaction not found in active workspace");
    if (transaction.direction !== (input.match_type === "royalty_receipt" ? "credit" : "debit")) {
      throw new ConflictError("The match type does not match the transaction direction");
    }
    if (input.match_type === "royalty_receipt") {
      const [target] = await tx.select().from(royalty_imports).where(and(eq(royalty_imports.org_id,orgId),eq(royalty_imports.id,input.target_id))).for("share");
      if (!target) throw new NotFoundError("Royalty import not found in active workspace");
      const currencies = await tx.select({currency:royalty_import_currency_totals.currency}).from(royalty_import_currency_totals).where(and(eq(royalty_import_currency_totals.org_id,orgId),eq(royalty_import_currency_totals.import_id,target.id)));
      if (target.status !== "parsed" || !(currencies.length ? currencies.some(row=>row.currency === transaction.currency) : target.currency === transaction.currency)) {
        throw new ConflictError("Choose a completed royalty import with the transaction currency");
      }
    } else if (input.match_type === "payout_batch") {
      const [target] = await tx.select().from(royalty_ledger_transactions).where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,input.target_id))).for("share");
      if (!target) throw new NotFoundError("Payout batch not found in active workspace");
      const lines = await tx.select().from(royalty_ledger_entries).where(and(eq(royalty_ledger_entries.org_id,orgId),eq(royalty_ledger_entries.transaction_id,target.id)));
      if (target.posting_status !== "posted" || target.reversal_of_transaction_id || !lines.length || lines.some(line=>line.entry_type !== "payout") || !lines.some(line=>line.currency === transaction.currency)) {
        throw new ConflictError("Choose a posted payout batch with the transaction currency");
      }
    } else {
      const [target] = await tx.select({currency:budget_projects.currency}).from(budget_line_items)
        .innerJoin(budget_projects,and(eq(budget_projects.id,budget_line_items.project_id),eq(budget_projects.org_id,orgId)))
        .where(and(eq(budget_line_items.org_id,orgId),eq(budget_line_items.id,input.target_id))).for("share");
      if (!target) throw new NotFoundError("Budget line with a project not found in active workspace");
      if (target.currency !== transaction.currency) throw new ConflictError("Budget currency does not match the transaction");
    }
    const amountComparison = compareDecimalStrings(input.allocated_amount, transaction.amount);
    if (amountComparison <= 0) {
      const activeMatches = await tx.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(
        eq(finance_transaction_matches.org_id, orgId),
        eq(finance_transaction_matches.transaction_id, transactionId),
        eq(finance_transaction_matches.status, "active"),
      ));
      const allocated = activeMatches.reduce((sum, match) => sum + decimalUnits(String(match.allocated_amount)), 0n);
      if (allocated + decimalUnits(input.allocated_amount) > decimalUnits(transaction.amount)) {
        throw new ConflictError("Match allocation exceeds the transaction amount");
      }
    } else {
      throw new ConflictError("Match allocation exceeds the transaction amount");
    }

    const [match] = await tx.insert(finance_transaction_matches).values({
      id: `fin_match_${crypto.randomUUID()}`,
      org_id: orgId,
      transaction_id: transactionId,
      match_type: input.match_type,
      target_id: input.target_id,
      allocated_amount: input.allocated_amount,
      rationale: input.rationale,
      actor_user_id: actorUserId,
    }).returning();

    const activeMatches = await tx.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(
      eq(finance_transaction_matches.org_id, orgId),
      eq(finance_transaction_matches.transaction_id, transactionId),
      eq(finance_transaction_matches.status, "active"),
    ));
    const allocated = activeMatches.reduce((sum, row) => sum + decimalUnits(String(row.allocated_amount)), 0n);
    await tx.update(finance_transactions).set({ status: allocated === decimalUnits(transaction.amount) ? "matched" : "partially_matched", updated_at: new Date() }).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, transactionId)));
    await tx.update(data_quality_issues).set({ status: allocated === decimalUnits(transaction.amount) ? "resolved" : "triaged", updated_at: new Date() }).where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.label_suite_object_id, transactionId), eq(data_quality_issues.source, "finance_reconciliation")));
    return match;
  });
}

export async function reverseFinanceMatch(orgId: string, raw: z.input<typeof reverseFinanceMatchSchema>, actorUserId: string | null = null, transactionId?: string) {
  const input = reverseFinanceMatchSchema.parse(raw);
  return db.transaction(async tx => {
    const [match] = await tx.select().from(finance_transaction_matches).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.id, input.id), transactionId ? eq(finance_transaction_matches.transaction_id, transactionId) : undefined)).limit(1);
    if (!match) throw new NotFoundError("Finance match not found in active workspace");
    const [lockedTransaction] = await tx.select().from(finance_transactions).where(and(eq(finance_transactions.org_id,orgId),eq(finance_transactions.id,match.transaction_id))).for("update");
    if (!lockedTransaction) throw new NotFoundError("Finance transaction not found in active workspace");
    const [reversed] = await tx.update(finance_transaction_matches).set({ status: "reversed", reversed_at: new Date(), reversed_by: actorUserId, reversal_reason: input.reversal_reason }).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.id, input.id), eq(finance_transaction_matches.status, "active"))).returning();
    if (!reversed) {
      const [current] = await tx.select().from(finance_transaction_matches).where(and(eq(finance_transaction_matches.org_id,orgId),eq(finance_transaction_matches.id,input.id)));
      return current;
    }
    const activeMatches = await tx.select({ allocated_amount: finance_transaction_matches.allocated_amount }).from(finance_transaction_matches).where(and(eq(finance_transaction_matches.org_id, orgId), eq(finance_transaction_matches.transaction_id, match.transaction_id), eq(finance_transaction_matches.status, "active")));
    const allocated = activeMatches.reduce((sum, row) => sum + decimalUnits(String(row.allocated_amount)), 0n);
    const [transaction] = await tx.select({ amount: finance_transactions.amount }).from(finance_transactions).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, match.transaction_id))).limit(1);
    await tx.update(finance_transactions).set({ status: allocated === 0n ? "unmatched" : allocated === decimalUnits(String(transaction?.amount ?? "0")) ? "matched" : "partially_matched", updated_at: new Date() }).where(and(eq(finance_transactions.org_id, orgId), eq(finance_transactions.id, match.transaction_id)));
    await tx.update(data_quality_issues).set({ status: allocated === 0n ? "open" : "triaged", updated_at: new Date() }).where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.label_suite_object_id, match.transaction_id), eq(data_quality_issues.source, "finance_reconciliation")));
    return reversed;
  });
}

export const financeViewSchema = z.object({
  status: z.enum(["unmatched", "partially_matched", "matched", "all"]).default("unmatched"),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  transaction: z.string().trim().min(1).optional(),
  search: z.string().trim().max(200).default(""),
});

export async function getFinanceReconciliationView(orgId: string, input: z.infer<typeof financeViewSchema>) {
  const remaining = sql<string>`(${finance_transactions.amount} - coalesce(sum(${finance_transaction_matches.allocated_amount}) filter (where ${finance_transaction_matches.status} = 'active'),0))::text`;
  const rows = await db.select({id:finance_transactions.id,account:finance_transactions.account_label,
    description:finance_transactions.description,occurredAt:finance_transactions.occurred_at,
    amount:finance_transactions.amount,currency:finance_transactions.currency,direction:finance_transactions.direction,
    status:finance_transactions.status,remaining})
    .from(finance_transactions).leftJoin(finance_transaction_matches,and(eq(finance_transaction_matches.org_id,orgId),eq(finance_transaction_matches.transaction_id,finance_transactions.id)))
    .where(and(eq(finance_transactions.org_id,orgId),input.status === "all" ? undefined : eq(finance_transactions.status,input.status)))
    .groupBy(finance_transactions.id).orderBy(desc(finance_transactions.occurred_at),desc(finance_transactions.id)).limit(51).offset(input.offset);
  const result = {transactions:rows.slice(0,50),hasMore:rows.length>50};
  if (!input.transaction) return {...result,detail:null,candidates:[]};
  const [transaction] = await db.select().from(finance_transactions).where(and(eq(finance_transactions.org_id,orgId),eq(finance_transactions.id,input.transaction)));
  if (!transaction) throw new NotFoundError("Finance transaction not found in active workspace");
  const actor = alias(users,"finance_match_actor"), reverser = alias(users,"finance_match_reverser");
  const matches = await db.select({...getTableColumns(finance_transaction_matches),actorName:actor.name,reversedByName:reverser.name})
    .from(finance_transaction_matches).leftJoin(actor,eq(actor.id,finance_transaction_matches.actor_user_id)).leftJoin(reverser,eq(reverser.id,finance_transaction_matches.reversed_by))
    .where(and(eq(finance_transaction_matches.org_id,orgId),eq(finance_transaction_matches.transaction_id,transaction.id))).orderBy(desc(finance_transaction_matches.created_at),desc(finance_transaction_matches.id));
  const allocated = matches.filter(match=>match.status === "active").reduce((sum,match)=>sum+decimalUnits(match.allocated_amount),0n);
  const units = decimalUnits(transaction.amount)-allocated;
  const detail = {...transaction,matches,remaining:`${units / 100_000_000n}.${(units % 100_000_000n).toString().padStart(8,"0")}`};
  const candidates: Array<{id:string;type:"royalty_receipt"|"payout_batch"|"budget_spend";label:string;currency:string}> = [];
  const search = `%${input.search}%`;
  if (transaction.direction === "credit") {
    const imports = await db.select({id:royalty_imports.id,source:royalty_imports.source,file:royalty_imports.file_name,period:royalty_imports.period_start})
      .from(royalty_imports).where(and(eq(royalty_imports.org_id,orgId),eq(royalty_imports.status,"parsed"),
        or(eq(royalty_imports.currency,transaction.currency),sql`exists(select 1 from ${royalty_import_currency_totals} where ${royalty_import_currency_totals.org_id}=${orgId} and ${royalty_import_currency_totals.import_id}=${royalty_imports.id} and ${royalty_import_currency_totals.currency}=${transaction.currency})`),
        or(ilike(royalty_imports.source,search),ilike(royalty_imports.file_name,search),ilike(royalty_imports.id,search))))
      .orderBy(desc(royalty_imports.created_at),royalty_imports.id).limit(25);
    for (const row of imports) candidates.push({id:row.id,type:"royalty_receipt",label:[row.source,row.file,row.period].filter(Boolean).join(" · "),currency:transaction.currency});
  } else {
    const batches = await db.select({id:royalty_ledger_transactions.id,reference:royalty_ledger_transactions.evidence_reference,date:royalty_ledger_transactions.effective_date})
      .from(royalty_ledger_transactions).where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.posting_status,"posted"),
        sql`${royalty_ledger_transactions.reversal_of_transaction_id} is null`,
        sql`exists(select 1 from ${royalty_ledger_entries} where ${royalty_ledger_entries.org_id}=${orgId} and ${royalty_ledger_entries.transaction_id}=${royalty_ledger_transactions.id} and ${royalty_ledger_entries.entry_type}='payout' and ${royalty_ledger_entries.currency}=${transaction.currency})`,
        sql`not exists(select 1 from ${royalty_ledger_entries} where ${royalty_ledger_entries.org_id}=${orgId} and ${royalty_ledger_entries.transaction_id}=${royalty_ledger_transactions.id} and ${royalty_ledger_entries.entry_type}<>'payout')`,
        or(ilike(royalty_ledger_transactions.evidence_reference,search),ilike(royalty_ledger_transactions.id,search))))
      .orderBy(desc(royalty_ledger_transactions.created_at),royalty_ledger_transactions.id).limit(25);
    for (const row of batches) candidates.push({id:row.id,type:"payout_batch",label:`${row.reference ?? row.id} · ${row.date}`,currency:transaction.currency});
    const lines = await db.select({id:budget_line_items.id,name:budget_line_items.name,project:budget_projects.name})
      .from(budget_line_items).innerJoin(budget_projects,and(eq(budget_projects.id,budget_line_items.project_id),eq(budget_projects.org_id,orgId)))
      .where(and(eq(budget_line_items.org_id,orgId),eq(budget_projects.currency,transaction.currency),or(ilike(budget_line_items.name,search),ilike(budget_projects.name,search))))
      .orderBy(budget_line_items.name,budget_line_items.id).limit(25);
    for (const row of lines) candidates.push({id:row.id,type:"budget_spend",label:`${row.name} · ${row.project}`,currency:transaction.currency});
  }
  return {...result,detail,candidates};
}
