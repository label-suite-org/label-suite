"use client";

import { CircleAlert, ShieldCheck } from "lucide-react";
import type { RoyaltiesDashboard } from "../../server/royalties-dashboard-core";

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function matchLabel(matched: number, total: number): string {
  return `${matched}/${total}`;
}

function readinessLabel(dashboard: RoyaltiesDashboard): string {
  if (dashboard.summary.splitIssueCount > 0) {
    return `Not ready to pay — ${dashboard.summary.splitIssueCount} split issues block ${formatMoney(dashboard.summary.blockedNet)}`;
  }
  return "Ready to prepare payout — all Master splits balance to 100%";
}

export function RoyaltiesOverview({ dashboard }: { dashboard: RoyaltiesDashboard }) {
  const { summary, topTracks } = dashboard;
  const maxTrackNet = Math.max(...topTracks.map((track) => track.net), 0.01);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className={`text-sm font-medium ${summary.readyToPay ? "text-emerald-600" : "text-red-600"}`}>
          <span className="inline-flex items-center gap-1.5">
            {summary.readyToPay ? <ShieldCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            {summary.readyToPay ? "Ready" : "Blocked"}
          </span>
        </div>
        <h2 className="text-2xl font-semibold">{readinessLabel(dashboard)}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Payable preview excludes mechanical / MPAY rows and any work whose Master splits do not balance exactly to 100%.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Imported revenue</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(summary.totalNet)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Payable preview</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(summary.payablePreviewNet)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Blocked by split issues</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(summary.blockedNet)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Statement runs</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{summary.statementCount}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Matched works</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{matchLabel(summary.workMatchedRows, summary.rowCount)}</div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">Top Tracks</h3>
          <p className="text-sm text-[var(--muted-foreground)]">Which tracks drive the current statement mix.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted-foreground)] font-normal">
                <th className="text-left px-4 py-2.5">Track</th>
                <th className="text-right px-4 py-2.5">Rows</th>
                <th className="text-right px-4 py-2.5">Net</th>
                <th className="text-right px-4 py-2.5">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
              {topTracks.slice(0, 10).map((track) => (
                <tr key={`${track.workId ?? track.title}:${track.title}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{track.title}</div>
                    <div className="mt-1 h-1 bg-[var(--muted)] rounded-full overflow-hidden max-w-md">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(track.net / maxTrackNet) * 100}%`, backgroundColor: "var(--chart-3)" }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{track.rows}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(track.net)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{track.percentOfTotal.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
