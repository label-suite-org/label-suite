import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { FundingNeedView, FundingProjectView, GrantOpportunityView } from "./grants-workspace-ui";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const fieldClass = "mt-1 h-10 w-full border border-border bg-background px-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200";
const areaClass = `${fieldClass} h-auto min-h-24 py-2`;

function optionalText(value: string) {
  return value.trim() || null;
}

async function saveJson(url: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? result?.message ?? "The record could not be saved.");
  return result;
}

function ModalShell({ title, eyebrow, saving, error, onClose, onSubmit, children }: {
  title: string;
  eyebrow: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/35 p-3 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form onSubmit={onSubmit} className="my-auto w-full max-w-2xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between border-b border-border px-5 py-4 sm:px-7">
          <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold">{title}</h2></div>
          <Button variant="outline" type="button" onClick={onClose} disabled={saving} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-muted" aria-label={`Close ${title}`}><X className="size-4" /></Button>
        </div>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-5 sm:px-7">{children}{error && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}</div>
        <div className="flex justify-end gap-3 border-t border-border px-5 py-4 sm:px-7"><Button variant="outline" type="button" onClick={onClose} disabled={saving} className="h-10 border border-border px-4 text-sm font-medium hover:bg-muted">Cancel</Button><Button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60">{saving && <LoaderCircle className="size-4 animate-spin" />}{saving ? "Saving…" : "Save"}</Button></div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-muted-foreground">{label}{children}</label>;
}

export function GrantOpportunityModal({ opportunity, onClose, onSaved }: { opportunity?: GrantOpportunityView; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => ({
    name: opportunity?.name ?? "", funder: opportunity?.funder ?? "", program: opportunity?.program ?? "",
    category: opportunity?.purposes.join(", ") ?? "", applicantType: opportunity?.applicantType ?? "",
    status: opportunity?.status ?? "open", researchStatus: opportunity?.researchStatus ?? "research",
    description: opportunity?.description ?? "", researchSummary: opportunity?.researchSummary ?? "",
    eligibleUses: opportunity?.eligibleUses ?? "", assessmentBody: opportunity?.assessmentBody ?? "", responseTiming: opportunity?.responseTiming ?? "", rules: opportunity?.rules ?? "",
    requirements: opportunity?.requirements ?? "", deadline: opportunity?.deadline?.slice(0, 10) ?? "",
    opensOn: opportunity?.opensOn?.slice(0, 10) ?? "", maxAmount: opportunity?.maxAmount == null ? "" : String(opportunity.maxAmount),
    currency: opportunity?.currency ?? "DKK", officialUrl: opportunity?.officialUrl ?? "",
    researchUrl: opportunity?.researchSource ?? opportunity?.researchUrl ?? "", priority: opportunity?.priority ?? "medium", notes: opportunity?.notes ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await saveJson("/api/grants", opportunity ? "PUT" : "POST", {
        ...(opportunity ? { id: opportunity.id } : {}), name: form.name.trim(), funder: optionalText(form.funder),
        program: optionalText(form.program), category: optionalText(form.category), applicant_type: optionalText(form.applicantType),
        status: optionalText(form.status), research_status: optionalText(form.researchStatus),
        ...(!opportunity || opportunity.description !== undefined ? { description: optionalText(form.description) } : {}),
        eligible_uses: optionalText(form.eligibleUses), assessment_body: optionalText(form.assessmentBody), response_timing: optionalText(form.responseTiming), rules: optionalText(form.rules),
        research_summary: optionalText(form.researchSummary), requirements: optionalText(form.requirements), deadline: optionalText(form.deadline),
        opens_on: optionalText(form.opensOn), max_amount: form.maxAmount ? Number(form.maxAmount) : null, currency: optionalText(form.currency),
        url: optionalText(form.officialUrl), research_source: optionalText(form.researchUrl),
        ...(!opportunity || opportunity.priority !== undefined ? { priority: optionalText(form.priority) } : {}),
        ...(!opportunity || opportunity.notes !== undefined ? { notes: optionalText(form.notes) } : {}),
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The grant could not be saved."); setSaving(false); }
  };
  return <ModalShell title={opportunity ? "Edit grant" : "New grant"} eyebrow="Grant catalog" saving={saving} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Grant name"><Input required value={form.name} onChange={(e) => set("name", e.target.value)} className={fieldClass} /></Field><Field label="Funder"><Input value={form.funder} onChange={(e) => set("funder", e.target.value)} className={fieldClass} /></Field><Field label="Programme"><Input value={form.program} onChange={(e) => set("program", e.target.value)} className={fieldClass} /></Field><Field label="Purposes"><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="video, export, live" className={fieldClass} /></Field><Field label="Applicant type"><Input value={form.applicantType} onChange={(e) => set("applicantType", e.target.value)} className={fieldClass} /></Field><Field label="Priority"><NativeSelect value={form.priority} onChange={(e) => set("priority", e.target.value)} className={fieldClass}>{["low", "medium", "high", "urgent"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field><Field label="Status"><NativeSelect value={form.status} onChange={(e) => set("status", e.target.value)} className={fieldClass}>{["research", "planned", "open", "closed"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field><Field label="Research status"><NativeSelect value={form.researchStatus} onChange={(e) => set("researchStatus", e.target.value)} className={fieldClass}>{["research", "needs_verification", "verified", "archived"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field><Field label="Opens"><Input type="date" value={form.opensOn} onChange={(e) => set("opensOn", e.target.value)} className={fieldClass} /></Field><Field label="Deadline"><Input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} className={fieldClass} /></Field><Field label="Maximum amount"><Input type="number" min="0" value={form.maxAmount} onChange={(e) => set("maxAmount", e.target.value)} className={fieldClass} /></Field><Field label="Currency"><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className={fieldClass} /></Field><Field label="Official URL"><Input type="url" value={form.officialUrl} onChange={(e) => set("officialUrl", e.target.value)} className={fieldClass} /></Field><Field label="Research URL"><Input type="url" value={form.researchUrl} onChange={(e) => set("researchUrl", e.target.value)} className={fieldClass} /></Field></div>
    {!opportunity && <Field label="Description"><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className={areaClass} /></Field>}<Field label="Research summary"><Textarea value={form.researchSummary} onChange={(e) => set("researchSummary", e.target.value)} className={areaClass} /></Field><Field label="Eligible uses"><Textarea value={form.eligibleUses} onChange={(e) => set("eligibleUses", e.target.value)} className={areaClass} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Assessment body"><Textarea value={form.assessmentBody} onChange={(e) => set("assessmentBody", e.target.value)} className={areaClass} /></Field><Field label="Response timing"><Textarea value={form.responseTiming} onChange={(e) => set("responseTiming", e.target.value)} className={areaClass} /></Field></div><Field label="Eligibility and requirements"><Textarea value={form.requirements} onChange={(e) => set("requirements", e.target.value)} className={areaClass} /></Field><Field label="Rules"><Textarea value={form.rules} onChange={(e) => set("rules", e.target.value)} className={areaClass} /></Field>{!opportunity && <Field label="Internal notes"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={areaClass} /></Field>}
  </ModalShell>;
}

export function FundingNeedModal({ project, need, onClose, onSaved }: { project: FundingProjectView; need?: FundingNeedView; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => ({ title: need?.title ?? "", category: need?.category ?? "other", description: need?.description ?? "", targetAmount: need ? String(need.targetAmount) : "", priority: need?.priority ?? "medium", status: need?.status ?? "planned", neededBy: need?.neededBy?.slice(0, 10) ?? "", eligibility: need?.eligibility ?? "unknown", successMeasure: need?.successMeasure ?? "" }));
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => { event.preventDefault(); setSaving(true); setError(null); try { await saveJson("/api/funding-needs", need ? "PUT" : "POST", { ...(need ? { id: need.id } : {}), project_id: project.id, title: form.title.trim(), category: form.category, use_of_funds: optionalText(form.description), target_amount: form.targetAmount ? Number(form.targetAmount) : 0, needed_by: optionalText(form.neededBy), eligibility: form.eligibility, ...(!need || need.priority !== undefined ? { priority: form.priority } : {}), ...(!need || need.status !== undefined ? { status: form.status } : {}), ...(!need || need.successMeasure !== undefined ? { success_measure: optionalText(form.successMeasure) } : {}) }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The funding need could not be saved."); setSaving(false); } };
  return <ModalShell title={need ? "Edit funding need" : "New funding need"} eyebrow={project.name} saving={saving} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Need"><Input required value={form.title} onChange={(e) => set("title", e.target.value)} className={fieldClass} /></Field><Field label="Category"><NativeSelect value={form.category} onChange={(e) => set("category", e.target.value)} className={fieldClass}>{["production", "video", "pr", "ads", "travel", "export", "live", "content", "development", "other"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field><Field label={`Target amount (${project.currency})`}><Input type="number" min="0" required value={form.targetAmount} onChange={(e) => set("targetAmount", e.target.value)} className={fieldClass} /></Field><Field label="Needed by"><Input type="date" value={form.neededBy} onChange={(e) => set("neededBy", e.target.value)} className={fieldClass} /></Field>{(!need || need.priority !== undefined) && <Field label="Priority"><NativeSelect value={form.priority} onChange={(e) => set("priority", e.target.value)} className={fieldClass}>{["low", "medium", "high", "urgent"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field>}{(!need || need.status !== undefined) && <Field label="Status"><NativeSelect value={form.status} onChange={(e) => set("status", e.target.value)} className={fieldClass}>{["planned", "active", "funded", "cancelled"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></Field>}<Field label="Grant eligibility"><NativeSelect value={form.eligibility} onChange={(e) => set("eligibility", e.target.value as typeof form.eligibility)} className={fieldClass}>{["unknown", "grant_eligible", "mixed", "not_eligible"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</NativeSelect></Field></div>
    <Field label="Use of funds"><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className={areaClass} /></Field>{(!need || need.successMeasure !== undefined) && <Field label="Success measure"><Textarea value={form.successMeasure} onChange={(e) => set("successMeasure", e.target.value)} className={areaClass} /></Field>}
  </ModalShell>;
}
