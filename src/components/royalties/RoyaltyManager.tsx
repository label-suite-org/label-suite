"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RoyaltyForm, type RoyaltyRecord } from "./RoyaltyForm";
import { StatementImport } from "./StatementImport";
import { PayoutView } from "./PayoutView";
import { StatementGroupedView } from "./StatementGroupedView";
import { RoyaltiesOverview } from "./RoyaltiesOverview";
import { RoyaltyDataQualityPanel } from "./RoyaltyDataQualityPanel";
import { StatementReview } from "./StatementReview";
import { StatementRunsView } from "./StatementRunsView";
import type { MasterPayoutPreview, RoyaltiesDashboard } from "../../server/royalties-dashboard-core";
import type { getRoyaltyPipelineSummary } from "../../server/royalty-ledger";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const STATUS_STYLES: Record<string, string> = {
  paid: "text-emerald-600",
  pending: "text-amber-600",
  unpaid: "text-red-600",
};

type ViewMode = "grouped" | "flat";
type ActiveTab = "overview" | "statementRuns" | "trackRevenue" | "payouts" | "dataQuality";

function formatMoney(value: string | number | null | undefined, currency?: string): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "—";
  const [, sign, whole, fraction = ""] = match;
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const visibleFraction = fraction.replace(/0+$/, "");
  const formattedFraction = visibleFraction.length === 0 ? "00" : visibleFraction.length === 1 ? `${visibleFraction}0` : visibleFraction;
  return `${currency ? currency + " " : "$"}${sign}${groupedWhole}.${formattedFraction}`;
}

