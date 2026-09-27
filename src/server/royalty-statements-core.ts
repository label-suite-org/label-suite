import Decimal from "decimal.js";

const MONEY_SCALE = 8;
const SHARE_SCALE = 6;
const SHARE_TOTAL = new Decimal(100);

export interface StatementEarningInput {
  earningId: string;
  workId: string | null;
  reportPeriod: string | null;
  currency: string;
  netAmount: string;
  title: string | null;
  platform: string | null;
}

export interface StatementSplitInput {
  splitLineId: string;
  contactId: string | null;
  payeeName: string;
  sharePercent: string | number;
}

export interface StatementLinePlan {
  id: string;
  statementKey: string;
  earningId: string;
  splitLineId: string;
  contactId: string;
  currency: string;
  sharePercent: string;
  amount: string;
  description: string;
}

export interface StatementPlan {
  id: string;
  contactId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  lines: StatementLinePlan[];
  earningsAmount: string;
}

export interface StatementBlocker {
  earningId: string;
  reason: "missing_work" | "missing_master_splits" | "unbalanced_master_splits" | "missing_payee";
  detail: string;
}

export interface StatementReconciliation {
  earningId: string;
  sourceAmount: string;
  allocatedAmount: string;
  reconciled: boolean;
}

export interface StatementPreparation {
  plans: StatementPlan[];
  blockers: StatementBlocker[];
  reconciliations: StatementReconciliation[];
  sourceTotal: string;
  allocatedTotal: string;
}

export interface PrepareStatementPlansInput {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  earnings: StatementEarningInput[];
  splitsByWork: Map<string, StatementSplitInput[]>;
}

export function prepareStatementPlans(input: PrepareStatementPlansInput): StatementPreparation {
  const plans = new Map<string, StatementPlan>();
  const blockers: StatementBlocker[] = [];
  const reconciliations: StatementReconciliation[] = [];
  const seenEarnings = new Set<string>();
  let sourceTotal = new Decimal(0);
  let allocatedTotal = new Decimal(0);

  for (const earning of input.earnings) {
    if (seenEarnings.has(earning.earningId)) {
      throw new Error(`Duplicate royalty earning ${earning.earningId}`);
    }
    seenEarnings.add(earning.earningId);

    const sourceAmount = money(earning.netAmount);
    sourceTotal = sourceTotal.plus(sourceAmount);
    const workId = earning.workId;
    if (!workId) {
      blockers.push({ earningId: earning.earningId, reason: "missing_work", detail: "Earning has no canonical work match" });
      continue;
    }

    const splits = input.splitsByWork.get(workId) ?? [];
    if (!splits.length) {
      blockers.push({ earningId: earning.earningId, reason: "missing_master_splits", detail: "No Master rights split lines are available" });
      continue;
    }

    const normalizedSplits = splits.map((split) => ({
      ...split,
      share: share(split.sharePercent),
    }));
    const invalidPayee = normalizedSplits.find((split) => !split.contactId);
    if (invalidPayee) {
      blockers.push({ earningId: earning.earningId, reason: "missing_payee", detail: `Split ${invalidPayee.splitLineId} has no payee contact` });
      continue;
    }

    const shareTotal = normalizedSplits.reduce((total, split) => total.plus(split.share), new Decimal(0));
    if (!shareTotal.eq(SHARE_TOTAL)) {
      blockers.push({
        earningId: earning.earningId,
        reason: "unbalanced_master_splits",
        detail: `Master splits total ${shareTotal.toFixed(SHARE_SCALE)}%, expected 100.000000%`,
      });
      continue;
    }

    const allocations = allocate(sourceAmount, normalizedSplits.map((split) => ({
      splitLineId: split.splitLineId,
      share: split.share,
    })));
    const allocatedAmount = allocations.reduce((total, allocation) => total.plus(allocation.amount), new Decimal(0));
    allocatedTotal = allocatedTotal.plus(allocatedAmount);
    const sourceAmountString = formatMoney(sourceAmount);
    const allocatedAmountString = formatMoney(allocatedAmount);
    reconciliations.push({
      earningId: earning.earningId,
      sourceAmount: sourceAmountString,
      allocatedAmount: allocatedAmountString,
      reconciled: sourceAmount.eq(allocatedAmount),
    });

    for (const allocation of allocations) {
      const split = normalizedSplits.find((candidate) => candidate.splitLineId === allocation.splitLineId)!;
      const contactId = split.contactId!;
      const statementKey = `${contactId}:${earning.currency}`;
      const existing = plans.get(statementKey) ?? {
        id: buildStatementId(input.orgId, contactId, input.periodStart, input.periodEnd, earning.currency),
        contactId,
        currency: earning.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        lines: [],
        earningsAmount: "0.00000000",
      } satisfies StatementPlan;
      existing.lines.push({
        id: buildStatementLineId(existing.id, earning.earningId, allocation.splitLineId),
        statementKey,
        earningId: earning.earningId,
        splitLineId: allocation.splitLineId,
        contactId,
        currency: earning.currency,
        sharePercent: split.share.toFixed(SHARE_SCALE),
        amount: formatMoney(allocation.amount),
        description: [earning.reportPeriod, earning.title, earning.platform].filter(Boolean).join(" · ") || "Royalty earning",
      });
      existing.earningsAmount = formatMoney(
        existing.lines.reduce((total, line) => total.plus(line.amount), new Decimal(0)),
      );
      plans.set(statementKey, existing);
    }
  }

  return {
    plans: [...plans.values()].sort((left, right) => left.id.localeCompare(right.id)),
    blockers,
    reconciliations,
    sourceTotal: formatMoney(sourceTotal),
    allocatedTotal: formatMoney(allocatedTotal),
  };
}

