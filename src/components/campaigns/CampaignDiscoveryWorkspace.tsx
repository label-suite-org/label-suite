import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Workspace = {
  availability: { available: boolean; reason: string | null };
  query_preview: Array<{ query: string; enabled: boolean; editable: boolean }>;
  estimated_cost_units: number;
  runs: Run[];
};
type Run = {
  id: string;
  status: "completed" | "partial" | "failed";
  created_at: string;
  estimated_cost_units: number;
  queries: Array<{ query: string; enabled: boolean; status: "completed" | "failed" | "disabled"; error: string | null }>;
  channels: Channel[];
  exact_match_channels: Channel[];
  prospective_fit_channels: Channel[];
};
type ReviewState = "unreviewed" | "shortlisted" | "rejected" | "promoted";
type RejectionReason = "wrong_music" | "wrong_format" | "inactive" | "insufficient_evidence" | "duplicate" | "unsuitable_contact_model";
type Review = {
  state: ReviewState;
  reason: RejectionReason | null;
  actor_user_id: string | null;
  decided_at: string | null;
  revision: number;
  history: Array<{ state: ReviewState; reason: RejectionReason | null; actor_user_id: string | null; decided_at: string; revision: number }>;
  promoted_lead_id: string | null;
  promotion_outcome: "created" | "existing" | null;
  promoted_evidence: Array<{ provider_item_id: string; title: string; url: string; query: string; published_at: string; retrieved_at: string }>;
  prior_campaign_decisions: Array<{ campaign_id: string; state: ReviewState; reason: RejectionReason | null; decided_at: string | null }>;
};
type Evidence = { provider_item_id: string; title: string; url: string; query: string; published_at: string; retrieved_at: string };
type Channel = { provider_channel_id: string; title: string; url: string; evidence: Evidence[]; exact_match_evidence: Evidence[]; prospective_fit: { qualifies: boolean; signals: string[] }; activity_freshness: { state: "fresh" | "stale"; latest_activity_at: string | null; expires_at: string }; relevance: { exactness: number; editorial_fit: number; activity: number; evidence_strength: number; total: number }; review: Review };

const rejectionReasons: Array<{ value: RejectionReason; label: string }> = [
  { value: "wrong_music", label: "Wrong music" },
  { value: "wrong_format", label: "Wrong format" },
  { value: "inactive", label: "Inactive" },
  { value: "insufficient_evidence", label: "Insufficient evidence" },
  { value: "duplicate", label: "Duplicate" },
  { value: "unsuitable_contact_model", label: "Unsuitable contact model" },
];

