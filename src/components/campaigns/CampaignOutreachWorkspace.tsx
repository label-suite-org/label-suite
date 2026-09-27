import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import { CAMPAIGN_PIPELINE_STAGES } from "../../server/campaign-outreach-core";
import type { CampaignDocument } from "../../lib/campaign-rich-text";
import { CampaignActivityLane } from "./CampaignActivityLane";
import {
  createCampaignActivityHttpAdapter,
  createCampaignActivityInteraction,
  type CampaignActivityDecision,
} from "./CampaignActivityInteraction";
import FocusedLeadQueue from "./FocusedLeadQueue";
import LeadContextInspector from "./LeadContextInspector";
import LeadWorkbench from "./LeadWorkbench";
import RadioUpdateWorkspace from "./RadioUpdateWorkspace";
import CampaignDiscoveryWorkspace from "./CampaignDiscoveryWorkspace";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
type Props = {
  initialData: CampaignOutreachWorkspaceData;
  initialLeadId?: string | null;
  canMutate: boolean;
  canPublish?: boolean;
};

type Lead = CampaignOutreachWorkspaceData["leads"][number];
type LeadContext = Pick<Lead, "draft_versions" | "ready_blockers" | "activity"> & { suggestions: Lead["latest_suggestions"] };
type CommunicatorContextResponse = { prompt: CampaignOutreachWorkspaceData["prompt"]; leads: Record<string, LeadContext> };

