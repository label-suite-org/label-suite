"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatCoverageMoney } from "../funding/money";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface Source {
  id: string; name: string; type: string; status: string;
  amount_planned: number | null; amount_confirmed: number | null;
  restricted_to: string | null; notes: string | null;
}
export default function FundingStack({ sources, onAdd, onChanged, currency = "DKK" }: {
  sources: Source[]; onAdd?: () => void; onChanged?: () => void; currency?: string;
}) {
  const income = sources.filter(source => source.type !== "grant" && !["rejected", "cancelled"].includes(source.status));
  const grantPlans = sources.filter(source => source.type === "grant" && !["rejected", "cancelled"].includes(source.status) && ((source.amount_planned ?? 0) > 0 || (source.amount_confirmed ?? 0) > 0));
  const other = sources.filter(source => !income.includes(source) && !grantPlans.includes(source));
  return <section className="min-w-0 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Income and grant applications</h2><p className="mt-1 text-sm text-muted-foreground">Amounts planned for this project in {currency}. Receipt is not verified here.</p></div>{onAdd && <Button variant="outline" onClick={onAdd} className="rounded-md border border-border px-3 py-2 text-sm">Add source</Button>}</div>
    <h3 className="mt-4 text-sm font-medium">Expected income</h3>
    {income.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No income forecast recorded.</p>}
    <ul className="divide-y divide-border">{income.map(source => <SourceCard key={source.id} source={source} currency={currency} onChanged={onChanged} />)}</ul>
    <h3 className="mt-4 text-sm font-medium">Grants · plans and applications</h3>
    <p className="mt-1 text-xs text-muted-foreground">An award is not a bank receipt. Check scope, payment and eligibility in the grant details.</p>
    {grantPlans.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No grant amounts planned.</p>}
    <ul className="divide-y divide-border">{grantPlans.map(source => <SourceCard key={source.id} source={source} currency={currency} onChanged={onChanged} />)}</ul>
    {other.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm">Other funding ideas and closed sources · {other.length}</summary><ul className="divide-y divide-border">{other.map(source => <SourceCard key={source.id} source={source} currency={currency} onChanged={onChanged} />)}</ul></details>}
    <a href="/grants" className="mt-3 inline-block text-sm underline">Manage applications and grant decisions</a>
  </section>;
}

function SourceCard({ source, currency, onChanged }: { source: Source; currency: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = ["confirmed", "granted"].includes(source.status);
  async function transition(status: string, notes?: string) {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/funding-sources/${source.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, notes: notes || null }) });
      if (!response.ok) throw new Error("Could not update funding status. Please try again.");
      setOpen(false); onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update funding status."); }
    finally { setSaving(false); }
  }
  return <li className="min-w-0 py-3">
    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{source.name}</span><span className="tabular-nums">{formatCoverageMoney(confirmed ? source.amount_confirmed ?? source.amount_planned ?? 0 : source.amount_planned ?? 0, currency)} <span className="text-xs text-muted-foreground">{["rejected", "cancelled"].includes(source.status) ? source.status : source.type === "grant" ? confirmed ? "award / receipt unverified" : source.status === "applied" ? "applied" : "not awarded" : "forecast"}</span></span></div>
    {(source.restricted_to || source.type === "grant") && <p className="mt-2 text-sm">{source.restricted_to || "Grant scope needs checking."}</p>}
    {source.notes && <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">Source notes</summary><p className="mt-2 whitespace-pre-line break-words">{source.notes}</p></details>}
    {onChanged && source.type === "grant" && <Button onClick={() => setOpen(true)} className="mt-2 text-sm underline">Status and history</Button>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {open && <StatusTransitionModal source={source} grantSteps={["research", "pending", "applied", "granted"]} onTransition={transition} onClose={() => setOpen(false)} saving={saving} />}
  </li>;
}
function StatusTransitionModal({
  source,
  grantSteps,
  onTransition,
  onClose,
  saving,
}: {
  source: Source;
  grantSteps: string[];
  onTransition: (status: string, note?: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const currentIdx = grantSteps.indexOf(source.status);
  const availableTransitions: { status: string; label: string }[] = [];

  if (currentIdx < grantSteps.length - 1) {
    for (let i = currentIdx + 1; i < grantSteps.length; i++) {
      availableTransitions.push({ status: grantSteps[i], label: grantSteps[i] });
    }
  }
  availableTransitions.push({ status: "rejected", label: "Rejected" });

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/funding-sources/${source.id}/history`);
      if (res.ok) setHistory(await res.json());
    } finally {
      setLoadingHistory(false);
      setShowHistory(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Funding status and history: ${source.name}`} className="bg-card border border-border rounded-xl p-5 w-full max-w-sm mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h4 className="font-semibold mb-3">Log decision — {source.name}</h4>

        <div className="flex items-center gap-1 mb-4 text-[10px]">
          {grantSteps.map((step) => {
            const idx = grantSteps.indexOf(step);
            const isPast = idx <= currentIdx;
            const isCurrent = step === source.status;
            return (
              <div key={step} className="flex items-center gap-1">
                <span className={`px-1.5 py-0.5 rounded ${isCurrent ? "bg-foreground text-background font-bold" : isPast ? "opacity-40" : "opacity-20"}`}>
                  {step}
                </span>
                {idx < grantSteps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            );
          })}
          <span className={`px-1.5 py-0.5 rounded ${source.status === "rejected" ? "bg-red-700 text-white" : "opacity-20"}`}>
            rejected
          </span>
        </div>

        <label className="block text-xs text-muted-foreground mb-1">New status</label>
        <NativeSelect
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm mb-3"
        >
          <option value="">Select…</option>
          {availableTransitions.map((t) => (
            <option key={t.status} value={t.status}>{t.label}</option>
          ))}
        </NativeSelect>

        <label className="block text-xs text-muted-foreground mb-1">Note (optional)</label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm mb-3 resize-none"
          placeholder="e.g., Applied via KODA portal on 2027-03-15"
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              onClick={() => onTransition(selectedStatus, note)}
              disabled={!selectedStatus || saving}
              className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={onClose} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-muted">
              Cancel
            </Button>
          </div>
          <Button variant="ghost" onClick={loadHistory} className="text-xs text-muted-foreground hover:text-foreground">
            {loadingHistory ? "…" : "History"}
          </Button>
        </div>

        {showHistory && (
          <div className="mt-3 border-t border-border pt-3 max-h-40 overflow-y-auto">
            <h5 className="text-xs font-medium text-muted-foreground mb-1">Status history</h5>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events recorded.</p>
            ) : (
              <ul className="space-y-1">
                {history.map((ev: any) => (
                  <li key={ev.id} className="text-xs">
                    <span className="text-muted-foreground">{ev.occurred_at ? new Date(ev.occurred_at).toLocaleDateString() : ""}</span>{" "}
                    {ev.from_status ?? "(start)"} <ArrowRight className="inline h-3 w-3" /> <span className="font-medium">{ev.to_status}</span>
                    {ev.note ? ` — ${ev.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
