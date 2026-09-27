import { useEffect, useState } from "react";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import type { CampaignDocument } from "../../lib/campaign-rich-text";
import CommunicatorEditor from "./CommunicatorEditor";
import EnrichmentReview from "./EnrichmentReview";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
type Lead = CampaignOutreachWorkspaceData["leads"][number];

type Props = {
  lead: Lead;
  prompt: CampaignOutreachWorkspaceData["prompt"];
  canMutate: boolean;
  busyAction: string | null;
  aiUnavailable: boolean;
  onSavePrompt: (prompt: string) => void;
  onSuggestionDecision: (suggestionId: string, decision: "accepted" | "rejected") => void;
  onGenerateDraft: (instruction: string) => void;
  onSaveDraft: (draftId: string, subject: string | null, body: string, bodyDocument: CampaignDocument) => void;
  onApproveDraft: (draftId: string) => void;
  onUpdatePreparation: (changes: { contact_route?: string | null; contact_route_verified?: boolean; readiness_task_waiver_reason?: string | null }) => void;
  onRecordSent: (draftId: string, channel: string, sentAt: string, destination: string, followUpAt?: string | null) => void;
  onAiDecisionPending?: (pending: boolean) => void;
};

const STEPS = ["Research", "Review facts", "Draft", "Approve", "Record sent"];
const BLOCKER_LABELS: Record<string, string> = {
  contact_route: "Add contact route",
  contact_route_verified_at: "Verify contact route",
  exact_edit_or_update: "Select an exact edit",
  musical_fit: "Add musical fit",
  pitch_angle_or_batch: "Add pitch angle",
  introduction_state: "Record introduction state",
  approved_draft: "Approve a draft",
  task_or_reason: "Link a task or add a no-task reason",
};

export default function LeadWorkbench({ lead, prompt, canMutate, busyAction, aiUnavailable, onSavePrompt, onSuggestionDecision, onGenerateDraft, onSaveDraft, onApproveDraft, onUpdatePreparation, onRecordSent, onAiDecisionPending }: Props) {
  const [contactRoute, setContactRoute] = useState(lead.contact_route ?? "");
  const [waiverReason, setWaiverReason] = useState(lead.readiness_task_waiver_reason ?? "");
  useEffect(() => {
    setContactRoute(lead.contact_route ?? "");
    setWaiverReason(lead.readiness_task_waiver_reason ?? "");
  }, [lead.id, lead.contact_route, lead.readiness_task_waiver_reason]);
  return (
    <section aria-label="Focused lead workbench" className="min-w-0 px-0 lg:px-6">
      <header className="border-b border-border pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Focused outreach · {lead.pipeline_stage}</p>
        <h2 className="mt-1 text-2xl font-semibold">{lead.target_name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{lead.exact_edit_title || "Exact edit not selected"}</p>
        <ol aria-label="Focused outreach flow" className="mt-4 grid grid-cols-5 border-y border-border">
          {STEPS.map((step, index) => <li key={step} className="border-r border-border px-1 py-2 text-center text-[10px] font-medium last:border-r-0 sm:px-2 sm:text-xs"><span className="mr-1 text-[#4f6f9f]">{index + 1}</span>{step}</li>)}
        </ol>
      </header>

      <section aria-labelledby="ready-title" className="py-5">
        <div className="flex items-baseline justify-between gap-3"><h3 id="ready-title" className="font-semibold">Ready checklist</h3><span className="text-xs text-muted-foreground">{lead.ready_blockers.length ? `${lead.ready_blockers.length} blockers` : "Ready"}</span></div>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">{lead.ready_blockers.map((blocker) => <li key={blocker} className="text-xs text-muted-foreground">○ {BLOCKER_LABELS[blocker] || blocker.replaceAll("_", " ")}</li>)}</ul>
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium">Contact route<Input value={contactRoute} readOnly={!canMutate} onChange={(event) => setContactRoute(event.target.value)} className="mt-1 h-9 w-full border border-border bg-background px-3 text-sm" /></label>
            <div className="mt-2 flex flex-wrap gap-2"><Button type="button" disabled={!canMutate || Boolean(busyAction) || !contactRoute.trim() || contactRoute.trim() === (lead.contact_route ?? "")} onClick={() => onUpdatePreparation({ contact_route: contactRoute.trim() || null })} className="h-7 border border-border px-2 text-xs disabled:opacity-50">Save contact route</Button><Button type="button" disabled={!canMutate || Boolean(busyAction) || !lead.contact_route || Boolean(lead.contact_route_verified_at)} onClick={() => onUpdatePreparation({ contact_route_verified: true })} className="h-7 border border-border px-2 text-xs disabled:opacity-50">Verify current route</Button></div>
          </div>
          <div>
            <label className="block text-xs font-medium">No-task reason<Textarea placeholder="Why no linked task is needed" value={waiverReason} readOnly={!canMutate} onChange={(event) => setWaiverReason(event.target.value)} rows={2} className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm" /></label>
            <Button type="button" disabled={!canMutate || Boolean(busyAction) || waiverReason.trim().length < 10 || waiverReason.trim() === (lead.readiness_task_waiver_reason ?? "")} onClick={() => onUpdatePreparation({ readiness_task_waiver_reason: waiverReason.trim() || null })} className="mt-2 h-7 border border-border px-2 text-xs disabled:opacity-50">Save no-task reason</Button>
          </div>
        </div>
      </section>

      <div id="lead-research" className="scroll-mt-24"><EnrichmentReview leadId={lead.id} suggestions={lead.latest_suggestions} canMutate={canMutate} busy={busyAction === "suggestion"} onDecision={onSuggestionDecision} /></div>
      <div id="lead-drafting" className="scroll-mt-24"><div id="lead-follow-up" className="scroll-mt-24"><CommunicatorEditor key={lead.id} lead={lead} prompt={prompt} canMutate={canMutate} busy={Boolean(busyAction)} aiUnavailable={aiUnavailable} onSavePrompt={onSavePrompt} onGenerateDraft={onGenerateDraft} onSaveDraft={onSaveDraft} onApproveDraft={onApproveDraft} onRecordSent={onRecordSent} onAiDecisionPending={onAiDecisionPending} /></div></div>
    </section>
  );
}