export function buildStatementId(orgId: string, contactId: string, periodStart: string, periodEnd: string, currency: string): string {
  return `royalty_statement_${stableHash(`${orgId}:${contactId}:${periodStart}:${periodEnd}:${currency}`).slice(0, 24)}`;
}

export function buildStatementLineId(statementId: string, earningId: string, splitLineId: string): string {
  return `royalty_statement_line_${stableHash(`${statementId}:${earningId}:${splitLineId}`).slice(0, 24)}`;
}

export function buildSplitSnapshotId(orgId: string, workId: string, periodStart: string, periodEnd: string, roleSignature: string): string {
  return `royalty_split_snapshot_${stableHash(`${orgId}:${workId}:${periodStart}:${periodEnd}:${roleSignature}`).slice(0, 24)}`;
}

export function buildSplitLineId(snapshotId: string, roleId: string): string {
  return `royalty_split_line_${stableHash(`${snapshotId}:${roleId}`).slice(0, 24)}`;
}

export function buildCalculationRunId(orgId: string, periodStart: string, periodEnd: string, currency: string, sourceSignature: string): string {
  return `royalty_calculation_${stableHash(`${orgId}:${periodStart}:${periodEnd}:${currency}:${sourceSignature}`).slice(0, 24)}`;
}

function allocate(amount: Decimal, splits: Array<{ splitLineId: string; share: Decimal }>): Array<{ splitLineId: string; amount: Decimal }> {
  const allocations = splits.map((split) => ({ splitLineId: split.splitLineId, amount: amount.mul(split.share).div(SHARE_TOTAL).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN) }));
  const allocated = allocations.reduce((total, allocation) => total.plus(allocation.amount), new Decimal(0));
  const residual = amount.minus(allocated);
  if (!residual.isZero() && allocations[0]) allocations[0].amount = allocations[0].amount.plus(residual);
  return allocations;
}

function money(value: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error("Royalty amount must be finite");
  if (decimal.decimalPlaces() > MONEY_SCALE) throw new Error("Royalty amount exceeds eight decimal places");
  return decimal;
}

function share(value: string | number): Decimal {
  const decimal = new Decimal(String(value));
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("Royalty split percentage must be non-negative");
  if (decimal.decimalPlaces() > SHARE_SCALE) throw new Error("Royalty split percentage exceeds six decimal places");
  return decimal;
}

function formatMoney(value: Decimal): string {
  return value.toFixed(MONEY_SCALE);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}
