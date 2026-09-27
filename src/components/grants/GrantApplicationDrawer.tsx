import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { formatCoverageMoney } from "../funding/money";
import { uploadFileToStorage } from "../../lib/storage-client";
import { allocateAwardProportionally } from "../../server/grant-award-core";
import type {
  ApplicationRequirementView,
  ApplicationOutcome,
  FundingProjectView,
  GrantApplicationView,
  GrantOpportunityView,
  WorkflowStage,
  WorkspaceContactChoice,
  WorkspaceMemberChoice,
  GrantApplicationDocumentView,
} from "./grants-workspace-ui";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/external-url";
type ApplicationDrawerSeed = {
  application?: GrantApplicationView;
  opportunity?: GrantOpportunityView;
  projectId?: string;
};

type ApplicationForm = {
  projectId: string;
  opportunityId: string;
  workflowStage: WorkflowStage;
  outcome: ApplicationOutcome;
  priority: "low" | "medium" | "high" | "urgent";
  amountRequested: string;
  amountAwarded: string;
  nextAction: string;
  nextActionDue: string;
  submissionDeadline: string;
  submittedAt: string;
  decisionDate: string;
  reportingDue: string;
  ownerContactId: string;
  ownerUserId: string;
  angleNarrative: string;
  responseNotes: string;
  evaluation: string;
  nextStepRecommendation: string;
  sourceFolder: string;
  externalReference: string;
  notes: string;
};

const fieldClass = "mt-1 h-10 w-full border border-border bg-background px-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200";

const dateInputValue = (value: string | null | undefined) => value?.slice(0, 10) ?? "";

