"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CampaignStatusBreakdown } from "../../server/analytics-extra";

const STATUS_COLORS: Record<string, string> = {
  planning: "#a3a3a3",
  active: "#22c55e",
  paused: "#f59e0b",
  completed: "#3b82f6",
  archived: "#6b7280",
};

export default function CampaignBreakdown({ rows }: { rows: CampaignStatusBreakdown[] }) {
  const totalCampaigns = rows.reduce((acc, row) => acc + row.count, 0);
  const totalBudget = rows.reduce((acc, row) => acc + row.totalBudgetPlanned, 0);
  const totalActual = rows.reduce((acc, row) => acc + row.totalBudgetActual, 0);
  const burnPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;

  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
        <header>
          <h2 className="text-lg font-semibold tracking-tight">Campaign pipeline</h2>
          <p className="text-sm text-muted-foreground">Status distribution and budget burn across all campaigns.</p>
        </header>
        <p className="p-6 text-center text-muted-foreground border border-dashed border-border rounded-xl">
          No campaigns yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Campaign pipeline</h2>
        <p className="text-sm text-muted-foreground">Status distribution and budget burn across all campaigns.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total campaigns" value={totalCampaigns.toLocaleString()} />
        <Stat label="Planned budget" value={formatCurrency(totalBudget)} />
        <Stat label="Actual spend" value={formatCurrency(totalActual)} />
        <Stat
          label="Budget burn"
          value={`${burnPct.toFixed(1)}%`}
          tone={burnPct > 100 ? "negative" : burnPct > 90 ? "warn" : "neutral"}
        />
      </div>

      <div className="h-56 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="status" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={32} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                fontSize: "12px",
              }}
              formatter={(value, name) => [value as number, name === "count" ? "Campaigns" : String(name)]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell key={row.status} fill={STATUS_COLORS[row.status] ?? "#a3a3a3"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="text-sm divide-y divide-border rounded-xl border border-border overflow-hidden">
        {rows.map((row) => {
          const burn = row.totalBudgetPlanned > 0 ? (row.totalBudgetActual / row.totalBudgetPlanned) * 100 : null;
          return (
            <li key={row.status} className="px-3 py-2 flex items-center gap-3">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[row.status] ?? "#a3a3a3" }}
                aria-hidden
              />
              <span className="capitalize font-medium w-24 truncate">{row.status}</span>
              <span className="tabular-nums text-muted-foreground w-12 text-right">{row.count}</span>
              <span className="flex-1 text-right text-xs text-muted-foreground tabular-nums">
                {formatCurrency(row.totalBudgetActual)} / {formatCurrency(row.totalBudgetPlanned)}
              </span>
              {burn !== null && (
                <span
                  className={`tabular-nums text-xs font-semibold w-14 text-right ${
                    burn > 100 ? "text-red-600" : burn > 90 ? "text-amber-600" : "text-emerald-600"
                  }`}
                >
                  {burn.toFixed(0)}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "warn" | "neutral" }) {
  const toneClass = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}