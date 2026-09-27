"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { X } from "lucide-react";
import { formatCoverageMoney } from "../funding/money";

import { Button } from "@/components/ui/button";
const usd = (n: number, currency = "DKK") => formatCoverageMoney(n, currency);

interface Phase {
  phase: string;
  label: string;
  month: string;
  planned: number;
  committed: number;
  paid: number;
}

interface CalendarMonth {
  month: string;
  label: string;
  planned: number;
  committed: number;
  paid: number;
}

interface FundingSource {
  amount_confirmed: number | null;
  amount_planned: number | null;
  status: string;
}

type ViewMode = "cumulative" | "incremental";

const total = (items: { planned: number }[]) => items.reduce((s, i) => s + i.planned, 0);

interface Props {
  phases: Phase[];
  calendarMonths?: CalendarMonth[];
  funding?: FundingSource[];
  currency?: string;
}

export default function CashflowTimeline({ phases, calendarMonths, funding = [], currency = "DKK" }: Props) {
  const usd = (n: number) => formatCoverageMoney(n, currency);
  const [viewMode, setViewMode] = useState<ViewMode>("incremental");
  const [showTable, setShowTable] = useState(false);
  const [showPhases, setShowPhases] = useState(false);

  const chartData = useMemo(() => {
    const source = (showPhases || !calendarMonths?.length) ? phases : calendarMonths;

    if (viewMode === "cumulative") {
      let plannedCum = 0;
      let committedCum = 0;
      let paidCum = 0;
      return source.map((item) => {
        plannedCum += item.planned;
        committedCum += item.committed;
        paidCum += item.paid;
        return { label: "label" in item ? item.label : (item as CalendarMonth).label, Planned: plannedCum, Committed: committedCum, Paid: paidCum };
      });
    }

    return source.map((item) => ({
      label: "label" in item ? item.label : (item as CalendarMonth).label,
      Planned: item.planned,
      Committed: item.committed,
      Paid: item.paid,
    }));
  }, [phases, calendarMonths, viewMode, showPhases]);

  const useCalendar = calendarMonths && calendarMonths.length > 0;
  const activeData = useCalendar ? calendarMonths : phases;
  const grand = total(activeData);
  const confirmedFunding = funding.reduce((sum, source) => sum + (["confirmed", "granted"].includes(source.status) ? source.amount_confirmed ?? 0 : 0), 0);

  // No calendar data yet — collapsed state
  if (!useCalendar) {
    return (
      <section className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Cashflow</h3>
          <p className="text-xs text-muted-foreground mt-0.5">No calendar-month data yet. Set spend_month on budget lines to populate.</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span><span className="text-muted-foreground">Phase plan</span> <strong>{usd(grand)}</strong></span>
          {confirmedFunding > 0 && <span><span className="text-muted-foreground">Confirmed funding</span> <strong>{usd(confirmedFunding)}</strong></span>}
          <Button onClick={() => setShowPhases(true)} className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted">
            Show phase chart
          </Button>
        </div>
        {showPhases && <ChartCard chartData={chartData} phases={phases} viewMode={viewMode} setViewMode={setViewMode} showTable={showTable} setShowTable={setShowTable} onClose={() => setShowPhases(false)} variant="phase" />}
      </section>
    );
  }

  // Calendar data is present — show chart immediately
  const source = showPhases ? phases : calendarMonths;

  return (
    <div className="space-y-3">
      <ChartCard
        chartData={chartData}
        phases={source}
        viewMode={viewMode}
        setViewMode={setViewMode}
        showTable={showTable}
        setShowTable={setShowTable}
        variant={showPhases ? "phase" : "calendar"}
        onToggle={() => setShowPhases(!showPhases)}
        confirmedFunding={confirmedFunding}
      />
    </div>
  );
}

function ChartCard({
  chartData,
  phases,
  viewMode,
  setViewMode,
  showTable,
  setShowTable,
  variant,
  onClose,
  onToggle,
  confirmedFunding = 0,
}: {
  chartData: any[];
  phases: { label: string; planned: number; committed: number; paid: number }[];
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  showTable: boolean;
  setShowTable: (v: boolean) => void;
  variant: "calendar" | "phase";
  onClose?: () => void;
  onToggle?: () => void;
  confirmedFunding?: number;
}) {
  const displayGrand = total(phases);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Cashflow</h3>
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
            {variant === "calendar" ? "Calendar months" : "Phase buckets"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onToggle && (
            <Button variant="outline"
              onClick={onToggle}
              className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
            >
              {variant === "calendar" ? "Phase view" : "Calendar view"}
            </Button>
          )}
          <span className="text-xs text-muted-foreground">View:</span>
          {(["incremental", "cumulative"] as const).map((opt) => (
            <Button
              key={opt}
              onClick={() => setViewMode(opt)}
              className={`px-2 py-1 text-xs rounded border ${
                viewMode === opt
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border hover:bg-muted"
              }`}
            >
              {opt === "incremental" ? "Monthly" : "Cumulative"}
            </Button>
          ))}
          <span className="text-muted-foreground mx-1">|</span>
          <Button
            onClick={() => setShowTable(!showTable)}
            className={`px-2 py-1 text-xs rounded border ${
              showTable
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border hover:bg-muted"
            }`}
          >
            {showTable ? "Chart" : "Table"}
          </Button>
          {onClose && (
            <Button variant="outline" onClick={onClose} className="ml-2 px-2 py-1 text-xs rounded border border-border hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Outflow: <strong>{usd(displayGrand)}</strong>
          {confirmedFunding > 0 ? <> · confirmed inflow <strong>{usd(confirmedFunding)}</strong></> : null}
        </span>
      </div>

      {showTable ? (
        <Table phases={phases} />
      ) : (
        <div className="p-4">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: any) => usd(value)}
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: "12px",
                }}
              />
              <Legend />
              <Line
                type="linear"
                dataKey="Planned"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="linear"
                dataKey="Committed"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="linear"
                dataKey="Paid"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Table({ phases }: { phases: { label: string; planned: number; committed: number; paid: number }[] }) {
  const max = Math.max(...phases.map((p) => p.planned), 1);
  const grand = total(phases);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2">Month</th>
            <th className="text-right px-4 py-2">Planned</th>
            <th className="text-right px-4 py-2">Committed</th>
            <th className="text-right px-4 py-2">Paid</th>
            <th className="text-left px-4 py-2 min-w-[200px]">Distribution</th>
            <th className="text-right px-4 py-2">%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {phases.map((p, i) => {
            const pct = (p.planned / max) * 100;
            const totalPct = grand > 0 ? (p.planned / grand) * 100 : 0;
            return (
              <tr key={i}>
                <td className="px-4 py-3 font-medium">{p.label}</td>
                <td className="px-4 py-3 text-right font-mono">{usd(p.planned)}</td>
                <td className="px-4 py-3 text-right font-mono">{usd(p.committed)}</td>
                <td className="px-4 py-3 text-right font-mono">{usd(p.paid)}</td>
                <td className="px-4 py-3">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground text-xs">{totalPct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
