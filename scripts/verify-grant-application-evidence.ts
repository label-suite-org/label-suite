import { and, eq, isNull } from "drizzle-orm";
import { grant_applications, grants } from "../src/db/schema";
import { db } from "../src/lib/db";
import { buildMxdExpenseFollowUpPlan, buildMxdExpenseFollowUpUpdate, canApplyMxdExpenseFollowUp, MXD_NEXT_ACTION, type MxdApplicationCandidate } from "../src/server/grant-application-evidence-core";

const APPLY = process.argv.includes("--apply");

export async function loadMxdApplicationCandidates(orgId: string): Promise<MxdApplicationCandidate[]> {
  const rows = await db.select({
    id: grant_applications.id,
    grantId: grant_applications.grant_id,
    grantName: grants.name,
    funder: grants.funder,
    currency: grants.currency,
    outcome: grant_applications.outcome,
    amountAwarded: grant_applications.amount_awarded,
    amountRequested: grant_applications.amount_requested,
    submittedAt: grant_applications.submitted_at,
    decisionDate: grant_applications.decision_date,
    nextActionDue: grant_applications.next_action_due,
    reportingDue: grant_applications.reporting_due,
    nextAction: grant_applications.next_action,
  }).from(grant_applications).leftJoin(grants, and(
    eq(grant_applications.grant_id, grants.id), eq(grants.org_id, orgId),
  )).where(eq(grant_applications.org_id, orgId));
  return rows.map((row) => ({ ...row, amountAwarded: row.amountAwarded == null ? null : Number(row.amountAwarded) }));
}

export async function verifyGrantApplicationEvidence(orgId: string, apply = APPLY) {
  const plan = buildMxdExpenseFollowUpPlan(await loadMxdApplicationCandidates(orgId));
  if (plan.status !== "update" || !apply) return { applied: false, plan, before: plan.status === "update" ? plan.application : null, after: null };
  return db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: grant_applications.id, grantId: grant_applications.grant_id, grantName: grants.name, funder: grants.funder,
      currency: grants.currency, outcome: grant_applications.outcome, amountAwarded: grant_applications.amount_awarded,
      amountRequested: grant_applications.amount_requested, submittedAt: grant_applications.submitted_at,
      decisionDate: grant_applications.decision_date, nextActionDue: grant_applications.next_action_due,
      reportingDue: grant_applications.reporting_due, nextAction: grant_applications.next_action,
    }).from(grant_applications).leftJoin(grants, and(eq(grant_applications.grant_id, grants.id), eq(grants.org_id, orgId)))
      .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, plan.application.id))).limit(1);
    if (!current || !canApplyMxdExpenseFollowUp(plan, current)) return { applied: false, stale: true, plan, before: plan.application, after: current ?? null };
    const update = buildMxdExpenseFollowUpUpdate(current);
    if (!update) return { applied: false, stale: true, plan, before: plan.application, after: current };
    const updated = await tx.update(grant_applications).set({ ...update, updated_at: new Date() }).where(and(
      eq(grant_applications.org_id, orgId), eq(grant_applications.id, current.id), eq(grant_applications.grant_id, current.grantId!),
      eq(grant_applications.outcome, "approved"), eq(grant_applications.amount_awarded, 7500), isNull(grant_applications.next_action),
    )).returning({ id: grant_applications.id });
    const after = { ...current, nextAction: updated.length === 1 ? MXD_NEXT_ACTION : current.nextAction };
    return { applied: updated.length === 1, plan, before: plan.application, after };
  });
}

async function main() {
  const orgId = process.env.LABEL_SUITE_ORG_ID ?? "true-nature";
  const result = await verifyGrantApplicationEvidence(orgId, APPLY);
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", ...result }, null, 2));
  if (result.plan.status === "ambiguous" || result.plan.status === "not_found") process.exitCode = 2;
}

if (process.argv[1]?.endsWith("verify-grant-application-evidence.ts")) void main().catch((error) => { console.error(error); process.exitCode = 1; });