export default function CampaignOutreachWorkspace({ initialData, initialLeadId = null, canMutate, canPublish = false }: Props) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [prompt, setPrompt] = useState(initialData.prompt);
  const [leads, setLeads] = useState(initialData.leads);
  const [dogfood, setDogfood] = useState(initialData.dogfood);
  const [activityInteraction] = useState(() => createCampaignActivityInteraction({
    initialSnapshot: initialData.activity,
    adapter: createCampaignActivityHttpAdapter({ campaignId: initialData.campaign.id }),
  }));
  const activityState = useSyncExternalStore(
    activityInteraction.subscribe,
    activityInteraction.getState,
    activityInteraction.getState,
  );
  const { snapshot: activity, busyAction, notice } = activityState;
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [focusedAiDecisionPending, setFocusedAiDecisionPending] = useState(false);
  const [radioAiDecisionPending, setRadioAiDecisionPending] = useState(false);
  const [activeLane, setActiveLane] = useState<"focused" | "radio_update" | "discovery">("focused");
  const [selectedLeadId, setSelectedLeadId] = useState(() => (
    initialLeadId && initialData.leads.some((lead) => lead.id === initialLeadId)
      ? initialLeadId
      : initialData.queue.now[0]?.id ?? initialData.leads[0]?.id ?? null
  ));
  const [queueOpen, setQueueOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);
  const queue = useMemo(() => buildQueue(leads), [leads]);
  const selectedLead = useMemo(() => leads.find((lead) => lead.id === selectedLeadId) ?? leads[0] ?? null, [leads, selectedLeadId]);
  const source = selectedLead ? initialData.sources.find((candidate) => candidate.id === selectedLead.source_id) ?? null : null;
  const aiDecisionPending = focusedAiDecisionPending || radioAiDecisionPending;
  const selectLane = (lane: "focused" | "radio_update" | "discovery") => { if (!aiDecisionPending) setActiveLane(lane); };
  const showNotice = (message: string) => {
    const workflow = activityInteraction.beginWorkflow("notice");
    workflow.setNotice(message);
    workflow.finish();
  };

  async function savePrompt(value: string) {
    if (focusedAiDecisionPending) {
      showNotice("Wait for the AI suggestion decision before changing focused outreach.");
      return;
    }
    const workflow = activityInteraction.beginWorkflow("prompt");
    try {
      const saved = await apiRequest<NonNullable<CampaignOutreachWorkspaceData["prompt"]>>(`/api/campaigns/${initialData.campaign.id}/communicator-prompt`, "PUT", { prompt: value });
      if (!workflow.isCurrent()) return;
      setPrompt(saved);
      setLeads((current) => current.map((lead) => ({
        ...lead,
        updated_at: lead.pipeline_stage === "ready" ? null : lead.updated_at,
        pipeline_stage: lead.pipeline_stage === "ready" ? "qualified" : lead.pipeline_stage,
        draft_versions: lead.draft_versions.map((draft) => ({ ...draft, status: "superseded" as const })),
        ready_blockers: lead.ready_blockers.includes("approved_draft") ? lead.ready_blockers : [...lead.ready_blockers, "approved_draft"],
      })));
      workflow.setNotice(`Prompt version ${saved.version} saved; existing approvals were invalidated.`);
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not save the prompt"));
    } finally {
      workflow.finish();
    }
  }

  async function refreshLeadContext(leadId: string, applyBaseChanges?: (lead: Lead, context: LeadContext) => Partial<Lead>, workflow?: ReturnType<typeof activityInteraction.beginWorkflow>) {
    const context = await apiRequest<CommunicatorContextResponse>(`/api/campaigns/${initialData.campaign.id}/communicator-prompt`, "GET");
    const leadContext = context.leads[leadId];
    if (!leadContext) throw new Error("Updated lead context is unavailable");
    if (workflow && !workflow.isCurrent()) return;
    setPrompt(context.prompt);
    setLeads((current) => current.map((lead) => lead.id === leadId ? {
      ...lead,
      ...applyBaseChanges?.(lead, leadContext),
      latest_suggestions: latestSuggestions(leadContext.suggestions),
      draft_versions: leadContext.draft_versions,
      ready_blockers: leadContext.ready_blockers,
      activity: leadContext.activity,
    } : lead));
  }

  async function completeMutation(successNotice: string, workflow: ReturnType<typeof activityInteraction.beginWorkflow>, refreshBaseContext?: () => Promise<void>) {
    if (!workflow.isCurrent()) return;
    await workflow.refreshAfterMutation({ successNotice, refreshContext: refreshBaseContext });
  }

  async function decideActivityProposal(input: CampaignActivityDecision) {
    if (!canMutate || busyAction || focusedAiDecisionPending) return;
    return activityInteraction.decide(input);
  }

  async function decideSuggestion(suggestionId: string, decision: "accepted" | "rejected") {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead?.updated_at) {
      showNotice("Reload this lead before reviewing facts; its stale-state identity is missing.");
      return;
    }
    const workflow = activityInteraction.beginWorkflow("suggestion");
    try {
      await apiRequest(`/api/campaign-enrichment-suggestions/${suggestionId}`, "PATCH", {
        decision,
        expected_lead_updated_at: toIsoString(selectedLead.updated_at),
      });
      await completeMutation(`Fact ${decision}. Drafting context now uses only current accepted citations.`, workflow, () => refreshLeadContext(selectedLead.id, (lead, context) => {
        if (decision !== "accepted") return {};
        const accepted = context.suggestions.find((suggestion) => suggestion.id === suggestionId);
        const value = accepted?.suggested_value.value;
        return accepted && typeof value === "string" ? {
          [accepted.suggestion_type]: value,
          updated_at: accepted.updated_at,
          pipeline_stage: lead.pipeline_stage === "ready" ? "qualified" : lead.pipeline_stage,
        } as Partial<Lead> : {};
      }, workflow));
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not review the fact"));
    } finally {
      workflow.finish();
    }
  }

  async function generateDraft(instruction: string) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("generate");
    try {
      await apiRequest(`/api/campaign-leads/${selectedLead.id}/drafts`, "POST", {
        campaign_id: initialData.campaign.id,
        instruction: instruction.trim() || null,
      });
      await completeMutation("A new grounded draft version is ready for manual review.", workflow, () => refreshLeadContext(selectedLead.id, (lead) => ({ pipeline_stage: lead.pipeline_stage === "ready" ? "qualified" : lead.pipeline_stage }), workflow));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status >= 500 && workflow.isCurrent()) setAiUnavailable(true);
      workflow.setNotice(`${errorMessage(error, "Could not generate a draft")}. Manual editing remains available.`);
    } finally {
      workflow.finish();
    }
  }

  async function saveDraft(draftId: string, subject: string | null, body: string, bodyDocument: CampaignDocument) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("draft");
    try {
      await apiRequest(`/api/campaign-outreach-drafts/${draftId}`, "PATCH", { subject, body, body_document: bodyDocument });
      await completeMutation("Saved as a new draft version. Any earlier approval is no longer current.", workflow, () => refreshLeadContext(selectedLead.id, (lead) => ({ pipeline_stage: lead.pipeline_stage === "ready" ? "qualified" : lead.pipeline_stage }), workflow));
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not save the draft"));
    } finally {
      workflow.finish();
    }
  }

  async function approveDraft(draftId: string) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("approve");
    try {
      const result = await apiRequest<{ pipeline_stage: Lead["pipeline_stage"] }>(`/api/campaign-outreach-drafts/${draftId}/approve`, "POST", {});
      await completeMutation("Current draft approved. Record sent remains a separate manual action.", workflow, () => refreshLeadContext(selectedLead.id, (_lead, context) => ({ pipeline_stage: result.pipeline_stage, updated_at: latestContextTimestamp(context) ?? null }), workflow));
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not approve the draft"));
    } finally {
      workflow.finish();
    }
  }

  async function updatePreparation(changes: { contact_route?: string | null; contact_route_verified?: boolean; readiness_task_waiver_reason?: string | null }) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("preparation");
    try {
      const result = await apiRequest<Pick<Lead, "contact_route" | "contact_route_verified_at" | "readiness_task_waiver_reason">>(`/api/campaign-leads/${selectedLead.id}/preparation`, "PATCH", {
        campaign_id: initialData.campaign.id,
        ...changes,
      });
      await completeMutation("Lead preparation saved. Readiness was recalculated from current evidence.", workflow, () => refreshLeadContext(selectedLead.id, (_lead, context) => ({
        ...result,
        updated_at: latestContextTimestamp(context) ?? _lead.updated_at,
      }), workflow));
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not update lead preparation"));
    } finally {
      workflow.finish();
    }
  }

  async function overrideStage(pipelineStage: string, reason: string) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("stage");
    try {
      const result = await apiRequest<{ pipeline_stage: Lead["pipeline_stage"] }>(`/api/campaign-leads/${selectedLead.id}/stage-override`, "POST", {
        campaign_id: initialData.campaign.id,
        pipeline_stage: pipelineStage,
        reason: reason.trim(),
      });
      await completeMutation(`Stage overridden to ${result.pipeline_stage}; the reason is retained in activity.`, workflow, () => refreshLeadContext(selectedLead.id, (_lead, context) => ({ pipeline_stage: result.pipeline_stage, updated_at: latestContextTimestamp(context) ?? null }), workflow));
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not override the stage"));
    } finally {
      workflow.finish();
    }
  }

  async function logFinding(title: string, details: string, links: { draftId: string | null; researchRunId: string | null }) {
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("dogfood");
    try {
      const payload = {
        campaign_id: initialData.campaign.id,
        entry_type: "friction",
        severity: "P2",
        title,
        details: details || null,
        ui_surface: "Campaign → Outreach → Focused workbench",
        status: "logged",
        evidence_url: null,
        linked_lead_id: selectedLead.id,
        linked_draft_id: links.draftId,
        linked_enrichment_run_id: links.researchRunId,
        linked_page_revision_id: null,
      };
      const result = await apiRequest<{ id: string }>("/api/campaign-dogfood", "POST", payload);
      if (!workflow.isCurrent()) return;
      setDogfood((current) => [...current, {
        id: result.id,
        org_id: "",
        created_at: new Date(),
        updated_at: new Date(),
        ...payload,
      }]);
      workflow.setNotice("Dogfood finding logged with the active workbench context.");
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not log the finding"));
    } finally {
      workflow.finish();
    }
  }

  async function recordSent(draftId: string, channel: string, sentAt: string, destination: string, followUpAt?: string | null) {
    if (focusedAiDecisionPending) { showNotice("Wait for the AI suggestion decision before changing focused outreach."); return; }
    if (!selectedLead) return;
    const workflow = activityInteraction.beginWorkflow("record");
    try {
      const result = await apiRequest<Pick<Lead, "pipeline_stage" | "last_contacted_at" | "follow_up_at">>(`/api/campaign-leads/${selectedLead.id}/record-sent`, "POST", {
        campaign_id: initialData.campaign.id,
        approved_draft_id: draftId,
        channel,
        sent_at: sentAt,
        destination: destination || null,
        follow_up_at: followUpAt,
      });
      if (!workflow.isCurrent()) return;
      setLeads((current) => current.map((lead) => lead.id === selectedLead.id ? { ...lead, ...result, updated_at: null } : lead));
      await completeMutation("External send recorded. No message was delivered by Label Suite.", workflow);
    } catch (error) {
      workflow.setNotice(errorMessage(error, "Could not record the external send"));
    } finally {
      workflow.finish();
    }
  }

  async function logRadioFinding(links: { draftId: string | null; pageRevisionId: string | null }) {
    const workflow = activityInteraction.beginWorkflow("dogfood");
    try {
      const payload = { campaign_id: initialData.campaign.id, entry_type: "friction", severity: "P2", title: "Radio update lane review", details: "Operator reviewed the page and radio draft lane.", ui_surface: "Campaign → Outreach → Radio update", status: "logged", evidence_url: null, linked_lead_id: null, linked_draft_id: links.draftId, linked_enrichment_run_id: null, linked_page_revision_id: links.pageRevisionId };
      const result = await apiRequest<{ id: string }>("/api/campaign-dogfood", "POST", payload);
      if (!workflow.isCurrent()) return;
      setDogfood((current) => [...current, { id: result.id, org_id: "", created_at: new Date(), updated_at: new Date(), ...payload }]);
      workflow.setNotice("Radio lane finding logged with page revision and draft context.");
    } catch (error) { workflow.setNotice(errorMessage(error, "Could not log the radio finding")); }
    finally { workflow.finish(); }
  }

  const tabs = [{ id: "focused", label: "Focused" }, { id: "radio_update", label: "Radio update" }, { id: "discovery", label: "Discovery" }] as const;
  const selectedActivityItems = selectedLead ? activity.items.filter((item) => item.refs.leadId === selectedLead.id) : [];
  const selectedActivityProposals = selectedLead ? activity.proposals.filter((proposal) => proposal.leadId === selectedLead.id && proposal.state === "pending") : [];

  if (activeLane === "discovery") {
    return <fieldset disabled={!hydrated} className="min-w-0"><div role="tablist" aria-label="Outreach lanes" className="mb-6 flex gap-4 border-b border-border">{tabs.map((tab) => <Button variant="ghost" id={`outreach-tab-${tab.id === "radio_update" ? "radio" : tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeLane === tab.id} aria-controls={`outreach-panel-${tab.id === "radio_update" ? "radio" : tab.id}`} onClick={() => selectLane(tab.id)} className={`border-b-2 px-1 py-2 text-xs font-semibold ${activeLane === tab.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}>{tab.label}</Button>)}</div><div id="outreach-panel-discovery" role="tabpanel" aria-labelledby="outreach-tab-discovery"><CampaignDiscoveryWorkspace campaignId={initialData.campaign.id} canMutate={canMutate} /></div></fieldset>;
  }

  if (activeLane === "radio_update") {
    return <fieldset disabled={!hydrated} className="min-w-0"><div role="tablist" aria-label="Outreach lanes" className="mb-6 flex gap-4 border-b border-border">{tabs.map((tab) => <Button variant="ghost" id={`outreach-tab-${tab.id === "radio_update" ? "radio" : tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeLane === tab.id} aria-controls={`outreach-panel-${tab.id === "radio_update" ? "radio" : tab.id}`} disabled={aiDecisionPending} onClick={() => selectLane(tab.id)} className={`border-b-2 px-1 py-2 text-xs font-semibold ${activeLane === tab.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}>{tab.label}</Button>)}</div><div id="outreach-panel-radio" role="tabpanel" aria-labelledby="outreach-tab-radio"><RadioUpdateWorkspace campaignId={initialData.campaign.id} campaignName={initialData.campaign.name} initialData={initialData.radioUpdate} canMutate={canMutate} canPublish={canPublish} onDogfood={logRadioFinding} onAiDecisionPending={setRadioAiDecisionPending} /></div></fieldset>;
  }

  if (!selectedLead) return <fieldset disabled={!hydrated} className="min-w-0"><div role="tablist" aria-label="Outreach lanes" className="mb-6 flex gap-4 border-b border-border">{tabs.map((tab) => <Button variant="ghost" id={`outreach-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeLane === tab.id} aria-controls={`outreach-panel-${tab.id}`} disabled={aiDecisionPending} onClick={() => selectLane(tab.id)} className={`border-b-2 px-1 py-2 text-xs font-semibold ${activeLane === tab.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}>{tab.label}</Button>)}</div><div id="outreach-panel-focused" role="tabpanel" aria-labelledby="outreach-tab-focused"><p className="border-y border-border py-10 text-center text-sm text-muted-foreground">No focused outreach leads yet.</p></div><section className="mt-8 border-t border-border pt-8" aria-label="Campaign activity"><CampaignActivityLane snapshot={activity} canMutate={canMutate} disabled={Boolean(busyAction) || focusedAiDecisionPending} decisionPending={busyAction === "activity-decision"} feedback={activityState.feedback} onDecision={decideActivityProposal} /></section></fieldset>;

  return (
    <fieldset disabled={!hydrated} className="min-w-0">
      <div role="tablist" aria-label="Outreach lanes" className="mb-6 flex gap-4 border-b border-border">{tabs.map((tab) => <Button variant="ghost" id={`outreach-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeLane === tab.id} aria-controls={`outreach-panel-${tab.id}`} disabled={aiDecisionPending} onClick={() => selectLane(tab.id)} className={`border-b-2 px-1 py-2 text-xs font-semibold ${activeLane === tab.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}>{tab.label}</Button>)}</div>
      <div id="outreach-panel-focused" role="tabpanel" aria-labelledby="outreach-tab-focused">
      {notice && <p className="mb-4 border-y border-border py-2 text-xs" role="status">{notice}</p>}

      <details className="mb-4 border-y border-border lg:hidden">
        <summary className="cursor-pointer py-3 text-sm font-semibold">Queue</summary>
        <FocusedLeadQueue idPrefix="mobile" queue={queue} selectedLeadId={selectedLead.id} onSelectLead={setSelectedLeadId} disabled={focusedAiDecisionPending} />
      </details>

      <div className="grid grid-cols-1 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none lg:grid-cols-[var(--queue-width)_minmax(0,1fr)_var(--context-width)]" style={{ "--queue-width": queueOpen ? "220px" : "44px", "--context-width": contextOpen ? "280px" : "44px" } as React.CSSProperties}>
        <div className="hidden min-w-0 overflow-hidden border-r border-border pr-2 lg:block">
          <Button variant="ghost" size="icon-sm" aria-label={queueOpen ? "Collapse lead queue" : "Expand lead queue"} aria-expanded={queueOpen} aria-controls="focused-lead-queue" onClick={() => setQueueOpen(!queueOpen)} className="mb-2"><PanelLeftClose className={queueOpen ? "" : "hidden"} /><PanelLeftOpen className={queueOpen ? "hidden" : ""} /></Button>
          <div id="focused-lead-queue">{queueOpen && <FocusedLeadQueue idPrefix="desktop" queue={queue} selectedLeadId={selectedLead.id} onSelectLead={setSelectedLeadId} disabled={focusedAiDecisionPending} />}</div>
        </div>
        <LeadWorkbench lead={selectedLead} prompt={prompt} canMutate={canMutate} busyAction={focusedAiDecisionPending ? "ai-decision" : busyAction} aiUnavailable={aiUnavailable} onSavePrompt={savePrompt} onSuggestionDecision={decideSuggestion} onGenerateDraft={generateDraft} onSaveDraft={saveDraft} onApproveDraft={approveDraft} onUpdatePreparation={updatePreparation} onRecordSent={recordSent} onAiDecisionPending={setFocusedAiDecisionPending} />
        <div className="hidden min-w-0 overflow-hidden border-l border-border pl-2 lg:block">
          <Button variant="ghost" size="icon-sm" aria-label={contextOpen ? "Collapse lead context" : "Expand lead context"} aria-expanded={contextOpen} aria-controls="focused-lead-context" onClick={() => setContextOpen(!contextOpen)} className="mb-2"><PanelRightClose className={contextOpen ? "" : "hidden"} /><PanelRightOpen className={contextOpen ? "hidden" : ""} /></Button>
          <div id="focused-lead-context">{contextOpen && <LeadContextInspector lead={selectedLead} source={source} activityItems={selectedActivityItems} pendingProposals={selectedActivityProposals} canMutate={canMutate} busy={Boolean(busyAction) || focusedAiDecisionPending} onOverrideStage={overrideStage} onLogFinding={logFinding} />}</div>
        </div>
      </div>

      <details className="mt-4 border-y border-border lg:hidden">
        <summary className="cursor-pointer py-3 text-sm font-semibold">Lead context</summary>
        <LeadContextInspector lead={selectedLead} source={source} activityItems={selectedActivityItems} pendingProposals={selectedActivityProposals} canMutate={canMutate} busy={Boolean(busyAction) || focusedAiDecisionPending} onOverrideStage={overrideStage} onLogFinding={logFinding} />
      </details>

      <section className="mt-8 border-t border-border pt-8" aria-label="Campaign activity">
        <CampaignActivityLane snapshot={activity} canMutate={canMutate} disabled={Boolean(busyAction) || focusedAiDecisionPending} decisionPending={busyAction === "activity-decision"} feedback={activityState.feedback} onDecision={decideActivityProposal} />
      </section>

      <details className="mt-8 border-y border-border">
        <summary className="cursor-pointer py-3 text-sm font-semibold">Pipeline, sources and dogfood log</summary>
        <div className="border-t border-border py-5">
          <section aria-labelledby="secondary-pipeline-title">
            <h3 id="secondary-pipeline-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Full pipeline</h3>
            <div className="mt-2 grid grid-cols-4 border-y border-border lg:grid-cols-8">{CAMPAIGN_PIPELINE_STAGES.map((stage) => <div key={stage} className="border-r border-border px-2 py-2 last:border-r-0"><span className="block text-[10px] capitalize text-muted-foreground">{stage}</span><span className="text-base font-semibold tabular-nums">{leads.filter((lead) => lead.pipeline_stage === stage).length}</span></div>)}</div>
          </section>
          <section aria-labelledby="source-ledger-title" className="mt-6 border-t border-border pt-5">
            <h3 id="source-ledger-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Source ledger</h3>
            <div className="mt-2 divide-y divide-border border-y border-border">{initialData.sources.map((item) => <div key={item.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-[#4f6f9f] underline">{item.title}</a> : <span className="font-medium">{item.title}</span>}<span className="text-muted-foreground">{item.authorization_note || "Research and provenance only"}</span></div>)}</div>
          </section>
          <section aria-labelledby="dogfood-log-title" className="mt-6 border-t border-border pt-5">
            <h3 id="dogfood-log-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Campaign dogfooding log</h3>
            <div className="mt-2 divide-y divide-border border-y border-border">{dogfood.map((entry) => <div key={entry.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[36px_minmax(0,1fr)_90px]"><span className="font-semibold">{entry.severity}</span><span>{entry.title}</span><span className="capitalize text-muted-foreground">{entry.status.replaceAll("_", " ")}</span></div>)}{dogfood.length === 0 && <p className="py-3 text-xs text-muted-foreground">No findings logged.</p>}</div>
          </section>
        </div>
      </details>
      </div>
    </fieldset>
  );
}

async function apiRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as T & { error?: string; message?: string };
  if (!response.ok) throw new ApiRequestError(payload?.error || payload?.message || `Request failed (${response.status})`, response.status);
  return payload;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildQueue(leads: Lead[]): CampaignOutreachWorkspaceData["queue"] {
  const queue: CampaignOutreachWorkspaceData["queue"] = { now: [], followUp: [], waiting: [], completed: [] };
  const now = Date.now();
  for (const lead of leads) {
    if (["confirmed", "published", "nurture"].includes(lead.pipeline_stage)) queue.completed.push(lead);
    else if (lead.follow_up_at && new Date(lead.follow_up_at).getTime() <= now) queue.followUp.push(lead);
    else if (lead.pipeline_stage === "sent") queue.waiting.push(lead);
    else queue.now.push(lead);
  }
  queue.followUp.sort((left, right) => compareDate(left.follow_up_at, right.follow_up_at) || compareCurrent(left, right));
  queue.now.sort(compareCurrent);
  queue.waiting.sort(compareCurrent);
  queue.completed.sort(compareCurrent);
  return queue;
}

function compareCurrent(left: Lead, right: Lead) {
  return right.priority_score - left.priority_score || compareDate(left.last_contacted_at ?? left.updated_at, right.last_contacted_at ?? right.updated_at) || left.id.localeCompare(right.id);
}

function compareDate(left: string | Date | null, right: string | Date | null) {
  return (left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER) - (right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER);
}

function latestSuggestions(suggestions: Lead["latest_suggestions"]) {
  const latest = new Map<string, Lead["latest_suggestions"][number]>();
  for (const suggestion of [...suggestions].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())) {
    if (!latest.has(suggestion.suggestion_type)) latest.set(suggestion.suggestion_type, suggestion);
  }
  return [...latest.values()];
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function latestContextTimestamp(context: LeadContext) {
  const latest = context.activity.reduce<string | Date | null>((current, event) => {
    if (!current || new Date(event.occurred_at).getTime() > new Date(current).getTime()) return event.occurred_at;
    return current;
  }, null);
  return latest ? new Date(latest) : null;
}
