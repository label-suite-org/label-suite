"use client";

import { useState } from "react";
import { AlertTriangle, Check, Plus, ShieldCheck } from "lucide-react";
import { RoleForm, type RoleData } from "./RoleForm";

import { Button } from "@/components/ui/button";
export interface RoleRow extends RoleData {
  id: string;
  contact_name?: string | null;
}

const badgeCls = (status?: string | null) =>
  status === "Signed"     ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
  status === "Confirmed"  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
  status === "Pending"    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            "bg-muted text-muted-foreground";

const clearanceWeight: Record<string, number> = { Signed: 1, Confirmed: 0.75, Pending: 0.25 };

interface ScopeSummary {
  enteredTotal: number;
  weightedTotal: number;
  progress: number;
  cleared: boolean;
  rightsCount: number;
  creditCount: number;
  needsAttention: boolean;
}

function computeScope(roles: RoleRow[], scopeFilter: string[]): ScopeSummary {
  const rights = roles.filter(r => r.ownership_type !== "Credit" && scopeFilter.includes(r.scope || ""));
  const credits = roles.filter(r => r.ownership_type === "Credit" && scopeFilter.includes(r.scope || ""));
  const entered = rights.reduce((s, r) => s + (r.percent_share ?? 0), 0);
  const weighted = rights.reduce((s, r) => {
    const w = clearanceWeight[r.clearance_status ?? ""] ?? 0;
    return s + (r.percent_share ?? 0) * w;
  }, 0);
  return {
    enteredTotal: Math.round(entered * 100) / 100,
    weightedTotal: Math.round(weighted * 100) / 100,
    progress: entered > 0 ? Math.min(weighted / 100, 1) : 0,
    cleared: rights.length > 0 && entered >= 99.5 && weighted >= 99.5,
    rightsCount: rights.length,
    creditCount: credits.length,
    needsAttention: rights.length > 0 && (entered < 99.5 || entered > 100.5),
  };
}

