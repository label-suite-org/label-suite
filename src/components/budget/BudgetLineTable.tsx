"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Paperclip, Pencil, Settings, SlidersHorizontal, X } from "lucide-react";
import { formatCoverageMoney } from "../funding/money";
import { computeLineEfc } from "../../server/budget-efc-core";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const usd = (n: number | null | undefined, currency: string) =>
  n == null ? "—" : formatCoverageMoney(n, currency);

interface LinkedDocument {
  id: string;
  budget_line_item_id: string;
  document_id: string;
  link_type: string;
  created_at: string | null;
  document_name: string;
  document_type: string | null;
  document_status: string | null;
  document_file_link: string | null;
}

interface Line {
  id: string;
  name: string;
  amount: number | null;
  planned_amount: number | null;
  forecast_amount: number | null;
  committed_amount: number | null;
  paid_amount: number | null;
  phase: string | null;
  spend_month: string | null;
  status: string | null;
  lock_status: string | null;
  eligibility_tag: string | null;
  variance_reason: string | null;
  category_name: string | null;
  category_type: string | null;
  funding_source_name?: string | null;
  efc?: number;
  variance?: number;
}

interface VarianceRequest {
  id: string;
  line_id: string;
  line_name: string;
  requested_action: string;
  current_value: string | null;
  requested_value: string | null;
  variance_reason: string;
  status: string; // pending, approved, rejected
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string | null;
  planned_amount: number | null;
  forecast_amount: number | null;
  lock_status: string | null;
}

const TAG_STYLE: Record<string, string> = {
  stem_review: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  grant_eligible: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  duplicate_risk: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  non_eligible: "bg-muted text-muted-foreground",
};

const TAG_LABEL: Record<string, string> = {
  stem_review: "STEM review",
  grant_eligible: "Grant eligible",
  duplicate_risk: "Duplicate risk",
  non_eligible: "Non-eligible",
};

interface BudgetLineTableProps {
  lines: Line[];
  varianceRequests?: VarianceRequest[];
  canDecideVariance?: boolean;
  onChanged?: () => void;
  currency?: string;
}

