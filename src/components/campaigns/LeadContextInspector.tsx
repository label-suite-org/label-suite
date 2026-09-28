import { useEffect, useState } from "react";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import { CAMPAIGN_PIPELINE_STAGES } from "../../server/campaign-outreach-core";
import type { CampaignActivityItem, CampaignActivityProposal } from "../../server/campaign-activity-core";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Lead = CampaignOutreachWorkspaceData["leads"][number];

type Props = {
  lead: Lead;
  source: CampaignOutreachWorkspaceData["sources"][number] | null;
  activityItems: CampaignActivityItem[];
  pendingProposals: CampaignActivityProposal[];
  canMutate: boolean;
  busy: boolean;
  onOverrideStage: (stage: string, reason: string) => void;
  onLogFinding: (title: string, details: string, links: { draftId: string | null; researchRunId: string | null }) => void;
};

export default function LeadContextInspector({ lead, source, activityItems, pendingProposals, canMutate, busy, onOverrideStage, onLogFinding }: Props) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStage, setOverrideStage] = useState(lead.pipeline_stage);
  const [overrideReason, setOverrideReason] = useState("");
  const [findingOpen, setFindingOpen] = useState(false);
  const [findingTitle, setFindingTitle] = useState("");
  const [findingDetails, setFindingDetails] = useState("");
  const leadActivityItems = activityItems.filter((item) => item.refs.leadId === lead.id);
  const leadPendingProposals = pendingProposals.filter((proposal) => proposal.leadId === lead.id && proposal.state === "pending");
  useEffect(() => {
    setOverrideStage(lead.pipeline_stage);
    setOverrideReason("");
  }, [lead.id, lead.pipeline_stage]);
  return (
    <aside aria-label="Lead context" className="border-y border-border text-sm">
      <section className="py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Relationship</p>
        <dl className="mt-2 space-y-2 text-xs">
          <Row label="Recommender" value={lead.recommending_person || "Not recorded"} />
          <Row label="Introduction" value={lead.introduction_available === null ? "Unknown" : lead.introduction_available ? "Available" : "Not available"} />
          <Row label="Contact route" value={lead.contact_route || "Not recorded"} />
        </dl>
      </section>
      <section className="border-t border-border py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Provenance</p>
        <p className="mt-2 text-xs font-medium">{source?.title ?? lead.discovery_source}</p>
        <p className="mt-1 text-xs text-muted-foreground">{source?.authorization_note ?? "Research provenance only"}</p>
        {source?.url && <a href={source.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-[#4f6f9f] underline">Open source</a>}
      </section>
      <section className="border-t border-border py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Priority</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{lead.priority_score}<span className="text-sm font-normal text-muted-foreground">/10</span></p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs"><Row label="Warmth" value={`${lead.relationship_warmth}/3`} /><Row label="Fit" value={`${lead.editorial_fit}/3`} /><Row label="Reach" value={`${lead.useful_reach}/2`} /><Row label="Access" value={`${lead.direct_free_access}/2`} /></dl>
      </section>
      <section className="border-t border-border py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Links and tasks</p>
        {lead.target_url && <a href={lead.target_url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-[#4f6f9f] underline">Open target</a>}
        <div className="mt-2 space-y-2">{lead.tasks.map((task) => <p key={task.id} className="text-xs"><span className="font-medium">{task.task_name}</span><span className="block text-muted-foreground">{task.next_action || task.status}</span></p>)}{lead.tasks.length === 0 && <p className="text-xs text-muted-foreground">No linked task.</p>}</div>
      </section>
      <section className="border-t border-border py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recent activity</p>
        <ol className="mt-2 space-y-2">{leadActivityItems.slice(0, 6).map((item) => <li key={item.key} className="text-xs"><span className="font-medium">{item.title}</span>{item.occurredAt ? <time className="block text-muted-foreground" dateTime={new Date(item.occurredAt).toISOString()}>{formatDate(item.occurredAt)}</time> : <span className="block text-muted-foreground">Time unknown</span>}</li>)}{leadActivityItems.length === 0 && <li className="text-xs text-muted-foreground">No activity yet.</li>}</ol>
      </section>
      {leadPendingProposals.length > 0 && <section className="border-t border-border py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Pending recommendations</p><ul className="mt-2 space-y-2">{leadPendingProposals.map((proposal) => <li key={proposal.key} className="text-xs"><a href={proposal.href} className="font-medium underline underline-offset-2">{proposal.title}</a>{proposal.summary && <p className="mt-0.5 text-muted-foreground">{proposal.summary}</p>}</li>)}</ul></section>}
      <section className="border-t border-border py-4">
        <Button type="button" disabled={!canMutate || busy} onClick={() => setFindingOpen((open) => !open)} className="text-xs font-medium underline underline-offset-2 disabled:opacity-50">Log dogfood finding</Button>
        {findingOpen && <div className="mt-2 space-y-2"><Input placeholder="Finding title" value={findingTitle} onChange={(event) => setFindingTitle(event.target.value)} className="h-8 w-full border border-border bg-background px-2 text-xs" /><Textarea placeholder="What happened and what would help?" value={findingDetails} onChange={(event) => setFindingDetails(event.target.value)} rows={3} className="w-full border border-border bg-background px-2 py-1.5 text-xs" /><Button type="button" disabled={busy || !findingTitle.trim()} onClick={() => onLogFinding(findingTitle.trim(), findingDetails.trim(), activeContextLinks(lead))} className="h-7 border border-border px-2 text-xs disabled:opacity-50">Log linked finding</Button></div>}
      </section>
      <section className="border-t border-border py-4">
        <Button type="button" disabled={!canMutate || busy} onClick={() => setOverrideOpen((open) => !open)} className="text-xs font-medium underline underline-offset-2 disabled:opacity-50">Override stage</Button>
        {overrideOpen && <div className="mt-2 space-y-2"><NativeSelect aria-label="Override stage to" value={overrideStage} onChange={(event) => setOverrideStage(event.target.value as typeof overrideStage)} className="h-8 w-full border border-border bg-background px-2 text-xs">{CAMPAIGN_PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</NativeSelect><Textarea placeholder="Reason (at least 10 characters)" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={3} className="w-full border border-border bg-background px-2 py-1.5 text-xs" /><Button type="button" disabled={busy || overrideStage === lead.pipeline_stage || overrideReason.trim().length < 10} onClick={() => onOverrideStage(overrideStage, overrideReason)} className="h-7 border border-border px-2 text-xs disabled:opacity-50">Apply override</Button></div>}
      </section>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function activeContextLinks(lead: Lead) {
  const draft = [...lead.draft_versions].sort((left, right) => right.version - left.version)[0] ?? null;
  const suggestion = [...lead.latest_suggestions].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] ?? null;
  return { draftId: draft?.id ?? null, researchRunId: suggestion?.enrichment_run_id ?? null };
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}