export function RoleManager({
  workId,
  contacts,
  roles,
}: {
  workId: string;
  contacts: Array<{ id: string; name: string }>;
  roles: RoleRow[];
}) {
  const [mode, setMode] = useState<null | { type: "create" } | { type: "edit"; role: RoleRow }>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function onDelete(id: string) {
    if (!confirm("Delete this role? This will recompute clearance.")) return;
    setDeletingId(id);
    try {
      const res = await fetch("/api/roles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Failed"); }
      window.location.reload();
    } catch (err: any) { alert(err.message); setDeletingId(null); }
  }

  // Three boxes: Credits (all ownership_type=Credit), Publishing (Rights, scope=Publishing/Mechanical), Master (Rights, scope=Master)
  const creditRoles = roles.filter(r => r.ownership_type === "Credit");
  const pubRoles = roles.filter(r => r.ownership_type !== "Credit" && (r.scope === "Publishing" || r.scope === "Mechanical"));
  const masterRoles = roles.filter(r => r.ownership_type !== "Credit" && r.scope === "Master");
  const otherRoles = roles.filter(r => r.ownership_type !== "Credit" && r.scope !== "Publishing" && r.scope !== "Mechanical" && r.scope !== "Master");

  const pubSummary = computeScope(roles, ["Publishing", "Mechanical"]);
  const masterSummary = computeScope(roles, ["Master"]);
  const overallCleared = (pubSummary.cleared || pubRoles.length === 0) && (masterSummary.cleared || masterRoles.length === 0);
  const hasAnyRights = pubSummary.rightsCount > 0 || masterSummary.rightsCount > 0;
  const totalRoles = roles.length;

  function renderClearanceHeader(label: string, color: string, summary: ScopeSummary, rolesList: RoleRow[]) {
    const pct = Math.round(summary.progress * 100);
    return (
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full inline-block ${color}`} />
            {label}
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {rolesList.length > 0 ? (
              summary.cleared ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-bold"><Check className="h-3.5 w-3.5" />Cleared</span>
              ) : (
                <span className="text-muted-foreground">{pct}% confirmed</span>
              )
            ) : (
              <span className="text-muted-foreground italic">no rights lines</span>
            )}
            {summary.needsAttention && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium"
                title="Shares should sum to ~100%"><AlertTriangle className="h-3.5 w-3.5" />{summary.enteredTotal}%</span>
            )}
          </div>
        </div>
        {rolesList.length > 0 && (
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all ${summary.cleared ? "bg-green-500" : color}`}
              style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
        {rolesList.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {summary.rightsCount} rights line{summary.rightsCount === 1 ? "" : "s"} · entered {summary.enteredTotal}% · confirmed {summary.weightedTotal}%
          </p>
        )}
      </div>
    );
  }

  function renderRoleRow(r: RoleRow) {
    const isCredit = r.ownership_type === "Credit";
    return (
      <div key={r.id} className="flex items-center justify-between p-3 gap-3 hover:bg-accent/50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{r.role || "—"}</p>
            {r.contact_name && <p className="text-xs text-muted-foreground">{r.contact_name}</p>}
          </div>
          {!isCredit && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {r.ownership_type || "Rights"} · {r.percent_share ?? 0}%
            </p>
          )}
          {isCredit && (
            <p className="text-[10px] text-muted-foreground/60 italic mt-0.5">Name in booklet only — not a rights line</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isCredit ? (
            <span className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground italic">credit</span>
          ) : (
            <span className={`text-xs px-2 py-1 rounded font-medium ${badgeCls(r.clearance_status)}`}>
              {r.clearance_status || "Unknown"}
            </span>
          )}
          <Button onClick={() => setMode({ type: "edit", role: r })}
            className="text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            Edit
          </Button>
          <Button onClick={() => onDelete(r.id)} disabled={deletingId === r.id}
            className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors">
            {deletingId === r.id ? "…" : "Del"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Rights Lines ({totalRoles})</h2>
            {hasAnyRights && (
              overallCleared ? (
                <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-bold">
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />All Clear</span>
                </span>
              ) : (
                <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Pending clearance
                </span>
              )
            )}
          </div>
        </div>
        <Button onClick={() => setMode({ type: "create" })}
          className="inline-flex items-center px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-colors">
          <Plus className="mr-1.5 h-4 w-4" />
          Add role
        </Button>
      </div>

      {/* ── Credits (always first, separate box) ── */}
      {creditRoles.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
            Credits
            <span className="text-xs font-normal text-muted-foreground/60">({creditRoles.length} line{creditRoles.length === 1 ? "" : "s"})</span>
          </h3>
          <p className="text-xs text-muted-foreground/60 mb-2 italic">Name in booklet only — credits are not counted in clearance calculations.</p>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {creditRoles.map(renderRoleRow)}
          </div>
        </div>
      )}

      {creditRoles.length === 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
            Credits
            <span className="text-xs font-normal text-muted-foreground/60">(0)</span>
          </h3>
          <div className="bg-muted/30 border border-dashed border-border rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground">No credits yet. Add a role with Ownership = Credit.</p>
          </div>
        </div>
      )}

      {/* ── Publishing (Rights only) ── */}
      <div className="mb-4">
        {renderClearanceHeader("Publishing", "bg-blue-500", pubSummary, pubRoles)}
        {pubRoles.length > 0 ? (
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {pubRoles.map(renderRoleRow)}
          </div>
        ) : (
          <div className="bg-muted/30 border border-dashed border-border rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground">No publishing rights yet. Add a role with Scope = Publishing.</p>
          </div>
        )}
      </div>

      {/* ── Master (Rights only) ── */}
      <div className="mb-4">
        {renderClearanceHeader("Master", "bg-amber-500", masterSummary, masterRoles)}
        {masterRoles.length > 0 ? (
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {masterRoles.map(renderRoleRow)}
          </div>
        ) : (
          <div className="bg-muted/30 border border-dashed border-border rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground">No master rights yet. Add a role with Scope = Master.</p>
          </div>
        )}
      </div>

      {/* ── Other (rights with unrecognized scope) ── */}
      {otherRoles.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground inline-block" />
            Other
            <span className="text-xs font-normal text-muted-foreground/60">({otherRoles.length})</span>
          </h3>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {otherRoles.map(renderRoleRow)}
          </div>
        </div>
      )}

      {totalRoles === 0 && (
        <div className="bg-muted/30 border border-dashed border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">No rights lines yet. Add Publishing and Master roles to clear this work.</p>
        </div>
      )}

      {mode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMode(null)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">{mode.type === "edit" ? "Edit role" : "New role"}</h2>
            <RoleForm workId={workId} contacts={contacts} role={mode.type === "edit" ? mode.role : undefined} onClose={() => setMode(null)} />
          </div>
        </div>
      )}
    </section>
  );
}
