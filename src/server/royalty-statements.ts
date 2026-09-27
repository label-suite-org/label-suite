import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  contacts,
  roles,
  royalty_calculation_runs,
  royalty_earnings,
  royalty_split_lines,
  royalty_split_snapshots,
  royalty_statement_lines,
  royalty_statements,
} from "../db/schema";
import { db } from "../lib/db";
import {
  buildCalculationRunId,
  buildSplitLineId,
  buildSplitSnapshotId,
  prepareStatementPlans,
  type StatementBlocker,
} from "./royalty-statements-core";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const prepareRoyaltyStatementsSchema = z.object({
  period_start: z.string().regex(datePattern, "period_start must be YYYY-MM-DD"),
  period_end: z.string().regex(datePattern, "period_end must be YYYY-MM-DD"),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("USD"),
}).superRefine((value, context) => {
  if (value.period_start > value.period_end) {
    context.addIssue({ code: "custom", path: ["period_end"], message: "period_end must not precede period_start" });
  }
});

export type PrepareRoyaltyStatementsInput = z.infer<typeof prepareRoyaltyStatementsSchema>;

export interface PreparedRoyaltyStatements {
  calculationRunId: string;
  plans: Array<{
    id: string;
    contactId: string;
    currency: string;
    periodStart: string;
    periodEnd: string;
    lineCount: number;
    earningsAmount: string;
    status: "calculated" | "protected";
  }>;
  blockers: StatementBlocker[];
  protectedStatements: string[];
  reconciliations: Array<{ earningId: string; sourceAmount: string; allocatedAmount: string; reconciled: boolean }>;
  sourceTotal: string;
  allocatedTotal: string;
}

