"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RoyaltiesMonthlyPoint, RoyaltiesTimeseriesResult } from "../../server/analytics-extra";

import { Button } from "@/components/ui/button";
const METRICS = [
  { key: "net" as const, label: "Net revenue", color: "var(--chart-1)" },
  { key: "gross" as const, label: "Gross revenue", color: "var(--chart-2)" },
];

export default function RoyaltiesTimeseries({ data }: { data: RoyaltiesTimeseriesResult }) {
  const [metric, setMetric] = useState<"net" | "gross">("net");

  const points = useMemo(() => data.points.slice(-24), [data.points]);
  const chartData = useMemo(
    () => points.map((point: RoyaltiesMonthlyPoint) => ({
      month: point.month,
      value: metric === "net" ? point.net : point.gross,
    })),
    [points, metric],
  );

  if (chartData.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Royalties over time</h2>
            <p className="text-sm text-muted-foreground">Monthly net revenue by month.</p>
          </div>
        </header>
        <div className="mt-6 p-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
          No royalty rows with a usable date yet.
        </div>
      </section>
    );
  }

  const total = metric === "net" ? data.totals.net : data.totals.gross;
  const lastPoint = chartData[chartData.length - 1];
  const prevPoint = chartData.length >= 2 ? chartData[chartData.length - 2] : null;
  const deltaPct = prevPoint && prevPoint.value !== 0
    ? ((lastPoint.value - prevPoint.value) / Math.abs(prevPoint.value)) * 100
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Royalties over time</h2>
          <p className="text-sm text-muted-foreground">Monthly {metric === "net" ? "net" : "gross"} revenue across all sources.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {METRICS.map((m) => (
            <Button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1.5 ${metric === m.key ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiBlock label={`Total ${metric === "net" ? "net" : "gross"}`} value={formatCurrency(total)} />
        <KpiBlock label="Months tracked" value={String(data.totals.monthCount)} />
        <KpiBlock label="Records" value={data.totals.count.toLocaleString()} />
        <KpiBlock
          label="Last month vs prev"
          value={deltaPct === null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
          tone={deltaPct === null ? "neutral" : deltaPct >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="h-72 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => formatCurrencyCompact(value)}
              width={60}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                fontSize: "12px",
              }}
              formatter={(value, name) => {
                const numeric = typeof value === "number" ? value : Number(value);
                return [formatCurrency(numeric), metric === "net" ? "Net" : "Gross"];
              }}
            />
            <Bar dataKey="value" fill={METRICS.find((m) => m.key === metric)!.color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function KpiBlock({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const toneClass = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "";
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatCurrencyCompact(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}