function initialForm(seed: ApplicationDrawerSeed): ApplicationForm {
  const { application, opportunity } = seed;
  return {
    projectId: application?.projectId ?? seed.projectId ?? opportunity?.matchingProjectIds[0] ?? "",
    opportunityId: application?.opportunityId ?? opportunity?.id ?? "",
    workflowStage: application?.workflowStage ?? "idea",
    outcome: application?.outcome ?? "unknown",
    priority: (application?.priority as ApplicationForm["priority"]) ?? "medium",
    amountRequested: application?.amountRequested ? String(application.amountRequested) : "",
    amountAwarded: application?.amountAwarded ? String(application.amountAwarded) : "",
    nextAction: application?.nextAction ?? "",
    nextActionDue: dateInputValue(application?.nextActionDue),
    submissionDeadline: dateInputValue(application?.applicationDeadline ?? opportunity?.deadline),
    submittedAt: dateInputValue(application?.submittedAt),
    decisionDate: dateInputValue(application?.decisionDate),
    reportingDue: dateInputValue(application?.reportingDue),
    ownerContactId: application?.ownerContactId ?? "",
    ownerUserId: application?.ownerUserId ?? "",
    angleNarrative: application?.angleNarrative ?? "",
    responseNotes: application?.responseNotes ?? "",
    evaluation: application?.evaluation ?? "",
    nextStepRecommendation: application?.nextStepRecommendation ?? "",
    sourceFolder: application?.sourceFolder ?? "",
    externalReference: application?.externalReference ?? "",
    notes: application?.notes ?? "",
  };
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

const DECIDED_OUTCOMES = new Set<ApplicationOutcome>(["approved", "partially_approved", "rejected"]);

export function validateNewApplication(form: Pick<ApplicationForm, "workflowStage" | "outcome">) {
  if (form.workflowStage !== "submitted") return "Choose Submitted as the workflow stage so this sent application appears in Application history.";
  if (!DECIDED_OUTCOMES.has(form.outcome)) return "Choose Approved, Partially approved, or Rejected so the application has a recorded decision.";
  return null;
}

export function GrantApplicationDrawer({
  seed,
  projects,
  opportunities,
  contacts = [],
  members = [],
  onClose,
  onSaved,
}: {
  seed: ApplicationDrawerSeed;
  projects: FundingProjectView[];
  opportunities: GrantOpportunityView[];
  contacts?: WorkspaceContactChoice[];
  members?: WorkspaceMemberChoice[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => initialForm(seed));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedApplicationId, setSavedApplicationId] = useState<string | null>(seed.application?.id ?? null);
  const [allocations, setAllocations] = useState<Record<string, { requested: string; awarded: string }>>(() => Object.fromEntries(
    (seed.application?.allocations ?? []).map((allocation) => [allocation.fundingNeedId, { requested: String(allocation.amountRequested || ""), awarded: String(allocation.amountAwarded || "") }]),
  ));
  const [requirements, setRequirements] = useState<ApplicationRequirementView[]>(() => seed.application?.checklist ?? []);
  const [reportPack, setReportPack] = useState<{
    awardAmount: number; spendToDate: number; remainingAward: number; projectName: string | null;
    receiptCompleteness: { paidLines: number; paidLinesWithReceipts: number; paidLinesWithoutReceipts: number };
    warnings: Array<{ message: string }>;
    lines: Array<{ id: string; name: string; category: string | null; planned: number; actual: number; variance: number; documents: Array<{ id: string }> }>;
  } | null>(null);
  const [loadingReportPack, setLoadingReportPack] = useState(false);
  const [evidence, setEvidence] = useState<GrantApplicationDocumentView[]>(() => seed.application?.documents ?? []);
  const [documentLibrary, setDocumentLibrary] = useState<Array<{ id: string; name: string; doc_type: string | null }>>([]);
  const [evidenceRole, setEvidenceRole] = useState("other");
  const editing = Boolean(seed.application);
  const title = editing ? "Edit application" : "Record sent application";
  const selectedOpportunity = useMemo(
    () => opportunities.find((opportunity) => opportunity.id === form.opportunityId),
    [form.opportunityId, opportunities],
  );
  const selectedProject = useMemo(() => projects.find((project) => project.id === form.projectId), [form.projectId, projects]);
  const allocationTotal = Object.values(allocations).reduce((total, allocation) => total + (Number(allocation.requested) || 0), 0);

  useEffect(() => {
    if (!selectedProject || !["approved", "partially_approved"].includes(form.outcome)) return;
    const awardAmount = Number(form.amountAwarded) || 0;
    if (awardAmount <= 0) return;
    setAllocations((current) => {
      const requested = selectedProject.needs
        .map((need) => ({ fundingNeedId: need.id, amountRequested: Number(current[need.id]?.requested ?? 0) }))
        .filter((need) => need.amountRequested > 0);
      if (!requested.length || requested.some((need) => Number(current[need.fundingNeedId]?.awarded ?? 0) > 0)) return current;
      const prefilled = allocateAwardProportionally(awardAmount, requested);
      return Object.fromEntries(selectedProject.needs.map((need) => [need.id, {
        requested: current[need.id]?.requested ?? "",
        awarded: String(prefilled.find((item) => item.fundingNeedId === need.id)?.amountAwarded ?? 0),
      }]));
    });
  }, [form.amountAwarded, form.outcome, selectedProject]);

  useEffect(() => {
    if (!savedApplicationId) return;
    void fetch(`/api/grant-applications/${savedApplicationId}/documents?library=1`).then((response) => response.ok ? response.json() : null).then((payload) => {
      if (payload) { setEvidence(payload.documents ?? []); setDocumentLibrary(payload.library ?? []); }
    }).catch(() => undefined);
  }, [savedApplicationId]);

  async function loadReportPack() {
    if (!savedApplicationId && !seed.application?.id) return;
    setLoadingReportPack(true);
    try {
      const response = await fetch(`/api/grant-applications/${savedApplicationId ?? seed.application?.id}/report-pack`);
      if (response.ok) setReportPack(await response.json());
    } finally {
      setLoadingReportPack(false);
    }
  }

  async function uploadEvidence(file: File) {
    if (!savedApplicationId) { setError("Save the application before adding evidence."); return; }
    const uploaded = await uploadFileToStorage(file, "unused", { type: "grant_application", id: savedApplicationId });
    const response = await fetch(`/api/grant-applications/${savedApplicationId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storage_key: uploaded.key, name: file.name, asset_role: evidenceRole, readiness_status: "draft" }) });
    if (!response.ok) throw new Error("Evidence could not be linked");
    const linked = await response.json() as { id: string; documentId: string };
    setEvidence((current) => [...current, { id: linked.id, documentId: linked.documentId, name: file.name, fileLink: uploaded.key, assetRole: evidenceRole, linkType: "attachment", required: false, readinessStatus: "draft", extractionStatus: null, extractionError: null, extractedTextPreview: null, extractionId: null, sourceHash: null }]);
  }

  async function linkEvidence(documentId: string) {
    if (!savedApplicationId) return;
    const response = await fetch(`/api/grant-applications/${savedApplicationId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_id: documentId, asset_role: evidenceRole, readiness_status: "draft" }) });
    if (!response.ok) throw new Error("Evidence could not be linked");
    const selected = documentLibrary.find((item) => item.id === documentId);
    const linked = await response.json() as { id: string; documentId: string };
    if (selected) setEvidence((current) => [...current, { id: linked.id, documentId: linked.documentId, name: selected.name, fileLink: null, assetRole: evidenceRole, linkType: "attachment", required: false, readinessStatus: "draft", extractionStatus: null, extractionError: null, extractedTextPreview: null, extractionId: null, sourceHash: null }]);
    setDocumentLibrary((current) => current.filter((item) => item.id !== documentId));
  }

  async function replaceEvidence(document: GrantApplicationDocumentView, file: File) {
    if (!savedApplicationId) return;
    const uploaded = await uploadFileToStorage(file, "unused", { type: "grant_application", id: savedApplicationId });
    const response = await fetch(`/api/grant-applications/${savedApplicationId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storage_key: uploaded.key, name: file.name, asset_role: document.assetRole, required: document.required, readiness_status: "draft", replace_link_id: document.id }) });
    if (!response.ok) throw new Error("Evidence could not be replaced");
    setEvidence((current) => current.map((item) => item.id === document.id ? { ...item, name: file.name, fileLink: uploaded.key, readinessStatus: "draft", extractionStatus: null, extractionError: null, extractedTextPreview: null, extractionId: null, sourceHash: null } : item));
  }

  async function unlinkEvidence(document: GrantApplicationDocumentView) {
    if (!savedApplicationId) return;
    const response = await fetch(`/api/grant-applications/${savedApplicationId}/documents`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link_id: document.id }) });
    if (!response.ok) throw new Error("Evidence could not be unlinked");
    setEvidence((current) => current.filter((item) => item.id !== document.id));
  }

  async function retryEvidence(document: GrantApplicationDocumentView) {
    if (!savedApplicationId) return;
    const response = await fetch(`/api/grant-applications/${savedApplicationId}/documents/${document.id}/extract`, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("Extraction could not be started");
    const result = await response.json() as { extraction: { status: string; error: string | null; extractedText: string | null; id: string; sourceHash: string } };
    setEvidence((current) => current.map((item) => item.id === document.id ? { ...item, extractionStatus: result.extraction.status, extractionError: result.extraction.error, extractedTextPreview: result.extraction.extractedText?.slice(0, 1000) ?? null, extractionId: result.extraction.id, sourceHash: result.extraction.sourceHash } : item));
  }

  async function openEvidence(document: GrantApplicationDocumentView) {
    if (!document.fileLink) return;
    const response = await fetch("/api/storage/download-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: document.fileLink }) });
    if (response.ok) { const payload = await response.json() as { url?: string }; if (payload.url) openExternalUrl(payload.url); }
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const setField = <Key extends keyof ApplicationForm>(key: Key, value: ApplicationForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (!editing) {
      const validationError = validateNewApplication(form);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/grant-applications", {
        method: savedApplicationId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(savedApplicationId ? { id: savedApplicationId } : {}),
          project_id: optionalText(form.projectId),
          grant_id: optionalText(form.opportunityId),
          workflow_stage: form.workflowStage,
          outcome: form.outcome,
          priority: form.priority,
          amount_requested: optionalNumber(form.amountRequested),
          amount_awarded: optionalNumber(form.amountAwarded),
          next_action: optionalText(form.nextAction),
          next_action_due: optionalText(form.nextActionDue),
          submission_deadline: optionalText(form.submissionDeadline),
          submitted_at: optionalText(form.submittedAt),
          decision_date: optionalText(form.decisionDate),
          reporting_due: optionalText(form.reportingDue),
          owner_contact_id: form.ownerUserId ? null : optionalText(form.ownerContactId),
          owner_user_id: optionalText(form.ownerUserId),
          angle_narrative: optionalText(form.angleNarrative),
          response_notes: optionalText(form.responseNotes),
          evaluation: optionalText(form.evaluation),
          next_step_recommendation: optionalText(form.nextStepRecommendation),
          source_folder: optionalText(form.sourceFolder),
          external_reference: optionalText(form.externalReference),
          notes: optionalText(form.notes),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(result?.error ?? result?.message ?? "The application could not be saved.");
      }
      const result = await response.json().catch(() => null) as { id?: string } | null;
      const applicationId = savedApplicationId ?? result?.id;
      if (applicationId) {
        setSavedApplicationId(applicationId);
        const allocationResponse = await fetch(`/api/grant-applications/${applicationId}/funding-needs`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allocations: Object.entries(allocations).filter(([, value]) => value.requested || value.awarded).map(([fundingNeedId, value]) => ({ funding_need_id: fundingNeedId, amount_requested: optionalNumber(value.requested) ?? 0, amount_awarded: optionalNumber(value.awarded) ?? 0 })) }),
        });
        if (!allocationResponse.ok) throw new Error((await allocationResponse.json().catch(() => null) as { error?: string } | null)?.error ?? "Funding allocations could not be saved.");
        if (requirements.length) {
          const requirementResponse = await fetch(`/api/grant-applications/${applicationId}/requirements`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirements: requirements.map((item) => ({ id: item.id.startsWith("inherited:") ? undefined : item.id, requirement_id: item.requirementId, document_id: item.documentId, required: item.required, readiness_status: item.readinessStatus, notes: item.notes })) }),
          });
          if (!requirementResponse.ok) throw new Error((await requirementResponse.json().catch(() => null) as { error?: string } | null)?.error ?? "Requirement readiness could not be saved.");
        }
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The application could not be saved.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <aside className="flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="application-drawer-title">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Grant application</p>
            <h2 id="application-drawer-title" className="mt-1 text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Record an application you sent and its final decision. Choose Submitted plus an outcome so it appears in Application history; leave dates blank when the source did not provide them.</p>
          </div>
          <Button variant="outline" type="button" onClick={onClose} disabled={saving} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="Close application drawer"><X className="size-4" /></Button>
        </div>

        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project">
                <NativeSelect value={form.projectId} onChange={(event) => { if (event.target.value !== form.projectId) setAllocations({}); setField("projectId", event.target.value); }} className={fieldClass} aria-label="Application project">
                  <option value="">No project linked</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Grant">
                <NativeSelect value={form.opportunityId} onChange={(event) => {
                  const opportunityId = event.target.value;
                  if (opportunityId !== form.opportunityId) setRequirements([]);
                  setField("opportunityId", opportunityId);
                  const opportunity = opportunities.find((item) => item.id === opportunityId);
                  if (!form.submissionDeadline && opportunity?.deadline) setField("submissionDeadline", dateInputValue(opportunity.deadline));
                }} className={fieldClass} aria-label="Application grant">
                  <option value="">No grant linked</option>
                  {opportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}
                </NativeSelect>
              </Field>
            </div>

            <Field label="Owner">
              <NativeSelect value={form.ownerUserId} onChange={(event) => { setField("ownerUserId", event.target.value); setField("ownerContactId", ""); }} className={fieldClass} aria-label="Application owner">
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
              </NativeSelect>
              {form.ownerContactId && !form.ownerUserId && <p className="mt-1 text-xs text-muted-foreground">Legacy owner: {contacts.find((contact) => contact.id === form.ownerContactId)?.name ?? seed.application?.ownerName ?? "Contact"}</p>}
            </Field>

            {selectedOpportunity && <p className="border-l-2 border-foreground pl-3 text-sm text-muted-foreground">{selectedOpportunity.funder || "Funder not recorded"}{selectedOpportunity.maxAmount == null ? "" : ` · Up to ${selectedOpportunity.maxAmount.toLocaleString()} ${selectedOpportunity.currency}`}</p>}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Workflow stage"><NativeSelect value={form.workflowStage} onChange={(event) => setField("workflowStage", event.target.value as WorkflowStage)} className={fieldClass}>{[["idea", "Idea"], ["research", "Research"], ["writing", "Writing"], ["ready_to_submit", "Ready to submit"], ["submitted", "Submitted"], ["decision_pending", "Awaiting decision"], ["reporting", "Reporting"], ["closed", "Closed"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field>
              <Field label="Outcome"><NativeSelect value={form.outcome} onChange={(event) => setField("outcome", event.target.value as ApplicationOutcome)} className={fieldClass}>{[["unknown", "No decision"], ["approved", "Approved"], ["partially_approved", "Partially approved"], ["rejected", "Rejected"], ["withdrawn", "Withdrawn"], ["not_qualified", "Not qualified"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field>
              <Field label="Priority"><NativeSelect value={form.priority} onChange={(event) => setField("priority", event.target.value as ApplicationForm["priority"])} className={fieldClass}>{["low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{value[0]?.toUpperCase() + value.slice(1)}</option>)}</NativeSelect></Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount requested"><Input type="number" min="0" step="0.01" value={form.amountRequested} onChange={(event) => setField("amountRequested", event.target.value)} className={fieldClass} /></Field>
              <Field label="Amount awarded"><Input type="number" min="0" step="0.01" value={form.amountAwarded} onChange={(event) => setField("amountAwarded", event.target.value)} className={fieldClass} /></Field>
            </div>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="funding-allocation-heading">
              <div className="flex items-end justify-between gap-4"><div><p id="funding-allocation-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Funding-need allocation</p><p className="mt-1 text-sm text-muted-foreground">Show exactly what this application asks the funder to cover.</p></div><p className="text-sm font-medium tabular-nums">{allocationTotal.toLocaleString()} allocated</p></div>
              {selectedProject ? selectedProject.needs.length ? <div className="divide-y divide-border border border-border">{selectedProject.needs.map((need) => { const value = allocations[need.id] ?? { requested: "", awarded: "" }; return <div key={need.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_130px_130px] sm:items-end"><div><p className="text-sm font-medium">{need.title}</p><p className="mt-1 text-xs text-muted-foreground">{need.remainingGap.toLocaleString()} {selectedProject.currency} gap</p></div><Field label="Requested"><Input type="number" min="0" value={value.requested} onChange={(event) => setAllocations((current) => ({ ...current, [need.id]: { ...value, requested: event.target.value } }))} className={fieldClass} /></Field><Field label="Awarded"><Input type="number" min="0" value={value.awarded} onChange={(event) => setAllocations((current) => ({ ...current, [need.id]: { ...value, awarded: event.target.value } }))} className={fieldClass} /></Field></div>; })}</div> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">This project has no funding needs yet. Add them from the Funding plan.</p> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">Choose a project to allocate this request.</p>}
              {allocationTotal > 0 && Number(form.amountRequested || 0) !== allocationTotal && <p className="text-xs text-amber-700">Allocated total does not match the application amount requested.</p>}
            </section>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="application-story-heading">
              <div><p id="application-story-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Application story & learning</p><p className="mt-1 text-sm text-muted-foreground">Keep the pitch, response, and reusable learning with the application.</p></div>
              <Field label="Angle / narrative"><Textarea value={form.angleNarrative} onChange={(event) => setField("angleNarrative", event.target.value)} rows={5} className={`${fieldClass} h-auto py-2`} /></Field>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Funder response"><Textarea value={form.responseNotes} onChange={(event) => setField("responseNotes", event.target.value)} rows={4} className={`${fieldClass} h-auto py-2`} /></Field><Field label="Internal evaluation"><Textarea value={form.evaluation} onChange={(event) => setField("evaluation", event.target.value)} rows={4} className={`${fieldClass} h-auto py-2`} /></Field></div>
              <Field label="Next-step recommendation"><Textarea value={form.nextStepRecommendation} onChange={(event) => setField("nextStepRecommendation", event.target.value)} rows={3} className={`${fieldClass} h-auto py-2`} /></Field>
            </section>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="requirement-readiness-heading">
              <div><p id="requirement-readiness-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Requirement readiness</p><p className="mt-1 text-sm text-muted-foreground">Track required material without hiding missing or stale items.</p></div>
              {requirements.length ? <div className="divide-y divide-border border border-border">{requirements.map((item, index) => <div key={item.id || `${item.requirementId}-${index}`} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_150px]"><div><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.requirementName || item.documentName || item.assetRole || "Application material"}</p>{item.required && <span className="text-[11px] text-amber-700">Required</span>}</div>{item.documentName && item.requirementName && <p className="mt-1 text-xs text-muted-foreground">Linked document: {item.documentName}</p>}<Input value={item.notes ?? ""} onChange={(event) => setRequirements((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value || null } : row))} placeholder="Checklist note" className={fieldClass} /></div><Field label="Readiness"><NativeSelect value={item.readinessStatus} onChange={(event) => setRequirements((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, readinessStatus: event.target.value as ApplicationRequirementView["readinessStatus"] } : row))} className={fieldClass}>{[["missing", "Missing"], ["stale", "Stale"], ["ready", "Ready"], ["not_required", "Not required"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field></div>)}</div> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No requirement checklist is linked yet. Save the application to inherit this grant’s requirements.</p>}
            </section>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="application-evidence-heading">
              <div><p id="application-evidence-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Application evidence</p><p className="mt-1 text-sm text-muted-foreground">Keep source-labeled material attached to this application. PDF extraction is bounded and can be retried.</p></div>
              <div className="grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)]"><NativeSelect value={evidenceRole} onChange={(event) => setEvidenceRole(event.target.value)} className={fieldClass} aria-label="Evidence role"><option value="submitted_application">Submitted application</option><option value="award_decision">Award-decision letter</option><option value="expense_documentation">Expense documentation</option><option value="other">Other</option></NativeSelect><label className="inline-flex h-10 cursor-pointer items-center border border-border px-3 text-sm">Upload evidence<Input type="file" accept=".pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidence(file).catch((error) => setError(error instanceof Error ? error.message : "Evidence upload failed")); }} /></label></div>
              {documentLibrary.length > 0 && <NativeSelect aria-label="Existing document picker" value="" onChange={(event) => { if (event.target.value) void linkEvidence(event.target.value).catch((error) => setError(error instanceof Error ? error.message : "Evidence link failed")); }} className={fieldClass}><option value="">Link existing organization document…</option>{documentLibrary.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</NativeSelect>}
              {evidence.length ? <div className="divide-y divide-border border border-border">{evidence.map((document) => <div key={document.id} className="space-y-2 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="text-xs text-muted-foreground">Source: {document.assetRole} · Readiness: {document.readinessStatus}</p></div>{document.fileLink && <Button variant="link" type="button" className="text-xs underline" onClick={() => void openEvidence(document)}>Open</Button>}<label className="cursor-pointer text-xs underline">Replace<Input type="file" accept=".pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceEvidence(document, file).catch((error) => setError(error instanceof Error ? error.message : "Evidence replace failed")); }} /></label><Button variant="link" type="button" className="text-xs underline" onClick={() => void retryEvidence(document)}>{document.extractionStatus === "failed" ? "Retry extraction" : "Extract PDF"}</Button><Button variant="link" type="button" className="text-xs text-red-600 underline" onClick={() => void unlinkEvidence(document).catch((error) => setError(error instanceof Error ? error.message : "Evidence unlink failed"))}>Unlink</Button></div>{document.extractionStatus === "failed" && <p className="text-xs text-red-700">Extraction failed: {document.extractionError ?? "Unknown error"}</p>}{document.extractionStatus === "pending" && <p className="text-xs text-amber-700">Extraction pending.</p>}{document.extractedTextPreview && <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{document.extractedTextPreview}</p>}</div>)}</div> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No evidence linked yet.</p>}
              {seed.application?.writingGuide && <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Writing guide</p>{seed.application.writingGuide.map((block) => <div key={block.title} className="border-l-2 border-border pl-3"><p className="text-sm font-medium">{block.title}</p><p className="text-xs text-muted-foreground">Source: {block.source} · {block.status}</p><p className="mt-1 whitespace-pre-wrap text-sm">{block.content}</p></div>)}</div>}
            </section>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="source-record-heading">
              <p id="source-record-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Source record</p>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Source folder"><Input value={form.sourceFolder} onChange={(event) => setField("sourceFolder", event.target.value)} placeholder="Drive or workspace folder" className={fieldClass} /></Field><Field label="External reference"><Input value={form.externalReference} onChange={(event) => setField("externalReference", event.target.value)} placeholder="Funder application ID" className={fieldClass} /></Field></div>
              <Field label="Internal notes"><Textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} className={`${fieldClass} h-auto py-2`} /></Field>
            </section>

            {editing && ["approved", "partially_approved"].includes(form.outcome) && (
              <section className="space-y-3 border-t border-border pt-5" aria-labelledby="reporting-pack-heading">
                <div className="flex items-start justify-between gap-4">
                  <div><p id="reporting-pack-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Funder reporting</p><p className="mt-1 text-sm text-muted-foreground">Spend, linked receipts, and restricted-use warnings for this award.</p></div>
                  <Button variant="outline" type="button" onClick={loadReportPack} disabled={loadingReportPack} className="h-9 border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{loadingReportPack ? "Loading…" : "Load report pack"}</Button>
                </div>
                {reportPack && <div className="space-y-3 border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-3"><Metric label="Award" value={formatCoverageMoney(reportPack.awardAmount, selectedProject?.currency ?? "DKK")} /><Metric label="Paid" value={formatCoverageMoney(reportPack.spendToDate, selectedProject?.currency ?? "DKK")} /><Metric label="Receipts" value={`${reportPack.receiptCompleteness.paidLinesWithReceipts}/${reportPack.receiptCompleteness.paidLines}`} /></div>
                  {reportPack.warnings.length > 0 && <div className="space-y-1 border-l-2 border-amber-500 pl-3 text-xs text-amber-800">{reportPack.warnings.map((warning, index) => <p key={`${warning.message}-${index}`}>{warning.message}</p>)}</div>}
                  <div className="divide-y divide-border border border-border text-xs">{reportPack.lines.map((line) => <div key={line.id} className="grid gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_100px_100px_100px]"><span>{line.name}<span className="ml-1 text-muted-foreground">{line.category ?? ""}</span></span><span className="tabular-nums">Plan {formatCoverageMoney(line.planned, selectedProject?.currency ?? "DKK")}</span><span className="tabular-nums">Paid {formatCoverageMoney(line.actual, selectedProject?.currency ?? "DKK")}</span><span className="tabular-nums">{line.documents.length} docs</span></div>)}</div>
                  <a href={`/api/grant-applications/${savedApplicationId ?? seed.application?.id}/report-pack?format=csv`} className="inline-flex h-9 items-center border border-border px-3 text-xs font-medium hover:bg-muted">Export CSV</a>
                </div>}
              </section>
            )}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Next action"><Input value={form.nextAction} onChange={(event) => setField("nextAction", event.target.value)} placeholder="What needs to happen next?" className={fieldClass} /></Field>
              <Field label="Action due"><Input type="date" value={form.nextActionDue} onChange={(event) => setField("nextActionDue", event.target.value)} className={fieldClass} /></Field>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Dates</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Submission deadline"><Input type="date" value={form.submissionDeadline} onChange={(event) => setField("submissionDeadline", event.target.value)} className={fieldClass} /></Field>
                <Field label="Submitted"><Input type="date" value={form.submittedAt} onChange={(event) => setField("submittedAt", event.target.value)} className={fieldClass} /></Field>
                <Field label="Expected decision"><Input type="date" value={form.decisionDate} onChange={(event) => setField("decisionDate", event.target.value)} className={fieldClass} /></Field>
                <Field label="Reporting due"><Input type="date" value={form.reportingDue} onChange={(event) => setField("reportingDue", event.target.value)} className={fieldClass} /></Field>
              </div>
            </div>

            {error && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 sm:px-7">
            <Button variant="outline" type="button" onClick={onClose} disabled={saving} className="h-10 border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancel</Button>
            <Button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60">{saving && <LoaderCircle className="size-4 animate-spin" />}{saving ? "Saving…" : editing ? "Save changes" : "Create application"}</Button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-muted-foreground">{label}{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-medium tabular-nums">{value}</p></div>;
}

export type { ApplicationDrawerSeed };
