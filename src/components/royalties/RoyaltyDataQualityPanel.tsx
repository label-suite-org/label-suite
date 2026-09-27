"use client";

import type { JSX } from "react";
import { AlertTriangle, Check, CircleX } from "lucide-react";
import type { RoyaltiesDashboard } from "../../server/royalties-dashboard-core";

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatIssueLabel(issueType: RoyaltiesDashboard["splitIssues"][number]["issueType"]): string {
  switch (issueType) {
    case "no_work_match":
      return "No work match";
    case "no_master_roles":
      return "0 Master roles";
    case "under_allocated":
      return "Master below 100%";
    case "over_allocated":
      return "Master above 100%";
    default:
      return issueType;
  }
}

function checklistStatus(pass: boolean, warning = false): { icon: JSX.Element; label: string; tone: string } {
  if (pass) return { icon: <Check className="h-4 w-4" />, label: "OK", tone: "text-emerald-600" };
  if (warning) return { icon: <AlertTriangle className="h-4 w-4" />, label: "Warning", tone: "text-amber-600" };
  return { icon: <CircleX className="h-4 w-4" />, label: "Blocked", tone: "text-red-600" };
}

export function RoyaltyDataQualityPanel({ dashboard }: { dashboard: RoyaltiesDashboard }) {
  const { summary } = dashboard;
  const checklist = [
    {
      label: "Work match",
      detail: `${summary.workMatchedRows}/${summary.rowCount} rows linked to works`,
      status: checklistStatus(summary.workMatchedRows === summary.rowCount),
    },
    {
      label: "Track match",
      detail: `${summary.trackMatchedRows}/${summary.rowCount} rows linked to tracks`,
      status: checklistStatus(summary.trackMatchedRows === summary.rowCount, true),
    },
    {
      label: "Master split integrity",
      detail:
        summary.splitIssueCount === 0
          ? "All payable works balance to 100% Master"
          : `${summary.splitIssueCount} blockers keep ${formatMoney(summary.blockedNet)} out of payout preview`,
      status: checklistStatus(summary.splitIssueCount === 0),
    },
    {
      label: "Mechanical / STEM MPAY",
      detail:
        summary.mechanicalRows === 0
          ? "No quarantined mechanical rows"
          : `${summary.mechanicalRows} rows / ${formatMoney(summary.mechanicalNet)} quarantined outside Master payout`,
      status: checklistStatus(summary.mechanicalRows === 0, true),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Data Quality</h2>
        <p className="text-sm text-[var(--muted-foreground)]">Check the ledger before anyone gets paid.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)] font-normal">
              <th className="text-left px-4 py-2.5">Check</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
            {checklist.map((item) => (
              <tr key={item.label}>
                <td className="px-4 py-3 font-medium">{item.label}</td>
                <td className={`px-4 py-3 ${item.status.tone}`}>
                  <span className="mr-2 inline-flex align-middle">{item.status.icon}</span>
                  {item.status.label}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">{item.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Split blockers</h3>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          Credit roles are excluded from payout math. Only Master rights count here.
        </p>
      </div>

      {dashboard.splitIssues.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted-foreground)] font-normal">
                <th className="text-left px-4 py-2.5">Work</th>
                <th className="text-left px-4 py-2.5">Issue</th>
                <th className="text-right px-4 py-2.5">Unpaid net</th>
                <th className="text-right px-4 py-2.5">Master roles</th>
                <th className="text-right px-4 py-2.5">Master %</th>
                <th className="text-left px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
              {dashboard.splitIssues.map((issue) => (
                <tr key={`${issue.issueType}:${issue.workId ?? issue.title}`}>
                  <td className="px-4 py-3 font-medium">{issue.title}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatIssueLabel(issue.issueType)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(issue.unpaidNet)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{issue.masterRoleCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{issue.masterPct.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-xs">
                    {issue.workId ? (
                      <a className="text-[var(--foreground)] underline underline-offset-2" href={`/works/${issue.workId}`}>
                        Open work roles
                      </a>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">Needs work match</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No split blockers. Master payout math is balanced.</p>
      )}
    </div>
  );
}