export async function prepareRoyaltyStatements(orgId: string, input: PrepareRoyaltyStatementsInput): Promise<PreparedRoyaltyStatements> {
  const periodStartMonth = input.period_start.slice(0, 7);
  const periodEndMonth = input.period_end.slice(0, 7);

  return db.transaction(async (tx) => {
    const earningRows = await tx
      .select({
        id: royalty_earnings.id,
        workId: royalty_earnings.work_id,
        reportPeriod: royalty_earnings.report_period,
        currency: royalty_earnings.currency,
        netAmount: royalty_earnings.net_amount,
        title: royalty_earnings.track_title,
        platform: royalty_earnings.platform,
      })
      .from(royalty_earnings)
      .where(and(
        eq(royalty_earnings.org_id, orgId),
        eq(royalty_earnings.currency, input.currency),
        gte(royalty_earnings.report_period, periodStartMonth),
        lte(royalty_earnings.report_period, periodEndMonth),
        isNotNull(royalty_earnings.report_period),
      ));

    const workIds = [...new Set(earningRows.map((row) => row.workId).filter((id): id is string => Boolean(id)))];
    const roleRows = workIds.length
      ? await tx
        .select({
          id: roles.id,
          workId: roles.work_id,
          contactId: roles.contact_id,
          payeeName: contacts.name,
          sharePercent: roles.percent_share,
        })
        .from(roles)
        .leftJoin(contacts, and(eq(contacts.id, roles.contact_id), eq(contacts.org_id, orgId)))
        .where(and(
          eq(roles.org_id, orgId),
          inArray(roles.work_id, workIds),
          eq(roles.scope, "Master"),
          eq(roles.ownership_type, "Rights"),
          isNotNull(roles.percent_share),
        ))
      : [];

    const roleSignature = roleRows
      .map((row) => [row.id, row.workId, row.contactId, row.sharePercent, row.payeeName])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const sourceSignature = JSON.stringify({
      earnings: earningRows.map((row) => [row.id, row.workId, row.reportPeriod, row.currency, row.netAmount]).sort(),
      roles: roleSignature,
    });
    const calculationRunId = buildCalculationRunId(orgId, input.period_start, input.period_end, input.currency, sourceSignature);
    await tx.insert(royalty_calculation_runs).values({
      id: calculationRunId,
      org_id: orgId,
      engine_version: "royalty-statements-v1",
      status: "draft",
      idempotency_key: `${calculationRunId}:draft`,
    }).onConflictDoNothing();

    const splitsByWork = new Map<string, Array<{ splitLineId: string; contactId: string | null; payeeName: string; sharePercent: string | number }>>();
    for (const workId of workIds) {
      const workRoles = roleRows.filter((row) => row.workId === workId);
      if (!workRoles.length) continue;
      const workSignature = JSON.stringify(workRoles.map((row) => [row.id, row.contactId, row.sharePercent, row.payeeName]).sort());
      const snapshotId = buildSplitSnapshotId(orgId, workId, input.period_start, input.period_end, workSignature);
      await tx.insert(royalty_split_snapshots).values({
        id: snapshotId,
        org_id: orgId,
        work_id: workId,
        effective_from: input.period_start,
        effective_to: input.period_end,
        status: "active",
        source: "royalty-statements-v1",
      }).onConflictDoNothing();

      const splits = workRoles.map((row) => ({
        splitLineId: buildSplitLineId(snapshotId, row.id),
        contactId: row.contactId,
        payeeName: row.payeeName ?? "",
        sharePercent: row.sharePercent ?? "0",
      }));
      for (let index = 0; index < workRoles.length; index += 1) {
        const row = workRoles[index]!;
        const split = splits[index]!;
        await tx.insert(royalty_split_lines).values({
          id: split.splitLineId,
          org_id: orgId,
          snapshot_id: snapshotId,
          contact_id: row.contactId,
          role_id: row.id,
          payee_name: split.payeeName,
          scope: "Master",
          share_percent: String(split.sharePercent),
        }).onConflictDoNothing();
      }
      splitsByWork.set(workId, splits);
    }

    const preparation = prepareStatementPlans({
      orgId,
      periodStart: input.period_start,
      periodEnd: input.period_end,
      earnings: earningRows.map((row) => ({
        earningId: row.id,
        workId: row.workId,
        reportPeriod: row.reportPeriod,
        currency: row.currency,
        netAmount: String(row.netAmount),
        title: row.title,
        platform: row.platform,
      })),
      splitsByWork,
    });

    const protectedStatements: string[] = [];
    const plans: PreparedRoyaltyStatements["plans"] = [];
    for (const plan of preparation.plans) {
      const existing = await tx
        .select({ status: royalty_statements.status })
        .from(royalty_statements)
        .where(and(eq(royalty_statements.id, plan.id), eq(royalty_statements.org_id, orgId)))
        .limit(1);
      if (existing[0] && existing[0].status !== "draft") {
        protectedStatements.push(plan.id);
        plans.push({ ...plan, lineCount: plan.lines.length, status: "protected" });
        continue;
      }

      await tx.insert(royalty_statements).values({
        id: plan.id,
        org_id: orgId,
        contact_id: plan.contactId,
        period_start: plan.periodStart,
        period_end: plan.periodEnd,
        currency: plan.currency,
        status: "draft",
        opening_balance: "0.00000000",
        earnings_amount: "0.00000000",
        adjustments_amount: "0.00000000",
        payout_amount: "0.00000000",
        closing_balance: "0.00000000",
        notes: `Calculation run ${calculationRunId}`,
      }).onConflictDoNothing();

      await tx.delete(royalty_statement_lines).where(and(
        eq(royalty_statement_lines.statement_id, plan.id),
        eq(royalty_statement_lines.org_id, orgId),
      ));
      for (let index = 0; index < plan.lines.length; index += 200) {
        const batch = plan.lines.slice(index, index + 200).map((line) => ({
          id: line.id,
          org_id: orgId,
          statement_id: plan.id,
          earning_id: line.earningId,
          split_line_id: line.splitLineId,
          line_type: "earning",
          description: line.description,
          share_percent: line.sharePercent,
          amount: line.amount,
        }));
        if (batch.length) await tx.insert(royalty_statement_lines).values(batch).onConflictDoNothing();
      }
      await tx.update(royalty_statements).set({
        status: "calculated",
        earnings_amount: plan.earningsAmount,
        closing_balance: plan.earningsAmount,
        notes: `Calculation run ${calculationRunId}`,
        updated_at: new Date(),
      }).where(and(eq(royalty_statements.id, plan.id), eq(royalty_statements.org_id, orgId)));
      plans.push({ ...plan, lineCount: plan.lines.length, status: "calculated" });
    }

    return {
      calculationRunId,
      plans,
      blockers: preparation.blockers,
      protectedStatements,
      reconciliations: preparation.reconciliations,
      sourceTotal: preparation.sourceTotal,
      allocatedTotal: preparation.allocatedTotal,
    };
  });
}
