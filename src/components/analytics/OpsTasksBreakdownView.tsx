"use client";

import type { OpsTasksBreakdown } from "../../server/analytics-extra";

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  P1: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  P2: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  P3: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  P4: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export default function OpsTasksBreakdownView({ data }: { data: OpsTasksBreakdown }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Ops tasks health</h2>
          <p className="text-sm text-muted-foreground">Open workload and overdue exposure by priority.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Open</span>
          <span className="font-semibold tabular-nums">{data.totalOpen}</span>
          {data.totalOverdue > 0 && (
            <>
              <span className="text-muted-foreground">Overdue</span>
              <span className="font-semibold tabular-nums text-red-600">{data.totalOverdue}</span>
            </>
          )}
        </div>
      </header>

      {!data.byPriority.length ? (
        <p className="p-6 text-center text-muted-foreground border border-dashed border-border rounded-xl">
          No ops tasks tracked yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">By priority</h3>
            <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {data.byPriority.map((row) => {
                const max = Math.max(row.open + row.done, 1);
                const openPct = (row.open / max) * 100;
                const overduePct = row.open > 0 ? (row.overdue / row.open) * 100 : 0;
                return (
                  <li key={row.priority} className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-semibold ${
                          PRIORITY_COLORS[row.priority] ?? PRIORITY_COLORS.P2
                        }`}
                      >
                        {row.priority}
                      </span>
                      <span className="tabular-nums text-sm w-10 text-right">{row.open}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.max(openPct, 2)}%` }} />
                      </div>
                      <span className="tabular-nums text-xs text-muted-foreground w-10 text-right">{row.done} done</span>
                    </div>
                    {row.overdue > 0 && (
                      <p className="mt-1 ml-13 text-xs text-red-600 tabular-nums">
                        {row.overdue} overdue · {overduePct.toFixed(0)}% of open
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">By status</h3>
            <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {data.byStatus.map((row) => (
                <li key={row.status} className="px-3 py-2 flex items-center gap-3">
                  <span className="font-medium text-sm w-28 truncate">{STATUS_LABELS[row.status] ?? row.status}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${row.status === "done" ? "bg-emerald-500" : row.status === "blocked" ? "bg-red-500" : "bg-primary"}`}
                      style={{ width: `${pct(data.byStatus.map((r) => r.count), row.count)}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-sm font-semibold w-10 text-right">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function pct(values: number[], current: number): number {
  const max = Math.max(...values, 1);
  return (current / max) * 100;
}