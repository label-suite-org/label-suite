"use client";

import { Fragment, useState } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import type { MasterPayoutPreview } from "../../server/royalties-dashboard-core";

import { Button } from "@/components/ui/button";
function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PayoutView({ preview }: { preview: MasterPayoutPreview }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!preview.contacts.length) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-[var(--muted-foreground)]">{preview.caveat}</div>
        <div className="p-12 text-center text-[var(--muted-foreground)] border-2 border-dashed border-[var(--border)] rounded-xl">
          <p className="text-lg">No payable Master rows yet.</p>
          <p className="text-sm mt-1">Fix split issues or import a statement with balanced Master rights.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className={`text-sm font-medium ${preview.readyToPay ? "text-emerald-600" : "text-red-600"}`}>
          <span className="inline-flex items-center gap-1.5">
            {preview.readyToPay ? <ShieldCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            {preview.readyToPay ? "Ready to prepare payout" : "Preview only — not ready to pay"}
          </span>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">{preview.caveat}</p>
        {!preview.readyToPay && (
          <p className="text-sm text-[var(--muted-foreground)]">
            {formatMoney(preview.blockedNet)} is blocked by split issues. {formatMoney(preview.mechanicalNet)} is quarantined as mechanical / MPAY.
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Payable preview</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(preview.totalOwed)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Blocked by split issues</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(preview.blockedNet)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Mechanical quarantine</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatMoney(preview.mechanicalNet)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Contacts owed</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{preview.contacts.length}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Master payout preview</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Contact totals include valid Master rows only.</p>
        </div>
        <a
          className="px-3 py-1.5 border border-[var(--border)] text-xs font-medium rounded-lg hover:bg-[var(--muted)]"
          href="/api/royalties/payouts/export"
        >
          Export CSV
        </a>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)] font-normal">
              <th className="text-left px-4 py-2.5">Contact</th>
              <th className="text-right px-4 py-2.5">Master</th>
              <th className="text-right px-4 py-2.5">Lines</th>
              <th className="text-right px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
            {preview.contacts.map((contact) => {
              const isExpanded = expanded === contact.contact_id;
              return (
                <Fragment key={contact.contact_id}>
                  <tr key={contact.contact_id}>
                    <td className="px-4 py-3 font-medium">{contact.contact_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(contact.master_owed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{contact.line_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="link"
                        className="text-xs underline underline-offset-2"
                        onClick={() => setExpanded(isExpanded ? null : contact.contact_id)}
                      >
                        {isExpanded ? "Hide" : "Breakdown"}
                      </Button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${contact.contact_id}-detail`}>
                      <td colSpan={4} className="px-4 py-3 bg-[var(--muted)]/10">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="text-[var(--muted-foreground)] font-normal border-b border-[var(--border)]">
                              <th className="text-left py-2 pr-4">Work</th>
                              <th className="text-left py-2 pr-4">Period</th>
                              <th className="text-right py-2 pr-4">Net revenue</th>
                              <th className="text-left py-2 pr-4">Role</th>
                              <th className="text-right py-2 pr-4">Share</th>
                              <th className="text-right py-2">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {contact.lines.map((line, index) => (
                              <tr key={`${contact.contact_id}:${line.work_id ?? line.work_title}:${index}`} className="border-b border-[var(--border)]/60 last:border-b-0">
                                <td className="py-2 pr-4">{line.work_title}</td>
                                <td className="py-2 pr-4 text-[var(--muted-foreground)]">{line.statement_period ?? "—"}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(line.net_revenue)}</td>
                                <td className="py-2 pr-4 text-[var(--muted-foreground)]">{line.role}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{line.percent_share.toFixed(2)}%</td>
                                <td className="py-2 text-right tabular-nums font-medium">{formatMoney(line.amount_owed)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
