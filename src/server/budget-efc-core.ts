export type BudgetCostRow = {
  categoryType?: string | null;
  lockStatus?: string | null;
  planned_amount?: number | string | null;
  amount?: number | string | null;
  forecast_amount?: number | string | null;
  committed_amount?: number | string | null;
  paid_amount?: number | string | null;
};

export type BudgetLineCost = { planned: number; forecast: number; committed: number; paid: number; efc: number; variance: number };
export type BudgetCostRollup = BudgetLineCost & { buckets: Record<"production" | "marketing" | "contingency", BudgetLineCost> };

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeLineEfc(line: BudgetCostRow): BudgetLineCost {
  const planned = amount(line.planned_amount ?? line.amount);
  const committed = amount(line.committed_amount);
  const paid = amount(line.paid_amount);
  const forecast = amount(line.forecast_amount ?? planned);
  const efc = paid + committed + Math.max(0, forecast - committed - paid);
  return { planned, forecast, committed, paid, efc, variance: planned - efc };
}

export function classifyBudgetBucket(line: Pick<BudgetCostRow, "categoryType" | "lockStatus">): "production" | "marketing" | "contingency" {
  if (line.lockStatus === "locked") return "contingency";
  if (String(line.categoryType ?? "").includes("marketing")) return "marketing";
  return "production";
}

function emptyCosts(): BudgetLineCost {
  return { planned: 0, forecast: 0, committed: 0, paid: 0, efc: 0, variance: 0 };
}

export function rollupBudgetCosts(lines: BudgetCostRow[]): BudgetCostRollup {
  const buckets = { production: emptyCosts(), marketing: emptyCosts(), contingency: emptyCosts() };
  const total = emptyCosts();
  for (const line of lines) {
    const costs = computeLineEfc(line);
    for (const key of Object.keys(total) as Array<keyof BudgetLineCost>) total[key] += costs[key];
    const bucket = buckets[classifyBudgetBucket(line)];
    for (const key of Object.keys(bucket) as Array<keyof BudgetLineCost>) bucket[key] += costs[key];
  }
  return { ...total, buckets };
}