export default function CampaignDiscoveryWorkspace({ campaignId, canMutate }: { campaignId: string; canMutate: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [queries, setQueries] = useState<Workspace["query_preview"]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    void fetch(`/api/campaigns/${campaignId}/discovery`)
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Workspace>; })
      .then((value) => { setWorkspace(value); setQueries(value.query_preview); })
      .catch(() => setNotice("Discovery could not be loaded."));
  }, [campaignId]);

  async function runDiscovery() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "run", queries: queries.map(({ query, enabled }) => ({ query, enabled })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Discovery failed");
      setWorkspace((current) => current ? { ...current, runs: [body as Run, ...current.runs] } : current);
      setNotice(`Discovery run ${body.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Discovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewCandidate(channelId: string, type: "shortlist" | "reject" | "reconsider" | "promote", expectedRevision: number, reason?: RejectionReason, evidenceIds?: string[]) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, channel_id: channelId, expected_revision: expectedRevision, ...(reason ? { reason } : {}), ...(evidenceIds ? { evidence_ids: evidenceIds } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Review failed");
      setWorkspace(body as Workspace);
      setQueries((body as Workspace).query_preview);
      setNotice(`Candidate ${type === "shortlist" ? "shortlisted" : type === "reconsider" ? "reopened" : "rejected"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  if (!workspace) return <p className="py-10 text-sm text-muted-foreground">{notice ?? "Loading discovery…"}</p>;
  return <section aria-label="Campaign discovery" className="space-y-8">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">YouTube research</p>
      <h2 className="mt-2 text-2xl font-semibold">Discovery</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Run a bounded, campaign-derived search and retain the evidence for review.</p>
    </header>
    {workspace.availability.available ? <div className="space-y-3">
      {queries.map((item, index) => <div key={index} className="flex items-center gap-3">
        <Input aria-label={`Enable query ${index + 1}`} type="checkbox" checked={item.enabled} disabled={!canMutate || busy} onChange={(event) => setQueries((current) => current.map((query, queryIndex) => queryIndex === index ? { ...query, enabled: event.target.checked } : query))} />
        <Input aria-label={`Discovery query ${index + 1}`} className="min-w-0 flex-1 border-b border-border bg-transparent px-1 py-2 text-sm" value={item.query} readOnly={!canMutate} disabled={busy} onChange={(event) => setQueries((current) => current.map((query, queryIndex) => queryIndex === index ? { ...query, query: event.target.value } : query))} />
      </div>)}
      <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground"><span>Estimated quota cost: {queries.filter(({ enabled }) => enabled).length * 100} units</span>{canMutate && <Button type="button" disabled={busy || !queries.some(({ enabled }) => enabled)} onClick={runDiscovery} className="border border-foreground px-4 py-2 font-semibold text-foreground disabled:opacity-50">{busy ? "Running…" : "Run discovery"}</Button>}</div>
    </div> : <p className="border-y border-border py-6 text-sm">{workspace.availability.reason}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={showRejected} onChange={(event) => setShowRejected(event.target.checked)} /> Show rejected candidates</label>
    <div className="space-y-8">{workspace.runs.map((run) => <article key={run.id} className="border-t border-border pt-5">
      <div className="flex justify-between gap-4"><h3 className="font-semibold capitalize">{run.status} run</h3><time className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString()}</time></div>
      {run.queries.some(({ status }) => status === "failed") && <ul className="mt-3 text-xs text-muted-foreground">{run.queries.filter(({ status }) => status === "failed").map((query) => <li key={query.query}>{query.query}: {query.error}</li>)}</ul>}
      <DiscoverySection campaignId={campaignId} title="Exact-match evidence" channels={run.exact_match_channels} evidenceFor={(channel) => channel.exact_match_evidence} canMutate={canMutate} busy={busy} showRejected={showRejected} onReview={reviewCandidate} />
      <DiscoverySection campaignId={campaignId} title="Prospective fit" channels={run.prospective_fit_channels} evidenceFor={(channel) => channel.evidence} showSignals canMutate={canMutate} busy={busy} showRejected={showRejected} onReview={reviewCandidate} />
    </article>)}</div>
  </section>;
}

function DiscoverySection({ campaignId, title, channels, evidenceFor, showSignals = false, canMutate, busy, showRejected, onReview }: { campaignId: string; title: string; channels: Channel[]; evidenceFor: (channel: Channel) => Channel["evidence"]; showSignals?: boolean; canMutate: boolean; busy: boolean; showRejected: boolean; onReview: (channelId: string, type: "shortlist" | "reject" | "reconsider" | "promote", expectedRevision: number, reason?: RejectionReason, evidenceIds?: string[]) => Promise<void> }) {
  const visibleChannels = channels.filter((channel) => showRejected || channel.review.state !== "rejected");
  return <section className="mt-6" aria-label={title}><h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h4>{visibleChannels.length ? <div className="mt-4 grid gap-6 md:grid-cols-2">{visibleChannels.map((channel) => <div key={channel.provider_channel_id}><div className="flex items-baseline justify-between gap-3"><a className="font-semibold underline" href={channel.url} target="_blank" rel="noreferrer">{channel.title}</a><span className="text-xs text-muted-foreground">Relevance {channel.relevance.total}</span></div>{showSignals && <p className="mt-1 text-xs text-muted-foreground">{channel.prospective_fit.signals.map(signalLabel).join(" · ")} · activity {channel.activity_freshness.state}</p>}<p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{channel.review.state}{channel.review.reason ? ` · ${signalLabel(channel.review.reason)}` : ""}</p>{channel.review.promoted_lead_id && <p className="mt-1 text-xs text-muted-foreground">Campaign Lead: <a className="underline" href={`/campaigns/${campaignId}?tab=outreach&lead=${encodeURIComponent(channel.review.promoted_lead_id)}`}>{channel.review.promoted_lead_id}</a> ({channel.review.promotion_outcome})</p>}<ul className="mt-2 space-y-2">{evidenceFor(channel).map((evidence) => <li key={`${evidence.query}:${evidence.url}`} className="text-sm"><a className="underline" href={evidence.url} target="_blank" rel="noreferrer">{evidence.title}</a><span className="mt-1 block text-xs text-muted-foreground">Found via “{evidence.query}”</span></li>)}</ul><details className="mt-2 text-xs text-muted-foreground"><summary>Why this order</summary><p className="mt-1">Exactness {channel.relevance.exactness}; editorial fit {channel.relevance.editorial_fit}; activity {channel.relevance.activity}; evidence strength {channel.relevance.evidence_strength}.</p></details><ReviewControls channel={channel} canMutate={canMutate} busy={busy} onReview={onReview} /></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No channels qualify in this section.</p>}</section>;
}

function ReviewControls({ channel, canMutate, busy, onReview }: { channel: Channel; canMutate: boolean; busy: boolean; onReview: (channelId: string, type: "shortlist" | "reject" | "reconsider" | "promote", expectedRevision: number, reason?: RejectionReason, evidenceIds?: string[]) => Promise<void> }) {
  const [reason, setReason] = useState<RejectionReason>("wrong_music");
  const [selectedEvidence, setSelectedEvidence] = useState(() => channel.evidence.map((evidence) => evidence.provider_item_id));
  if (!canMutate) return <p className="mt-3 text-xs text-muted-foreground">Review is read-only for your role.</p>;
  const revision = channel.review.revision;
  return <div className="mt-4 flex flex-wrap items-center gap-2">
    {channel.review.state === "unreviewed" && <Button type="button" disabled={busy} onClick={() => void onReview(channel.provider_channel_id, "shortlist", revision)} className="border border-foreground px-3 py-1 text-xs font-semibold disabled:opacity-50">Shortlist</Button>}
    {channel.review.state === "rejected" && <Button type="button" disabled={busy} onClick={() => void onReview(channel.provider_channel_id, "reconsider", revision)} className="border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50">Reconsider</Button>}
    {channel.review.state !== "rejected" && channel.review.state !== "promoted" && <><NativeSelect aria-label={`Reject reason for ${channel.title}`} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as RejectionReason)} className="border border-border bg-transparent px-2 py-1 text-xs">{rejectionReasons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect><Button type="button" disabled={busy} onClick={() => void onReview(channel.provider_channel_id, "reject", revision, reason)} className="border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50">Reject</Button></>}
    {(channel.review.state === "shortlisted" || channel.review.state === "promoted") && <div className="basis-full space-y-2"><p className="text-xs text-muted-foreground">Evidence to carry into the Campaign Lead</p>{channel.evidence.map((evidence) => <label key={evidence.provider_item_id} className="flex items-start gap-2 text-xs"><Input type="checkbox" checked={selectedEvidence.includes(evidence.provider_item_id)} disabled={busy} onChange={(event) => setSelectedEvidence((current) => event.target.checked ? [...current, evidence.provider_item_id] : current.filter((id) => id !== evidence.provider_item_id))} /><span>{evidence.title} <span className="text-muted-foreground">({evidence.query})</span></span></label>)}<Button type="button" disabled={busy || selectedEvidence.length === 0} onClick={() => void onReview(channel.provider_channel_id, "promote", revision, undefined, selectedEvidence)} className="border border-foreground px-3 py-1 text-xs font-semibold disabled:opacity-50">{channel.review.state === "promoted" ? "Promote again" : "Promote to Campaign Lead"}</Button></div>}
    {channel.review.history.length > 0 && <details className="basis-full text-xs text-muted-foreground"><summary>Review history ({channel.review.history.length})</summary><ul className="mt-1 space-y-1">{channel.review.history.map((entry) => <li key={`${entry.revision}:${entry.decided_at}`}>{entry.state}{entry.reason ? ` · ${signalLabel(entry.reason)}` : ""} · {new Date(entry.decided_at).toLocaleString()}</li>)}</ul></details>}
    {channel.review.prior_campaign_decisions.length > 0 && <details className="basis-full text-xs text-muted-foreground"><summary>Prior campaign decisions ({channel.review.prior_campaign_decisions.length})</summary><ul className="mt-1 space-y-1">{channel.review.prior_campaign_decisions.map((entry) => <li key={`${entry.campaign_id}:${entry.decided_at}`}>{entry.campaign_id}: {entry.state}{entry.reason ? ` · ${signalLabel(entry.reason)}` : ""}</li>)}</ul></details>}
  </div>;
}

function signalLabel(signal: string) {
  return signal.replaceAll("_", " ");
}
