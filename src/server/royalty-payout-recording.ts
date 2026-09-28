import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts, royalty_statements, royalty_payouts, royalty_ledger_transactions, royalty_ledger_entries } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { compareMoney, createMoney } from "./royalty-engine/money";

export const payoutBatchIdSchema = z.string().regex(/^payout-batch(?::|%3[aA])[a-f0-9]{24}$/)
  .transform(value => value.replace(/%3[aA]/, ":"));

export const recordPayoutBatchSchema = z.object({
  idempotency_key: z.string().uuid(),
  reference: z.string().trim().min(1).max(500),
  effective_date: z.string().date(),
  lines: z.array(z.object({ statement_id: z.string().min(1), amount: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/).refine(value => /[1-9]/.test(value), "Amount must be positive") }).strict()).min(1).max(100),
}).strict().refine(input => new Set(input.lines.map(line => line.statement_id)).size === input.lines.length, "Each statement can appear only once");

export async function recordPayoutBatch(orgId: string, actorId: string, raw: z.input<typeof recordPayoutBatchSchema>) {
  const input = recordPayoutBatchSchema.parse(raw);
  const batchId = `payout-batch:${createHash("sha256").update(JSON.stringify([orgId,input.idempotency_key])).digest("hex").slice(0,24)}`;
  const lines = [...input.lines].sort((a,b) => a.statement_id.localeCompare(b.statement_id));
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${batchId}, 0))`);
    const [existing] = await tx.select().from(royalty_ledger_transactions)
      .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,batchId)));
    if (existing) {
      const saved = await tx.select().from(royalty_ledger_entries)
        .where(and(eq(royalty_ledger_entries.org_id,orgId),eq(royalty_ledger_entries.transaction_id,batchId)));
      const same = existing.evidence_reference === input.reference && existing.effective_date === input.effective_date
        && saved.length === lines.length && lines.every(line => {
          const entry = saved.find(item => item.statement_id === line.statement_id);
          const spec = {currency:entry?.currency ?? "USD",scale:8,roundingMode:"ROUND_HALF_UP" as const};
          return entry && compareMoney(createMoney(entry.amount,spec),createMoney(`-${line.amount}`,spec)) === 0;
        });
      if (!same || existing.posting_status !== "posted") throw new ConflictError("This batch key already belongs to a different or reversed recording");
      return { batch_id:batchId, duplicate:true };
    }
    await tx.insert(royalty_ledger_transactions).values({id:batchId,org_id:orgId,idempotency_key:batchId,actor_user_id:actorId,evidence_reference:input.reference,effective_date:input.effective_date});
    for (const [index,line] of lines.entries()) {
      const [statement] = await tx.select().from(royalty_statements)
        .where(and(eq(royalty_statements.org_id,orgId),eq(royalty_statements.id,line.statement_id))).for("update");
      if (!statement) throw new NotFoundError("Statement not found in this workspace");
      if (!["issued","closed"].includes(statement.status)) throw new ConflictError("Record payouts only against issued statements");
      const balance = await tx.execute<{amount:string}>(sql`select coalesce(sum(entry.amount),0)::text as amount
        from label_suite.royalty_ledger_entries entry
        join label_suite.royalty_ledger_transactions transaction on transaction.id=entry.transaction_id and transaction.org_id=entry.org_id
        where entry.org_id=${orgId} and entry.statement_id=${statement.id} and entry.contact_id=${statement.contact_id}
          and entry.currency=${statement.currency} and transaction.posting_status in ('posted','reversed')`);
      const spec = {currency:statement.currency,scale:8,roundingMode:"ROUND_HALF_UP" as const};
      const amount = createMoney(line.amount,spec);
      if (compareMoney(amount,createMoney(balance.rows[0].amount,spec)) > 0) throw new ConflictError("Payout exceeds the statement's posted balance");
      const payoutId = `${batchId}:${index}`;
      await tx.insert(royalty_payouts).values({id:payoutId,org_id:orgId,contact_id:statement.contact_id,statement_id:statement.id,amount:amount.amount,currency:statement.currency,reference:input.reference,paid_at:new Date(`${input.effective_date}T00:00:00Z`)});
      await tx.update(royalty_payouts).set({status:"approved",updated_at:new Date()}).where(and(eq(royalty_payouts.org_id,orgId),eq(royalty_payouts.id,payoutId)));
      await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId},${actorId})`);
      await tx.update(royalty_payouts).set({status:"recorded",updated_at:new Date()}).where(and(eq(royalty_payouts.org_id,orgId),eq(royalty_payouts.id,payoutId)));
      await tx.insert(royalty_ledger_entries).values({id:payoutId,org_id:orgId,transaction_id:batchId,payout_id:payoutId,statement_id:statement.id,contact_id:statement.contact_id,entry_type:"payout",amount:`-${amount.amount}`,currency:statement.currency,effective_date:input.effective_date});
    }
    await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId},${actorId})`);
    await tx.update(royalty_ledger_transactions).set({posting_status:"posted",posted_at:new Date()})
      .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,batchId)));
    return {batch_id:batchId,duplicate:false};
  });
}

export const reversePayoutBatchSchema = z.object({
  reference: z.string().trim().min(1).max(500), effective_date: z.string().date(),
}).strict();

export async function reversePayoutBatch(orgId: string, actorId: string, batchId: string, raw: z.input<typeof reversePayoutBatchSchema>) {
  const input = reversePayoutBatchSchema.parse(raw);
  if (!/^payout-batch:[a-f0-9]{24}$/.test(batchId)) throw new NotFoundError("Payout batch not found");
  const reversalId = `reversal:${batchId}`;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${batchId}, 0))`);
    const [original] = await tx.select().from(royalty_ledger_transactions)
      .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,batchId))).for("update");
    if (!original) throw new NotFoundError("Payout batch not found in this workspace");
    if (original.posting_status === "reversed") {
      const [existing] = await tx.select().from(royalty_ledger_transactions)
        .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,reversalId)));
      if (existing?.evidence_reference !== input.reference || existing.effective_date !== input.effective_date || existing.posting_status !== "posted") {
        throw new ConflictError("This batch already has a different reversal");
      }
      return { reversal_id:reversalId, duplicate:true };
    }
    if (original.posting_status !== "posted" || input.effective_date < original.effective_date) throw new ConflictError("Reversal requires a posted batch and a date on or after its recording");
    const entries = await tx.select().from(royalty_ledger_entries)
      .where(and(eq(royalty_ledger_entries.org_id,orgId),eq(royalty_ledger_entries.transaction_id,batchId)));
    if (!entries.length || entries.some(entry => !entry.statement_id || !entry.payout_id || entry.entry_type !== "payout" || !entry.amount.startsWith("-"))) {
      throw new ConflictError("Batch evidence is incomplete; it cannot be reversed automatically");
    }
    for (const statementId of [...new Set(entries.map(entry => entry.statement_id!))].sort((a,b) => a.localeCompare(b))) {
      await tx.select({id:royalty_statements.id}).from(royalty_statements)
        .where(and(eq(royalty_statements.org_id,orgId),eq(royalty_statements.id,statementId))).for("update");
    }
    await tx.insert(royalty_ledger_transactions).values({
      id:reversalId,org_id:orgId,idempotency_key:reversalId,actor_user_id:actorId,
      evidence_reference:input.reference,effective_date:input.effective_date,reversal_of_transaction_id:batchId,
    });
    for (const [index,entry] of entries.entries()) {
      await tx.insert(royalty_ledger_entries).values({
        id:`${reversalId}:${index}`,org_id:orgId,transaction_id:reversalId,payout_id:entry.payout_id,
        statement_id:entry.statement_id,contact_id:entry.contact_id,entry_type:entry.entry_type,
        amount:entry.amount.slice(1),currency:entry.currency,effective_date:input.effective_date,
      });
      const [payout] = await tx.select().from(royalty_payouts)
        .where(and(eq(royalty_payouts.org_id,orgId),eq(royalty_payouts.id,entry.payout_id!))).for("update");
      if (payout?.status !== "recorded") throw new ConflictError("A payout in this batch is no longer recorded");
      await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId},${actorId})`);
      await tx.update(royalty_payouts).set({status:"reversed",updated_at:new Date()})
        .where(and(eq(royalty_payouts.org_id,orgId),eq(royalty_payouts.id,payout.id)));
    }
    await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId},${actorId})`);
    await tx.update(royalty_ledger_transactions).set({posting_status:"posted",posted_at:new Date()})
      .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,reversalId)));
    await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId},${actorId})`);
    await tx.update(royalty_ledger_transactions).set({posting_status:"reversed"})
      .where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,batchId)));
    return {reversal_id:reversalId,duplicate:false};
  });
}

export async function getPayoutBatch(orgId: string, batchId: string) {
  if (!/^payout-batch:[a-f0-9]{24}$/.test(batchId)) throw new NotFoundError("Payout batch not found");
  return db.transaction(async tx => {
    const [batch] = await tx.select({ id:royalty_ledger_transactions.id, status:royalty_ledger_transactions.posting_status,
      reference:royalty_ledger_transactions.evidence_reference, effective_date:royalty_ledger_transactions.effective_date,
    }).from(royalty_ledger_transactions).where(and(eq(royalty_ledger_transactions.org_id,orgId),eq(royalty_ledger_transactions.id,batchId)));
    if (!batch) throw new NotFoundError("Payout batch not found in this workspace");
    const lines = await tx.select({ id:royalty_ledger_entries.id, statement_id:royalty_ledger_entries.statement_id,
      contact_name:contacts.name, amount:royalty_ledger_entries.amount, currency:royalty_ledger_entries.currency,
    }).from(royalty_ledger_entries)
      .leftJoin(contacts,and(eq(contacts.org_id,orgId),eq(contacts.id,royalty_ledger_entries.contact_id)))
      .where(and(eq(royalty_ledger_entries.org_id,orgId),eq(royalty_ledger_entries.transaction_id,batchId)))
      .orderBy(royalty_ledger_entries.id);
    return {batch,lines};
  },{isolationLevel:"repeatable read"});
}