export default function BudgetLineTable({ lines, varianceRequests, canDecideVariance = false, onChanged, currency = "DKK" }: BudgetLineTableProps) {
  const usd = (n: number | null | undefined) => n == null ? "—" : formatCoverageMoney(n, currency);
  const [tabFilter, setTabFilter] = useState<"all" | "planned" | "committed" | "actuals" | "variances" | "approved">("all");
  const [groupFilter, setGroupFilter] = useState<"all" | "production" | "marketing" | "contingency" | "uncategorized">("all");
  const [viewMode, setViewMode] = useState<"control" | "audit">("control");

  const filtered = useMemo(() => {
    return lines
      .filter((line) => {
        if (groupFilter === "contingency") return line.lock_status === "locked";
        if (groupFilter === "uncategorized") return line.lock_status !== "locked" && line.category_type !== "production" && line.category_type !== "production_contingency" && line.category_type !== "marketing" && line.category_type !== "marketing_contingency";
        if (groupFilter !== "all") return line.category_type === groupFilter;
        return true;
      })
      .filter((line) => {
        if (tabFilter === "planned") return (line.planned_amount ?? 0) > 0;
        if (tabFilter === "committed") return (line.committed_amount ?? 0) > 0;
        if (tabFilter === "actuals") return (line.paid_amount ?? 0) > 0;
        if (tabFilter === "approved") return line.status === "approved" || line.status === "paid";
        if (tabFilter === "variances") {
          const planned = line.planned_amount ?? 0;
          const forecast = line.forecast_amount ?? 0;
          return planned > 0 && Math.abs(forecast - planned) / planned > 0.1;
        }
        return true;
      });
  }, [lines, groupFilter, tabFilter]);

  const productionLines = filtered.filter((l) => (l.category_type === "production" || l.category_type === "production_contingency") && l.lock_status !== "locked");
  const marketingLines = filtered.filter((l) => (l.category_type === "marketing" || l.category_type === "marketing_contingency") && l.lock_status !== "locked");
  const contingencyLines = filtered.filter((l) => l.lock_status === "locked");
  const uncategorizedLines = filtered.filter((l) => !l.lock_status || l.lock_status !== "locked")
    .filter((l) => !["production", "production_contingency", "marketing", "marketing_contingency"].includes(l.category_type ?? ""));

  const pendingVariance = (varianceRequests ?? []).filter((v) => v.status === "pending");

  return (
    <div className="space-y-4">
      {/* Approval queue */}
      {pendingVariance.length > 0 && (
        <ApprovalQueue requests={pendingVariance} canDecideVariance={canDecideVariance} onChanged={onChanged} currency={currency} />
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3">
        {[
          { key: "all", label: "All items" },
          { key: "planned", label: "Planned" },
          { key: "committed", label: "Committed" },
          { key: "actuals", label: "Actuals" },
          { key: "variances", label: "Variances" },
          { key: "approved", label: "Approved" },
        ].map((opt) => (
          <Button
            key={opt.key}
            onClick={() => setTabFilter(opt.key as any)}
            className={`h-8 rounded-lg border px-3 text-sm font-medium ${
              tabFilter === opt.key
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border hover:bg-muted"
            }`}
          >
            {opt.label}
          </Button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <NativeSelect value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as any)} className="bg-transparent text-foreground outline-none">
              <option value="all">All lines</option>
              <option value="production">Production</option>
              <option value="marketing">Marketing</option>
              <option value="contingency">Contingency</option>
              <option value="uncategorized">Uncategorized</option>
            </NativeSelect>
          </label>
          <Button
            onClick={() => setViewMode(viewMode === "control" ? "audit" : "control")}
            className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors ${viewMode === "audit" ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-muted text-foreground"}`}
            aria-label="Toggle advanced details"
            aria-pressed={viewMode === "audit"}
          >
            Advanced details
          </Button>
          <Button variant="outline" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted" aria-label="Table settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground self-center">
            {filtered.length} lines · {usd(filtered.reduce((s, l) => s + (l.planned_amount ?? 0), 0))}
          </span>
        </div>
        </div>
      </div>

      {productionLines.length > 0 && (groupFilter === "all" || groupFilter === "production" || groupFilter === "contingency") && (
        <LineSection
          title="Production"
          lines={productionLines}
          accent="bg-blue-500"
          viewMode={viewMode}
          varianceRequests={varianceRequests}
          onChanged={onChanged}
          currency={currency}
        />
      )}
      {marketingLines.length > 0 && (groupFilter === "all" || groupFilter === "marketing" || groupFilter === "contingency") && (
        <LineSection
          title="Marketing (STEM review on key lines)"
          lines={marketingLines}
          accent="bg-violet-500"
          viewMode={viewMode}
          varianceRequests={varianceRequests}
          onChanged={onChanged}
          currency={currency}
        />
      )}
      {contingencyLines.length > 0 && (groupFilter === "all" || groupFilter === "contingency") && (
        <LineSection
          title="Contingency (locked)"
          lines={contingencyLines}
          accent="bg-amber-500"
          viewMode={viewMode}
          varianceRequests={varianceRequests}
          onChanged={onChanged}
          currency={currency}
        />
      )}
      {uncategorizedLines.length > 0 && (groupFilter === "all" || groupFilter === "uncategorized") && (
        <LineSection
          title="Uncategorized"
          lines={uncategorizedLines}
          accent="bg-slate-400"
          viewMode={viewMode}
          varianceRequests={varianceRequests}
          onChanged={onChanged}
          currency={currency}
        />
      )}
    </div>
  );
}

function LineSection({
  title,
  lines,
  accent,
  viewMode,
  varianceRequests,
  onChanged,
  currency,
}: {
  title: string;
  lines: Line[];
  accent: string;
  viewMode: "control" | "audit";
  varianceRequests?: VarianceRequest[];
  onChanged?: () => void;
  currency: string;
}) {
  const subtotal = lines.reduce((s, l) => s + (l.planned_amount ?? 0), 0);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${accent}`} />
        <h3 className="font-semibold flex-1">{title}</h3>
        <span className="text-xs text-muted-foreground">{lines.length} lines · {formatCoverageMoney(subtotal, currency)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            {viewMode === "control" ? (
              <tr>
                <th className="text-left font-normal px-4 py-2.5">Line</th>
                <th className="text-right font-normal px-4 py-2.5">Budget</th>
                <th className="text-right font-normal px-4 py-2.5">Paid</th>
                <th className="text-left font-normal px-4 py-2.5">Spending month</th>
                <th className="text-left font-normal px-4 py-2.5">Funding source</th>
                <th className="text-left font-normal px-4 py-2.5">Evidence</th>
                <th className="text-left font-normal px-4 py-2.5">Action</th>
              </tr>
            ) : (
              <tr>
                <th className="text-left font-normal px-4 py-2.5">Line</th>
                <th className="text-left font-normal px-4 py-2.5">Phase</th>
                <th className="text-left font-normal px-4 py-2.5">Spend month</th>
                <th className="text-right font-normal px-4 py-2.5">Planned</th>
                <th className="text-right font-normal px-4 py-2.5">EFC</th>
                <th className="text-right font-normal px-4 py-2.5">Variance</th>
                <th className="text-right font-normal px-4 py-2.5">Forecast</th>
                <th className="text-left font-normal px-4 py-2.5">% Used</th>
                <th className="text-right font-normal px-4 py-2.5">Committed</th>
                <th className="text-right font-normal px-4 py-2.5">Paid</th>
                <th className="text-left font-normal px-4 py-2.5">Status</th>
                <th className="text-left font-normal px-4 py-2.5">Tags</th>
                <th className="text-left font-normal px-4 py-2.5">Evidence</th>
                <th className="text-left font-normal px-4 py-2.5">Action</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <LineRow key={l.id} line={l} viewMode={viewMode} varianceRequests={varianceRequests} onChanged={onChanged} currency={currency} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineRow({
  line: l,
  viewMode,
  varianceRequests,
  onChanged,
  currency,
}: {
  line: Line;
  viewMode: "control" | "audit";
  varianceRequests?: VarianceRequest[];
  onChanged?: () => void;
  currency: string;
}) {
  const [editing, setEditing] = useState<null | "planned" | "forecast" | "committed" | "paid" | "spend_month">(null);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showVarianceModal, setShowVarianceModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [linkedDocs, setLinkedDocs] = useState<LinkedDocument[] | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);

  const planned = l.planned_amount ?? 0;
  const committed = l.committed_amount ?? 0;
  const costs = computeLineEfc(l);
  const efc = l.efc ?? costs.efc;
  const variance = l.variance ?? costs.variance;
  const usedPct = planned > 0 ? Math.round((committed / planned) * 100) : 0;
  const variancePct = planned > 0 ? Math.abs(variance) / planned : 0;
  const hasVariance = variancePct > 0.1;
  const needsVarianceComment = hasVariance && (!l.variance_reason || l.variance_reason.trim() === "");
  const isLocked = l.lock_status === "locked";
  const needsApproval = isLocked && efc > planned;

  // Find existing variance request for this line
  const lineVariance = (varianceRequests ?? []).find((v) => v.line_id === l.id);
  const evidenceLabel = docCount != null && docCount > 0 ? `${docCount} document${docCount === 1 ? "" : "s"}` : "Add evidence";
  const actionLabel = needsVarianceComment
    ? "Add variance comment"
    : needsApproval
      ? "Request approval"
      : lineVariance?.status === "pending"
        ? "Approval pending"
        : lineVariance?.status === "approved"
          ? "Approved"
          : isLocked
            ? "Keep locked"
            : "OK";

  function startEdit(field: "planned" | "forecast" | "committed" | "paid") {
    if (isLocked) return;
    setDraft(String(l[`${field}_amount`] ?? 0));
    setEditing(field);
  }

  function startEditMonth() {
    if (isLocked) return;
    setDraft(l.spend_month ?? "");
    setEditing("spend_month");
  }

  async function save() {
    const value = editing === "spend_month" ? draft.trim() : Number(draft);
    if (editing !== "spend_month" && Number.isNaN(value)) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/budget-line-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editing === "spend_month" ? { id: l.id, spend_month: value || null } : { id: l.id, [`${editing}_amount`]: value }),
      });
      if (!res.ok) setSaveError("Could not save this change.");
      else if (onChanged) onChanged();
    } catch {
      setSaveError("Could not save this change.");
    } finally {
      setSaving(false);
      setEditing(null);
    }
  }

  function cancel() {
    setEditing(null);
  }

  async function loadDocs() {
    if (linkedDocs !== null) return; // already loaded
    try {
      const res = await fetch(`/api/budget-line-items/${l.id}/documents`);
      const data = await res.json();
      if (data.documents) {
        setLinkedDocs(data.documents);
        setDocCount(data.documents.length);
      } else {
        setDocCount(0);
      }
    } catch {
      setDocCount(0);
    }
  }

  function openDocModal() {
    setShowDocModal(true);
    loadDocs();
  }

  async function unlinkDoc(linkId: string) {
    try {
      const res = await fetch(`/api/budget-line-documents/${linkId}`, { method: "DELETE" });
      if (res.ok) {
        setLinkedDocs((prev) => (prev ?? []).filter((d) => d.id !== linkId));
        setDocCount((prev) => (prev ?? 1) - 1);
      }
    } catch {
      // ignore
    }
  }

  function renderAmountCell(field: "planned" | "forecast" | "committed" | "paid", rightAligned = true) {
    if (editing === field) {
      return (
        <td className={`px-4 py-2.5 ${rightAligned ? "text-right" : ""}`}>
          <Input
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            onBlur={save}
            autoFocus
            disabled={saving}
            className="w-24 px-2 py-1 text-right bg-background border border-border rounded text-sm font-mono"
          />
        </td>
      );
    }
    return (
      <td className={`px-4 py-2.5 ${rightAligned ? "text-right" : ""} group`}>
        <span className={`${field === "planned" ? "font-medium" : ""}`}>{usd(l[`${field}_amount`], currency)}</span>
        {!isLocked && (
          <Button
            onClick={() => startEdit(field)}
            className="ml-2 inline-flex text-muted-foreground hover:text-foreground"
            title="Edit"
            aria-label={`Edit ${field} amount for ${l.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    );
  }

  if (viewMode === "control") {
    return (
      <>
        <tr className={isLocked ? "bg-muted/20" : ""}>
          <td className="px-4 py-3 max-w-[420px]">
            <p className="font-medium truncate">{l.name}</p>
            <p className="text-xs text-muted-foreground truncate">{l.category_name}{l.phase ? ` · ${l.phase}` : ""}</p>
          </td>
          {renderAmountCell("planned")}
          {renderAmountCell("paid")}
          <td className="px-4 py-3 text-muted-foreground group">
            {editing === "spend_month" ? (
              <Input type="month" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); if (event.key === "Escape") cancel(); }} onBlur={save} autoFocus disabled={saving} aria-label={`Edit spending month for ${l.name}`} className="rounded border border-border bg-background px-2 py-1 text-sm" />
            ) : <><span>{l.spend_month ?? "—"}</span>{!isLocked && <Button variant="ghost" onClick={startEditMonth} className="ml-2 text-muted-foreground hover:text-foreground" title="Edit spending month" aria-label={`Edit spending month for ${l.name}`}><Pencil className="h-3.5 w-3.5" /></Button>}</>}
          </td>
          <td className="px-4 py-3 text-muted-foreground">{l.funding_source_name ?? "Not allocated"}</td>
          <td className="px-4 py-3">
            <Button variant="link" onClick={openDocModal} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              {evidenceLabel}
            </Button>
          </td>
          <td className="px-4 py-3">
            {(needsVarianceComment || needsApproval) ? (
              <Button onClick={() => setShowVarianceModal(true)} className="text-sm font-medium underline underline-offset-2">
                {actionLabel}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">{actionLabel}</span>
            )}
          </td>
        </tr>

        {saveError && <tr><td colSpan={7} className="px-4 py-1.5 text-xs text-red-700" role="alert">{saveError}</td></tr>}

        {(needsVarianceComment || needsApproval) && (
          <tr className="bg-muted/20">
            <td colSpan={7} className="px-4 py-1.5 text-xs text-muted-foreground">
              {needsVarianceComment ? `Variance ${Math.round(variancePct * 100)}% needs a comment.` : "Locked contingency spend needs approval."}
            </td>
          </tr>
        )}

        {showVarianceModal && (
          <VarianceModal line={l} onClose={() => setShowVarianceModal(false)} onSaved={onChanged} currency={currency} />
        )}
        {showDocModal && (
          <DocumentLinkModal
            line={l}
            linkedDocs={linkedDocs}
            onClose={() => setShowDocModal(false)}
            onUnlink={unlinkDoc}
            onLinked={() => {
              setLinkedDocs(null);
              loadDocs();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <tr className={`${isLocked ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
        <td className="px-4 py-2.5 max-w-[300px]">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{l.name}</p>
          </div>
          <p className="text-xs text-muted-foreground truncate">{l.category_name}</p>
        </td>
        <td className="px-4 py-2.5 text-muted-foreground text-xs">{l.phase ?? "—"}</td>
        <td className="px-4 py-2.5 text-muted-foreground text-xs">{l.spend_month ?? "—"}</td>
        {renderAmountCell("planned")}
        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${variance < 0 ? "text-red-600" : "text-foreground"}`}>{usd(efc, currency)}</td>
        <td className={`px-4 py-2.5 text-right tabular-nums ${variance < 0 ? "font-medium text-red-600" : variance > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
          {variance === 0 ? "—" : usd(variance, currency)}
        </td>
        {renderAmountCell("forecast")}
        <td className="px-4 py-2.5 min-w-[120px]">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${usedPct >= 100 ? "bg-emerald-500" : usedPct >= 65 ? "bg-amber-500" : "bg-neutral-400"}`} style={{ width: `${Math.min(usedPct, 100)}%` }} />
            </div>
            <span className="w-10 text-right text-xs text-muted-foreground">{usedPct}%</span>
          </div>
        </td>
        {renderAmountCell("committed")}
        {renderAmountCell("paid")}
        <td className="px-4 py-2.5">
          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
            isLocked
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              : l.status === "approved"
                ? "bg-emerald-100 text-emerald-700"
                : l.status === "paid"
                  ? "bg-violet-100 text-violet-700"
                  : "bg-muted text-muted-foreground"
          }`}>
            {isLocked ? "Locked" : l.status ?? "pending"}
          </span>
        </td>
        <td className="px-4 py-2.5">
          {l.eligibility_tag && (
            <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${TAG_STYLE[l.eligibility_tag] ?? "bg-muted"}`}>
              {TAG_LABEL[l.eligibility_tag] ?? l.eligibility_tag}
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center">
          <Button
            onClick={openDocModal}
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              docCount != null && docCount > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:text-foreground"
            }`}
            title="Linked documents"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {docCount != null && docCount > 0 ? <span className="text-[10px]">{docCount}</span> : null}
          </Button>
        </td>
        <td className="px-2 py-2.5 text-center">
          {(needsVarianceComment || needsApproval) && (
            <Button
              onClick={() => setShowVarianceModal(true)}
              className="inline-flex items-center gap-1 text-xs font-medium"
              title={needsVarianceComment ? "Needs variance comment" : "Needs approval"}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${needsVarianceComment ? "bg-red-500 animate-pulse" : "bg-amber-500"}`} />
            </Button>
          )}
          {lineVariance?.status === "pending" && (
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Approval pending" />
          )}
          {lineVariance?.status === "approved" && (
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Approved" />
          )}
        </td>
      </tr>

      {/* Variance warning row */}
      {(needsVarianceComment || needsApproval) && (
        <tr className="bg-red-50/30 dark:bg-red-950/10">
          <td colSpan={13} className="px-4 py-1.5">
            <div className="flex items-center gap-2 text-xs">
              {needsVarianceComment && (
                <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-medium">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Variance {Math.round(variancePct * 100)}% — needs variance comment
                </span>
              )}
              {needsApproval && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Contingency spend — needs approval
                </span>
              )}
              <Button
                onClick={() => setShowVarianceModal(true)}
                className="ml-auto px-2 py-0.5 bg-foreground text-background rounded text-[10px] font-medium hover:opacity-80"
              >
                Request approval
              </Button>
            </div>
          </td>
        </tr>
      )}

      {/* Variance modal */}
      {showVarianceModal && (
        <VarianceModal
          line={l}
          onClose={() => setShowVarianceModal(false)}
          onSaved={onChanged}
          currency={currency}
        />
      )}

      {/* Document link modal */}
      {showDocModal && (
        <DocumentLinkModal
          line={l}
          linkedDocs={linkedDocs}
          onClose={() => setShowDocModal(false)}
          onUnlink={unlinkDoc}
          onLinked={() => {
            setLinkedDocs(null); // force reload
            loadDocs();
          }}
        />
      )}
    </>
  );
}

