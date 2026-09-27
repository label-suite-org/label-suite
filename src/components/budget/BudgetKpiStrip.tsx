"use client";
import { formatCoverageMoney } from "../funding/money";
import type { ProjectFundingCoverage } from "../../server/funding-coverage-core";

export interface BudgetIncomeSource {
  type: string; status: string; amount_planned: number | null; amount_confirmed: number | null;
}
export function expectedProjectIncome(sources: BudgetIncomeSource[]) {
  return sources.filter(source => source.type !== "grant" && !["rejected", "cancelled"].includes(source.status))
    .reduce((total, source) => total + (["confirmed", "granted"].includes(source.status) ? source.amount_confirmed ?? source.amount_planned ?? 0 : source.amount_planned ?? 0), 0);
}

export default function BudgetKpiStrip({ kpi, coverage, sources = [], currency = "DKK" }: {
  kpi: { total_planned: number; confirmed_funding: number; paid_total: number };
  coverage?: ProjectFundingCoverage | null;
  sources?: BudgetIncomeSource[];
  currency?: string;
}) {
  const money = (n: number) => formatCoverageMoney(n, currency);
  return <section aria-label="Project money overview" className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { label: "Planned spending", value: money(coverage?.budgetTotal ?? kpi.total_planned), note: "Includes purchases; grant eligibility is separate" },
        { label: "Expected income", value: money(expectedProjectIncome(sources)), note: "Income forecast, excluding grants; receipt not verified" },
        { label: "Recorded payments", value: money(kpi.paid_total), note: kpi.paid_total === 0 ? "No payments linked here yet" : "Payments recorded against project expenses" },
      ].map(card => <div key={card.label} className="min-w-0 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{card.label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{card.note}</p>
      </div>)}
    </div>
    <p className="text-sm text-muted-foreground"><strong>Cash received and available: not reconciled.</strong> This is a project plan, not your bank balance. Match bank receipts, payments and grant restrictions before using a cash balance.</p>
    {(coverage?.excludedCurrencyCount ?? 0) > 0 && <p className="text-xs text-muted-foreground">{coverage!.excludedCurrencyCount} grant amount(s) in another currency are kept separate; no conversion has been assumed.</p>}
  </section>;
}
