import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { royalty_statements, royalty_calculation_runs, royalty_ledger_transactions, royalty_ledger_entries } from "../db/schema";
import { buildCalculationRunId } from "./royalty-statements-core";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";

export const reviewRoyaltyStatementSchema = z.object({
  expected_updated_at: z.string().datetime(),
}).strict();

export async function reviewRoyaltyStatement(orgId: string, statementId: string, expectedUpdatedAt: string, issuance?: { actorId: string; reference: string }) {
  return db.transaction(async tx => {
    const [statement] = await tx.select().from(royalty_statements)
      .where(and(eq(royalty_statements.org_id, orgId), eq(royalty_statements.id, statementId))).for("update");
    if (!statement) throw new NotFoundError("Statement not found in this workspace");
    if (statement.updated_at?.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new ConflictError("Statement changed; reload it before reviewing");
    }
    if (statement.status !== (issuance ? "reviewed" : "calculated")) throw new ConflictError(issuance ? "Only a reviewed statement can be issued" : "Only a calculated statement can be reviewed");
    // Lock the complete period in a stable order before checking any allocation.
    await tx.execute(sql`select earning.id from label_suite.royalty_earnings earning
      where earning.org_id = ${orgId} and (
        (${Boolean(issuance)} and earning.currency = ${statement.currency}
          and earning.report_period >= ${statement.period_start.slice(0, 7)} and earning.report_period <= ${statement.period_end.slice(0, 7)})
        or (${!issuance} and exists (select 1 from label_suite.royalty_statement_lines line
          where line.org_id = ${orgId} and line.statement_id = ${statementId} and line.earning_id = earning.id)))
      order by earning.id for update`);
    const result = await tx.execute<{ valid: boolean }>(sql`
      select count(*) > 0
        and bool_and(coalesce(line.line_type = 'earning'
          and earning.id is not null and split.id is not null
          and split.contact_id = ${statement.contact_id}
          and line.share_percent = split.share_percent
          and role.contact_id = split.contact_id and role.percent_share = split.share_percent
          and role.scope = 'Master' and role.ownership_type = 'Rights'
          and role.work_id = earning.work_id
          and role.updated_at <= line.created_at
          and (select sum(current_split_role.percent_share) from label_suite.roles current_split_role
            where current_split_role.org_id = ${orgId} and current_split_role.work_id = earning.work_id
              and current_split_role.scope = 'Master' and current_split_role.ownership_type = 'Rights') = 100
          and earning.currency = ${statement.currency}
          and earning.updated_at <= line.created_at, false))
        and ${statement.opening_balance}::numeric = 0
        and ${statement.adjustments_amount}::numeric = 0 and ${statement.payout_amount}::numeric = 0
        and sum(line.amount) = ${statement.earnings_amount}::numeric
        and ${statement.opening_balance}::numeric + ${statement.earnings_amount}::numeric
          + ${statement.adjustments_amount}::numeric - ${statement.payout_amount}::numeric
          = ${statement.closing_balance}::numeric as valid
      from label_suite.royalty_statement_lines line
      left join label_suite.royalty_earnings earning on earning.id = line.earning_id and earning.org_id = line.org_id
      left join label_suite.royalty_split_lines split on split.id = line.split_line_id and split.org_id = line.org_id
      left join label_suite.roles role on role.id = split.role_id and role.org_id = line.org_id
      where line.org_id = ${orgId} and line.statement_id = ${statementId}
    `);
    if (result.rows[0]?.valid !== true) {
      throw new ConflictError("Statement evidence or totals need correction before review");
    }
    if (issuance) {
      const overlap = await tx.execute(sql`select 1 from label_suite.royalty_statement_lines current_line
        join label_suite.royalty_statement_lines previous_line on previous_line.earning_id = current_line.earning_id and previous_line.org_id = current_line.org_id
        join label_suite.royalty_statements previous on previous.id = previous_line.statement_id and previous.org_id = previous_line.org_id
        where current_line.org_id = ${orgId} and current_line.statement_id = ${statementId}
          and previous.id <> ${statementId} and previous.contact_id = ${statement.contact_id}
          and previous.status in ('issued', 'closed') limit 1`);
      if (overlap.rows.length) throw new ConflictError("Source earnings have already been issued to this payee");
      const runId = /^Calculation run (royalty_calculation_[a-f0-9]{24})$/.exec(statement.notes ?? "")?.[1];
      if (!runId) throw new ConflictError("Statement calculation evidence is missing");
      // The notes field is editable; prove its run id against current calculation inputs.
      const earnings = await tx.execute<{ id: string; work_id: string | null; report_period: string; currency: string; net_amount: string }>(sql`
        select id, work_id, report_period, currency, net_amount from label_suite.royalty_earnings
        where org_id = ${orgId} and currency = ${statement.currency}
          and report_period >= ${statement.period_start.slice(0, 7)} and report_period <= ${statement.period_end.slice(0, 7)}
        order by id for update`);
      const roles = await tx.execute<{ id: string; work_id: string; contact_id: string; percent_share: string; payee_name: string | null }>(sql`
        select role.id, role.work_id, role.contact_id, role.percent_share, contact.name as payee_name
        from label_suite.roles role left join label_suite.contacts contact on contact.id = role.contact_id and contact.org_id = role.org_id
        where role.org_id = ${orgId} and role.scope = 'Master' and role.ownership_type = 'Rights'
          and role.percent_share is not null and role.work_id in (
            select work_id from label_suite.royalty_earnings where org_id = ${orgId} and currency = ${statement.currency}
              and report_period >= ${statement.period_start.slice(0, 7)} and report_period <= ${statement.period_end.slice(0, 7)})
        order by role.id for share of role`);
      const signature = JSON.stringify({
        earnings: earnings.rows.map(row => [row.id, row.work_id, row.report_period, row.currency, row.net_amount]).sort(),
        roles: roles.rows.map(row => [row.id, row.work_id, row.contact_id, row.percent_share, row.payee_name])
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      });
      if (runId !== buildCalculationRunId(orgId, statement.period_start, statement.period_end, statement.currency, signature)) {
        throw new ConflictError("Calculation inputs changed; prepare and review a fresh statement");
      }
      const [run] = await tx.select().from(royalty_calculation_runs)
        .where(and(eq(royalty_calculation_runs.org_id, orgId), eq(royalty_calculation_runs.id, runId))).for("update");
      if (!run || !["draft", "approved"].includes(run.status)) throw new ConflictError("Calculation run cannot be issued");
      if (run.status === "draft") {
        await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId}, ${issuance.actorId})`);
        await tx.update(royalty_calculation_runs).set({ status: "approved", approved_by: issuance.actorId, approved_at: new Date(), updated_at: new Date() })
          .where(and(eq(royalty_calculation_runs.org_id, orgId), eq(royalty_calculation_runs.id, runId)));
      }
      const transactionId = `statement-issue:${statementId}`;
      await tx.insert(royalty_ledger_transactions).values({
        id: transactionId, org_id: orgId, idempotency_key: transactionId, actor_user_id: issuance.actorId,
        evidence_reference: issuance.reference, effective_date: statement.period_end,
      });
      await tx.insert(royalty_ledger_entries).values({
        id: transactionId, org_id: orgId, transaction_id: transactionId, statement_id: statementId,
        contact_id: statement.contact_id, entry_type: "allocation", amount: statement.earnings_amount,
        currency: statement.currency, effective_date: statement.period_end,
      });
      await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId}, ${issuance.actorId})`);
      await tx.update(royalty_ledger_transactions).set({ posting_status: "posted", posted_at: new Date() })
        .where(and(eq(royalty_ledger_transactions.org_id, orgId), eq(royalty_ledger_transactions.id, transactionId)));
      await tx.execute(sql`select label_suite.establish_royalty_lifecycle_context(${orgId}, ${issuance.actorId})`);
    }
    const [updated] = await tx.update(royalty_statements).set({ status: issuance ? "issued" : "reviewed", ...(issuance ? { issued_at: new Date() } : {}), updated_at: new Date() })
      .where(and(eq(royalty_statements.org_id, orgId), eq(royalty_statements.id, statementId))).returning();
    return updated;
  });
}