export function RoyaltyManager({
  dashboard,
  pipeline: initialPipeline,
  initialRecords,
  payoutPreview,
  artists,
  releases,
  canMutate = true,
}: {
  dashboard: RoyaltiesDashboard;
  pipeline: Awaited<ReturnType<typeof getRoyaltyPipelineSummary>>;
  initialRecords: Array<RoyaltyRecord & { artist_name?: string | null; release_title?: string | null; work_title?: string | null }>;
  payoutPreview: MasterPayoutPreview;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  canMutate?: boolean;
}) {
  const [pipeline, setPipeline] = useState(initialPipeline);
  async function refreshPipeline() {
    const response = await fetch("/api/royalties/pipeline");
    if (!response.ok) throw new Error("The action succeeded, but summary refresh failed. Reload to see current balances.");
    setPipeline(await response.json());
  }
  const [records, setRecords] = useState(initialRecords);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      if (record.source) set.add(record.source);
    }
    return ["all", ...Array.from(set).sort()];
  }, [records]);

  const filtered = useMemo(() => {
    let result = records;
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (record) =>
          record.record_name.toLowerCase().includes(query) ||
          (record.artist_name || "").toLowerCase().includes(query) ||
          (record.release_title || "").toLowerCase().includes(query) ||
          (record.statement_period || "").toLowerCase().includes(query),
      );
    }
    if (filterStatus !== "all") {
      result = result.filter((record) => (record.paid_out || "unpaid") === filterStatus);
    }
    if (filterSource !== "all") {
      result = result.filter((record) => record.source === filterSource);
    }
    return result;
  }, [records, search, filterStatus, filterSource]);

  async function deleteRecord(id: string) {
    if (!confirm("Delete this royalty record?")) return;
    try {
      const res = await fetch("/api/royalties", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      setRecords((prev) => prev.filter((record) => record.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  }

  const editing = records.find((record) => record.id === editingId);
  const isGrouped = viewMode === "grouped";
  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "statementRuns", label: "Statement Runs" },
    { id: "trackRevenue", label: "Track Revenue" },
    { id: "payouts", label: "Payouts" },
    { id: "dataQuality", label: "Data Quality" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PipelineStat label="Raw earnings" value={pipeline.earnings.rowCount.toLocaleString()} detail={`${pipeline.earnings.matchedCount.toLocaleString()} matched`} />
        <PipelineStat label="Unmatched" value={pipeline.earnings.unmatchedCount.toLocaleString()} detail="needs attribution" />
        <PipelineStat label="Imported net" value={pipeline.earningTotals.length ? pipeline.earningTotals.map(total => <span className="block break-all" key={total.currency}>{formatMoney(total.amount,total.currency)}</span>) : "No earnings"} detail={`${pipeline.imports.length} recent imports`} />
        <PipelineStat label="Payee balances" value={pipeline.postedTotals.length ? pipeline.postedTotals.map(total => <span className="block break-all" key={total.currency}>{formatMoney(total.amount,total.currency)}</span>) : "No posted balances"} detail="Issued allocations less recorded payouts" />
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm text-[var(--muted-foreground)]">
            {records.length} imported reporting rows · Preview {dashboard.summary.readyToPay ? "ready" : "needs attention"}
          </div>
        </div>
        {canMutate ? <div className="flex items-center gap-2">
          <Button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 bg-[var(--foreground)] text-[var(--background)] text-xs font-medium rounded-lg hover:opacity-90"
          >
            + Add Record
          </Button>
          <Button
            onClick={() => setImporting(true)}
            className="px-3 py-1.5 border border-[var(--border)] text-xs font-medium rounded-lg hover:bg-[var(--muted)]"
          >
            Import Statement
          </Button>
        </div> : <p className="text-sm text-[var(--muted-foreground)]">Read-only for fundraiser</p>}
      </div>

      <div className="flex gap-1 border-b border-[var(--border)] overflow-x-auto">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-b-2 border-[var(--foreground)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-8">
          <RoyaltiesOverview dashboard={dashboard} />
          <RoyaltyDataQualityPanel dashboard={dashboard} />
        </div>
      )}

      {activeTab === "statementRuns" && <div className="space-y-8"><StatementReview canMutate={canMutate} onChanged={refreshPipeline} /><StatementRunsView dashboard={dashboard} /></div>}

      {activeTab === "trackRevenue" && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setViewMode("grouped")}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                isGrouped ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}
            >
              Grouped
            </Button>
            <Button
              onClick={() => setViewMode("flat")}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                isGrouped ? "hover:bg-[var(--muted)] text-[var(--muted-foreground)]" : "bg-[var(--foreground)] text-[var(--background)]"
              }`}
            >
              Flat
            </Button>
          </div>

          {isGrouped ? (
            <StatementGroupedView records={records as any} />
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                  </svg>
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search records, artists, releases…"
                    className="w-full pl-9 pr-3 py-2 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] bg-transparent"
                  />
                </div>
                <NativeSelect
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value)}
                  className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] bg-transparent"
                >
                  <option value="all">All Status</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </NativeSelect>
                <NativeSelect
                  value={filterSource}
                  onChange={(event) => setFilterSource(event.target.value)}
                  className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] bg-transparent"
                >
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {source === "all" ? "All Sources" : source}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <p className="text-sm text-[var(--muted-foreground)]">
                {filtered.length} of {records.length} record{records.length === 1 ? "" : "s"}
                {search.trim() || filterStatus !== "all" || filterSource !== "all" ? " match your filters" : ""}
              </p>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--muted-foreground)] font-normal">
                      <th className="text-left px-4 py-2.5">Record</th>
                      <th className="text-left px-4 py-2.5">Artist</th>
                      <th className="text-left px-4 py-2.5">Period</th>
                      <th className="text-left px-4 py-2.5">Source</th>
                      <th className="text-right px-4 py-2.5">Gross</th>
                      <th className="text-right px-4 py-2.5">Net</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-right px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] [&_tr:nth-child(even)]:bg-[var(--muted)]/20">
                    {filtered.map((record) => (
                      <tr key={record.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{record.record_name}</div>
                          {record.release_title && <div className="text-xs text-[var(--muted-foreground)]">{record.release_title}</div>}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{record.artist_name || "—"}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{record.statement_period || "—"}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{record.source || "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatMoney(record.gross_revenue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{formatMoney(record.net_revenue)}</td>
                        <td className={`px-4 py-3 ${STATUS_STYLES[record.paid_out || "unpaid"]}`}>
                          {record.paid_out || "unpaid"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-2 justify-end">
                            {canMutate && <><Button onClick={() => setEditingId(record.id!)} className="text-xs underline underline-offset-2">Edit</Button>
                            <Button onClick={() => deleteRecord(record.id!)} className="text-xs underline underline-offset-2 text-red-600">Delete</Button></>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && <div className="p-8 text-center text-[var(--muted-foreground)]">No records match your filters.</div>}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "payouts" && <PayoutView preview={payoutPreview} />}

      {activeTab === "dataQuality" && <RoyaltyDataQualityPanel dashboard={dashboard} />}

      {canMutate && creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreating(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Add Royalty Record</h2>
            <RoyaltyForm artists={artists} releases={releases} onClose={() => setCreating(false)} />
          </div>
        </div>
      )}

      {canMutate && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingId(null)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Edit Royalty Record</h2>
            <RoyaltyForm initial={editing} artists={artists} releases={releases} onClose={() => setEditingId(null)} />
          </div>
        </div>
      )}

      {canMutate && importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setImporting(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Import Statement (CSV or TSV)</h2>
            <StatementImport onClose={() => setImporting(false)} onImported={() => window.location.reload()} />
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineStat({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