function VarianceModal({
  line,
  onClose,
  onSaved,
  currency,
}: {
  line: Line;
  onClose: () => void;
  onSaved?: () => void;
  currency: string;
}) {
  const [reason, setReason] = useState(line.variance_reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reason.trim()) {
      setError("Please provide a variance reason.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/budget-line-items/${line.id}/variance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variance_reason: reason,
          requested_action: "increase_amount",
          current_value: JSON.stringify({ planned: line.planned_amount, forecast: line.forecast_amount }),
        }),
      });
      if (res.ok) {
        onSaved?.();
        onClose();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to submit");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h4 className="font-semibold mb-1">Variance comment — {line.name}</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Planned: {formatCoverageMoney(line.planned_amount ?? line.amount ?? 0, currency)} · Forecast: {formatCoverageMoney(line.forecast_amount ?? line.planned_amount ?? line.amount ?? 0, currency)} · Lock: {line.lock_status ?? "open"}
        </p>

        <label className="block text-xs text-muted-foreground mb-1">Reason for variance</label>
        <Textarea
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(""); }}
          rows={4}
          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm mb-3 resize-none"
          placeholder="e.g., Studio costs came in higher due to extra day of tracking"
        />

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-muted">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Submit variance"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DocumentLinkModal({
  line,
  linkedDocs,
  onClose,
  onUnlink,
  onLinked,
}: {
  line: Line;
  linkedDocs: LinkedDocument[] | null;
  onClose: () => void;
  onUnlink: (linkId: string) => void;
  onLinked: () => void;
}) {
  const [linkType, setLinkType] = useState<string>("invoice");
  const [documentId, setDocumentId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  async function handleLink() {
    if (!documentId) {
      setError("Select a document");
      return;
    }
    setLinking(true);
    setError("");
    try {
      const res = await fetch(`/api/budget-line-items/${line.id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, link_type: linkType }),
      });
      if (res.ok) {
        setDocumentId("");
        onLinked();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to link");
      }
    } catch {
      setError("Network error");
    } finally {
      setLinking(false);
    }
  }

  const docs = linkedDocs ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-lg mx-4 shadow-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold">Documents — {line.name}</h4>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Linked documents list */}
        {linkedDocs === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-3">No documents linked yet.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-muted/30 border border-border rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{d.document_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.link_type} · {d.document_status ?? "draft"}
                    {d.document_type ? ` · ${d.document_type}` : ""}
                  </p>
                </div>
                <Button
                  onClick={() => onUnlink(d.id)}
                  className="ml-2 inline-flex text-red-600 hover:text-red-700"
                  title="Remove link"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Link new document */}
        <div className="border-t border-border pt-3">
          <h5 className="text-sm font-medium mb-2">Link document</h5>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Document ID</label>
              <Input
                type="text"
                value={documentId}
                onChange={(e) => { setDocumentId(e.target.value); setError(""); }}
                placeholder="Paste document ID from /documents"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <NativeSelect
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                <option value="invoice">Invoice</option>
                <option value="receipt">Receipt</option>
                <option value="quote">Quote</option>
                <option value="contract">Contract</option>
              </NativeSelect>
            </div>
            <Button
              onClick={handleLink}
              disabled={linking || !documentId}
              className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium disabled:opacity-40"
            >
              {linking ? "Linking…" : "Link"}
            </Button>
          </div>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <p className="text-[10px] text-muted-foreground mt-1">
            Find document IDs on the <a href="/documents" className="underline" target="_blank" rel="noopener">Documents page</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function ApprovalQueue({
  requests,
  canDecideVariance,
  onChanged,
  currency,
}: {
  requests: VarianceRequest[];
  canDecideVariance: boolean;
  onChanged?: () => void;
  currency: string;
}) {
  const [processing, setProcessing] = useState<string | null>(null);

  async function handleApproval(varianceId: string, approve: boolean) {
    setProcessing(varianceId);
    try {
      const res = await fetch(`/api/variance-requests/${varianceId}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok && onChanged) onChanged();
    } finally {
      setProcessing(null);
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4">
      <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
        Pending variance requests ({requests.length})
      </h3>
      <div className="space-y-2">
        {requests.map((v) => (
          <div key={v.id} className="flex items-start justify-between gap-3 bg-white dark:bg-card border border-border rounded-lg p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{v.line_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {v.variance_reason}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Planned: {formatCoverageMoney(v.planned_amount ?? 0, currency)} · Forecast: {formatCoverageMoney(v.forecast_amount ?? 0, currency)} · {v.requested_action}
              </p>
            </div>
            {canDecideVariance ? <div className="flex gap-2 shrink-0">
              <Button
                onClick={() => handleApproval(v.id, true)}
                disabled={processing === v.id}
                className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-md font-medium hover:bg-emerald-700 disabled:opacity-40"
              >
                Approve
              </Button>
              <Button
                onClick={() => handleApproval(v.id, false)}
                disabled={processing === v.id}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-40"
              >
                Reject
              </Button>
            </div> : <span className="shrink-0 text-xs text-muted-foreground">Decision requires owner access</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
