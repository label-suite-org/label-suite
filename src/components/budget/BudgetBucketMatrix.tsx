"use client";

import { formatCoverageMoney } from "../funding/money";
import { computeLineEfc } from "../../server/budget-efc-core";

interface Bucket {
  bucket: string;
  label: string;
  planned: number;
  forecast: number;
  committed: number;
  paid: number;
  remaining: number;
  item_count: number;
  efc: number;
  variance: number;
}

interface Kpi {
  total_planned: number;
  contingency_planned: number;
}

interface Line {
  id: string;
  name: string;
  planned_amount: number | null;
  forecast_amount: number | null;
  committed_amount: number | null;
  paid_amount: number | null;
  lock_status: string | null;
  category_name: string | null;
  category_type: string | null;
}

export default function BudgetBucketMatrix({ buckets, kpi, lines = [], currency = "DKK" }: { buckets: Bucket[]; kpi: Kpi; lines?: Line[]; currency?: string }) {
  const usd = (n: number) => formatCoverageMoney(n, currency);
  const categoryRows = rollupLines(lines);
  const fallbackRows = buckets.map((bucket) => ({
    key: bucket.bucket,
    label: bucket.label,
    group: bucket.bucket,
    planned: bucket.planned,
    forecast: bucket.forecast,
    committed: bucket.committed,
    paid: bucket.paid,
    efc: bucket.efc,
    variance: bucket.variance,
    itemCount: bucket.item_count,
    isLocked: bucket.bucket === "contingency",
  }));
  const rows = categoryRows.length ? categoryRows : fallbackRows;

  const totalPlan = kpi.total_planned;
  const nonContingency = Math.max(totalPlan - kpi.contingency_planned, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Budget by bucket</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Category-level budget, forecast, spend, and remaining control.</p>
        </div>
        <span className="text-xs text-muted-foreground">
          Plan: {usd(totalPlan)} · locked inside plan: {usd(kpi.contingency_planned)} · non-contingency: {usd(nonContingency)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Bucket</th>
              <th className="text-right px-4 py-2">Budget</th>
              <th className="text-right px-4 py-2">Variance</th>
              <th className="text-right px-4 py-2">EFC</th>
              <th className="text-right px-4 py-2">Committed</th>
              <th className="text-right px-4 py-2">Spent</th>
              <th className="text-right px-4 py-2">Forecast</th>
              <th className="text-right px-4 py-2">Remaining</th>
              <th className="text-left px-4 py-2">% Used</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const remaining = row.planned - row.committed;
              const pct = row.planned > 0 ? (row.committed / row.planned) * 100 : 0;
              const forecastOver = row.variance < 0;
              return (
                <tr key={row.key} className={row.isLocked ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${bucketDot(row.group)}`} />
                      <div>
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-muted-foreground">{row.itemCount} line{row.itemCount === 1 ? "" : "s"}</div>
                      </div>
                      {row.isLocked && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-amber-700">locked</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{usd(row.planned)}</td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${row.variance < 0 ? "text-red-600" : "text-emerald-700"}`}>{usd(row.variance)}</td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${row.variance < 0 ? "text-red-600" : "text-foreground"}`}>{usd(row.efc)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{usd(row.committed)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{usd(row.paid)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${forecastOver ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{usd(row.forecast)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{usd(remaining)}</td>
                  <td className="px-4 py-3 min-w-[150px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : pct > 75 ? "bg-amber-500" : "bg-neutral-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function rollupLines(lines: Line[]) {
  const map = new Map<string, {
    key: string;
    label: string;
    group: string;
    planned: number;
    forecast: number;
    committed: number;
    paid: number;
    efc: number;
    variance: number;
    itemCount: number;
    isLocked: boolean;
  }>();

  for (const line of lines) {
    const isLocked = line.lock_status === "locked" || (line.category_type ?? "").includes("contingency");
    const label = isLocked ? "Contingency (locked)" : line.category_name ?? "Uncategorized";
    const group = isLocked ? "contingency" : line.category_type ?? "uncategorized";
    const key = `${group}:${label}`;
    const existing = map.get(key) ?? {
      key,
      label,
      group,
      planned: 0,
      forecast: 0,
      committed: 0,
      paid: 0,
      efc: 0,
      variance: 0,
      itemCount: 0,
      isLocked: false,
    };
    const costs = computeLineEfc(line);
    existing.planned += costs.planned;
    existing.forecast += costs.forecast;
    existing.committed += costs.committed;
    existing.paid += costs.paid;
    existing.efc += costs.efc;
    existing.variance += costs.variance;
    existing.itemCount += 1;
    existing.isLocked ||= isLocked;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.isLocked !== b.isLocked) return a.isLocked ? 1 : -1;
    return b.planned - a.planned;
  });
}

function bucketDot(group: string) {
  if (group.includes("marketing")) return "bg-violet-500";
  if (group.includes("contingency")) return "bg-amber-500";
  if (group.includes("production")) return "bg-sky-500";
  return "bg-neutral-400";
}
