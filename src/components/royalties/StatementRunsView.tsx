"use client";

import type { RoyaltiesDashboard } from "../../server/royalties-dashboard-core";

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusTone(status: RoyaltiesDashboard["statementRuns"][number]["status"]): string {
  switch (status) {
    case "paid":
      return "text-emerald-600";
    case "ready":
      return "text-emerald-600";
    case "blocked":
    default:
      return "text-red-600";
  }
}

function statusLabel(status: RoyaltiesDashboard["statementRuns"][number]["status"]): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "ready":
      return "Ready";
    case "blocked":
    default:
      return "Blocked";
  }
}

export function StatementRunsView({ dashboard }: { dashboard: RoyaltiesDashboard }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Statement Runs</h2>
        <p className="text-sm text-[var(--muted-foreground)]">Derived from existing statement IDs — no extra ledger table yet.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)] font-normal">
              <th className="text-left px-4 py-2.5">Statement</th>
              <th className="text-left px-4 py-2.5">Period range</th>
              <th className="text-right px-4 py-2.5">Rows</th>
              <th className="text-right px-4 py-2.5">Imported</th>
              <th className="text-right px-4 py-2.5">Payable preview</th>
              <th className="text-right px-4 py-2.5">Blocked</th>
              <th className="text-left px-4 py-2.5">Quality</th>
              <th className="text-left px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
            {dashboard.statementRuns.map((run) => (
              <tr key={run.statementId}>
                <td className="px-4 py-3">
                  <div className="font-medium">{run.statementId}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{run.source}</div>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {run.firstPeriod && run.lastPeriod ? `${run.firstPeriod} → ${run.lastPeriod}` : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{run.rows}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(run.net)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(run.payablePreviewNet)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(run.blockedNet)}</td>
                <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  <div>Works {run.workMatchedRows}/{run.rows}</div>
                  <div>Tracks {run.trackMatchedRows}/{run.rows}</div>
                  <div>Mechanical {run.mechanicalRows} / {formatMoney(run.mechanicalNet)}</div>
                </td>
                <td className={`px-4 py-3 text-sm font-medium ${statusTone(run.status)}`}>
                  {statusLabel(run.status)}
                  {run.splitIssueCount > 0 && (
                    <div className="text-xs text-[var(--muted-foreground)] mt-1">{run.splitIssueCount} split issue{run.splitIssueCount === 1 ? "" : "s"}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
