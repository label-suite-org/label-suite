"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
type ReportSnapshot = {
  finalized_at: string;
  cost: { planned: number; committed: number; paid: number };
  deliverable_count: number;
  approved_deliverable_count: number;
  post_count: number;
  manual_metrics: Record<string, number>;
  creator_delivery?: Array<{ contact_name: string; status: string; deliverables: Array<{ description: string; approval_status: string; evidence_url: string | null }> }>;
  post_evidence?: Array<{ url: string; platform: string; published_at: string | null; metrics_captured_at: string | null; manual_metrics: Record<string, number>; notes: string | null }>;
  budget_lines?: Array<{ name: string; planned_amount: string | number | null; committed_amount: string | number | null; paid_amount: string | number | null }>;
};
type Workspace = {
  territories: Array<{ id: string; country_code: string }>;
  engagements: Array<{ id: string; contact_id: string; contact_name: string; status: string; relationship_notes: string | null; outreach_channel: string; outreach_permission_status: string; outreach_permission_basis: string | null; outreach_permission_recorded_at: string | null; outreach_permission_revoked_at: string | null; agreed_rate: number | null; agreed_currency: string | null; budget_line_id: string | null }>;
  deliverables: Array<{ id: string; engagement_id: string; description: string; due_date: string | null; approval_status: string; evidence_url: string | null; notes: string | null; updated_at: string | null }>;
  posts: Array<{ id: string; url: string; platform: string; published_at: string | null; metrics_captured_at: string | null; manual_metrics: Record<string, number> }>;
  budgetLineOptions?: Array<{ id: string; name: string; campaign_id: string | null }>;
  cost: { planned: number; committed: number; paid: number };
  report: { narrative: string | null; snapshot: ReportSnapshot | null; finalized_at: string | null };
};

type Props = { campaignId: string; section: "creators" | "posts" | "cost" | "report"; canMutate: boolean; canLinkBudget?: boolean; contacts: Array<{ id: string; name: string }> };

function metricsFromForm(form: FormData) {
  return Object.fromEntries(["views", "likes", "comments", "shares", "saves"].flatMap((name) => {
    const raw = String(form.get(name) ?? "").trim();
    return raw ? [[name, Number(raw)]] : [];
  }));
}

export default function CampaignOsWorkspace({ campaignId, section, canMutate, canLinkBudget = false, contacts }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState("");
  const [territories, setTerritories] = useState("");
  const load = async () => {
    const response = await fetch(`/api/campaigns/${campaignId}/os`);
    if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load Campaign OS");
    const data = await response.json();
    setWorkspace(data);
    setTerritories(data.territories.map((item: { country_code: string }) => item.country_code).join(", "));
  };
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [campaignId]);
  async function submit(action: string, input: unknown) {
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) });
    if (!response.ok) throw new Error((await response.json()).error ?? "Unable to save Campaign OS");
    await load();
  }
  function submitForm(action: string, buildInput: (form: FormData) => unknown) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      submit(action, buildInput(new FormData(form))).then(() => form.reset()).catch((reason) => setError(reason.message));
    };
  }
  if (error && !workspace) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!workspace) return <p className="text-sm text-muted-foreground">Loading Campaign OS…</p>;
  const deliverablesByEngagement = new Map<string, Workspace["deliverables"]>();
  for (const item of workspace.deliverables) deliverablesByEngagement.set(item.engagement_id, [...(deliverablesByEngagement.get(item.engagement_id) ?? []), item]);
  const budgetLineById = new Map((workspace.budgetLineOptions ?? []).map((line) => [line.id, line]));
  const liveMetrics = workspace.posts.reduce<Record<string, number>>((all, post) => {
    for (const [key, value] of Object.entries(post.manual_metrics ?? {})) all[key] = (all[key] ?? 0) + Number(value);
    return all;
  }, {});
  const snapshot = workspace.report.snapshot;
  return <div className="space-y-4">
    {section === "creators" ? <>
      <p className="text-sm text-muted-foreground">Creator engagements are campaign-local. Record permission before outreach; this workspace never sends email.</p>
      <Accordion className="space-y-2">{workspace.engagements.map((engagement) => <AccordionItem key={engagement.id} value={engagement.id} className="rounded-lg border px-3">
        <AccordionTrigger className="gap-3 no-underline hover:no-underline"><strong>{engagement.contact_name}</strong><span className="ml-auto text-xs font-normal text-muted-foreground">{engagement.status.replaceAll("_", " ")} · {engagement.outreach_permission_status.replaceAll("_", " ")} via {engagement.outreach_channel}</span></AccordionTrigger>
        <AccordionContent className="space-y-4 border-t pt-3">
          <Accordion>{(deliverablesByEngagement.get(engagement.id) ?? []).map((item) => <AccordionItem key={item.id} value={item.id} className="border-b">
            <AccordionTrigger className="flex-wrap gap-x-2 gap-y-0 no-underline hover:no-underline"><span className="min-w-0 flex-1">Deliverable: {item.description}</span><span className="order-3 w-full text-xs font-normal text-muted-foreground sm:order-none sm:w-auto">{item.approval_status.replaceAll("_", " ")}{item.due_date ? ` · due ${new Date(item.due_date).toLocaleDateString(undefined, { timeZone: "UTC" })}` : ""}</span></AccordionTrigger>
            <AccordionContent className="space-y-2">
              {item.evidence_url ? /^https?:\/\//i.test(item.evidence_url) ? <a href={item.evidence_url} target="_blank" rel="noopener noreferrer" className="break-all underline">View evidence</a> : <p className="break-all">Evidence: {item.evidence_url}</p> : null}
              {!canMutate && item.notes ? <p className="whitespace-pre-wrap">{item.notes}</p> : null}
              {canMutate ? <form key={item.updated_at ?? "legacy"} className="grid gap-2 pt-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit("update_deliverable", { id: item.id, expected_updated_at: item.updated_at ?? null, description: form.get("description"), due_date: form.get("due_date") ? new Date(String(form.get("due_date"))).toISOString() : null, approval_status: form.get("approval_status"), evidence_url: form.get("evidence_url") || null, notes: form.get("notes") || null }).catch((reason) => setError(reason.message)); }}>
                <label className="text-sm font-medium">Description<Input name="description" required defaultValue={item.description} /></label>
                <label className="text-sm font-medium">Due date<Input name="due_date" type="date" defaultValue={item.due_date?.slice(0, 10) ?? ""} /></label>
                <label className="text-sm font-medium">Approval<NativeSelect name="approval_status" defaultValue={item.approval_status}><option value="pending">Pending</option><option value="approved">Approved</option><option value="changes_requested">Changes requested</option><option value="rejected">Rejected</option></NativeSelect></label>
                <label className="text-sm font-medium">Evidence URL<Input name="evidence_url" type="url" defaultValue={item.evidence_url ?? ""} placeholder="https://" /></label>
                <label className="text-sm font-medium">Notes<Textarea name="notes" defaultValue={item.notes ?? ""} /></label>
                <Button type="submit" variant="outline">Save deliverable</Button>
              </form> : null}
            </AccordionContent>
          </AccordionItem>)}</Accordion>
          {canMutate && canLinkBudget ? <form key={engagement.budget_line_id ?? "none"} className="grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit("update_engagement", { id: engagement.id, budget_line_id: form.get("budget_line_id") || null }).catch((reason) => setError(reason.message)); }}>
            <label className="text-sm font-medium">Budget line<NativeSelect name="budget_line_id" defaultValue={engagement.budget_line_id ?? ""}><option value="">No Budget line</option>{(workspace.budgetLineOptions ?? []).map((line) => <option key={line.id} value={line.id}>{line.name}{line.campaign_id ? "" : " · unassigned"}</option>)}</NativeSelect></label>
            <Button type="submit" variant="outline">Save Budget link</Button>
          </form> : <p>Budget line: {engagement.budget_line_id ? budgetLineById.get(engagement.budget_line_id)?.name ?? "Unavailable" : "None linked"}</p>}
          {!canMutate && engagement.relationship_notes ? <p className="whitespace-pre-wrap">{engagement.relationship_notes}</p> : null}
          {!canMutate && engagement.agreed_rate !== null ? <p>Agreed rate: {engagement.agreed_rate} {engagement.agreed_currency ?? ""}</p> : null}
          <div className="text-muted-foreground">{engagement.outreach_permission_basis ? <p>Permission basis: {engagement.outreach_permission_basis}</p> : null}{engagement.outreach_permission_recorded_at ? <p>Recorded {new Date(engagement.outreach_permission_recorded_at).toLocaleString()}</p> : null}{engagement.outreach_permission_revoked_at ? <p>Revoked {new Date(engagement.outreach_permission_revoked_at).toLocaleString()}</p> : null}</div>
          {canMutate ? <>
            <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit("update_engagement", { id: engagement.id, status: form.get("status"), relationship_notes: form.get("notes") || null, agreed_rate: form.get("rate") || null, agreed_currency: form.get("currency") || null }).catch((reason) => setError(reason.message)); }}>
              <label className="text-sm font-medium">Relationship status<NativeSelect name="status" defaultValue={engagement.status}>{["identified", "qualified", "permission_confirmed", "contacted", "negotiating", "agreed", "delivering", "complete", "declined", "not_a_fit"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</NativeSelect></label>
              <label className="text-sm font-medium">Relationship notes<Textarea name="notes" defaultValue={engagement.relationship_notes ?? ""} /></label>
              <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm font-medium">Agreed rate<Input name="rate" type="number" min="0" step="0.01" defaultValue={engagement.agreed_rate ?? ""} /></label><label className="text-sm font-medium">Currency<Input name="currency" defaultValue={engagement.agreed_currency ?? ""} /></label></div>
              <Button type="submit" variant="outline">Save creator details</Button>
            </form>
            <form className="grid gap-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); const basis = String(new FormData(event.currentTarget).get("basis") ?? "").trim(); submit("update_engagement", { id: engagement.id, outreach_permission_status: "permitted", outreach_permission_basis: basis, outreach_permission_recorded_at: new Date().toISOString(), outreach_permission_revoked_at: null }).catch((reason) => setError(reason.message)); }}>
              <label className="text-sm font-medium">Permission basis<Input name="basis" required placeholder="How did this creator permit outreach?" /></label>
              <Button type="submit" variant="outline">{engagement.outreach_permission_status === "permitted" ? "Revise permission evidence" : "Record permission"}</Button>
            </form>
            {engagement.outreach_permission_status === "permitted" ? <Button type="button" variant="outline" onClick={() => submit("update_engagement", { id: engagement.id, outreach_permission_status: "revoked", outreach_permission_revoked_at: new Date().toISOString() }).catch((reason) => setError(reason.message))}>Revoke permission</Button> : null}
          </> : null}
        </AccordionContent>
      </AccordionItem>)}</Accordion>
      {canMutate ? <Accordion><AccordionItem value="add-creator" className="rounded-lg border px-3"><AccordionTrigger>Add creator engagement</AccordionTrigger><AccordionContent><form className="grid gap-2 pt-3" onSubmit={submitForm("create_engagement", (form) => ({ contact_id: form.get("contact_id"), outreach_channel: form.get("channel") || "email", outreach_permission_status: form.get("permission") || "unknown", outreach_permission_recorded_at: form.get("permission") === "permitted" ? new Date().toISOString() : null, outreach_permission_basis: form.get("basis") || null, agreed_rate: form.get("rate") || null, agreed_currency: form.get("currency") || null, relationship_notes: form.get("notes") || null }))}><label className="text-sm font-medium">Add existing Directory Contact</label><NativeSelect required name="contact_id" className="rounded border px-2 py-1"><option value="">Select contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</NativeSelect><Input name="channel" placeholder="Channel (email, DM, etc.)" className="rounded border px-2 py-1" /><NativeSelect name="permission" className="rounded border px-2 py-1"><option value="unknown">Permission unknown</option><option value="permitted">Record permission now</option><option value="do_not_contact">Do not contact</option></NativeSelect><Input name="basis" placeholder="Permission basis (required if permitted)" className="rounded border px-2 py-1" /><div className="grid grid-cols-2 gap-2"><Input name="rate" type="number" min="0" step="0.01" placeholder="Agreed rate" className="rounded border px-2 py-1" /><Input name="currency" placeholder="Currency (DKK)" className="rounded border px-2 py-1" /></div><Textarea name="notes" placeholder="Relationship notes" className="rounded border px-2 py-1" /><Button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Add Creator Engagement</Button></form></AccordionContent></AccordionItem></Accordion> : null}
      {canMutate && workspace.engagements.length ? <Accordion><AccordionItem value="add-deliverable" className="rounded-lg border px-3"><AccordionTrigger>Add deliverable</AccordionTrigger><AccordionContent>
        <form className="grid gap-2 pt-3" onSubmit={submitForm("create_deliverable", (form) => ({ engagement_id: form.get("engagement_id"), description: form.get("description"), due_date: form.get("due_date") ? new Date(String(form.get("due_date"))).toISOString() : null, approval_status: form.get("approval_status"), evidence_url: form.get("evidence_url") || null, notes: form.get("notes") || null }))}>
          <label className="text-sm font-medium">Creator<NativeSelect required name="engagement_id"><option value="">Select creator</option>{workspace.engagements.map((item) => <option key={item.id} value={item.id}>{item.contact_name}</option>)}</NativeSelect></label>
          <label className="text-sm font-medium">Description<Input required name="description" /></label>
          <label className="text-sm font-medium">Due date<Input name="due_date" type="date" /></label>
          <label className="text-sm font-medium">Approval<NativeSelect name="approval_status"><option value="pending">Pending</option><option value="approved">Approved</option><option value="changes_requested">Changes requested</option><option value="rejected">Rejected</option></NativeSelect></label>
          <label className="text-sm font-medium">Evidence URL<Input name="evidence_url" type="url" placeholder="https://" /></label>
          <label className="text-sm font-medium">Notes<Textarea name="notes" /></label>
          <Button type="submit" variant="outline">Add deliverable</Button>
        </form>
      </AccordionContent></AccordionItem></Accordion> : null}
    </> : null}
    {section === "posts" ? <><p className="text-sm text-muted-foreground">Metrics are manual captured observations. Campaign OS does not monitor or refresh social platforms.</p><div className="space-y-2">{workspace.posts.map((post) => <div key={post.id} className="rounded-lg border p-3 text-sm"><a className="underline" href={post.url} target="_blank" rel="noreferrer">{post.platform} post</a><p className="mt-1 text-muted-foreground">Published {post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { timeZone: "UTC" }) : "date unknown"} · Metrics captured {post.metrics_captured_at ? new Date(post.metrics_captured_at).toLocaleDateString(undefined, { timeZone: "UTC" }) : "date unknown"}</p><p className="mt-1 text-muted-foreground">Captured metrics: {Object.entries(post.manual_metrics).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}</p></div>)}</div>{canMutate ? <form className="grid gap-2 rounded-lg border p-3" onSubmit={submitForm("create_post", (form) => ({ url: form.get("url"), platform: form.get("platform"), published_at: form.get("published_at") ? new Date(String(form.get("published_at"))).toISOString() : null, metrics_captured_at: form.get("metrics_captured_at") ? new Date(String(form.get("metrics_captured_at"))).toISOString() : null, engagement_id: form.get("engagement_id") || null, manual_metrics: metricsFromForm(form), notes: form.get("notes") || null }))}><Input required name="url" type="url" placeholder="Post URL" className="rounded border px-2 py-1" /><Input required name="platform" placeholder="Platform" className="rounded border px-2 py-1" /><label className="text-sm">Published on<Input name="published_at" type="date" className="rounded border px-2 py-1" /></label><label className="text-sm">Metrics captured on<Input name="metrics_captured_at" type="date" className="rounded border px-2 py-1" /></label><NativeSelect name="engagement_id" className="rounded border px-2 py-1"><option value="">No creator linked</option>{workspace.engagements.map((item) => <option key={item.id} value={item.id}>{item.contact_name}</option>)}</NativeSelect><div className="grid grid-cols-2 gap-2">{["views", "likes", "comments", "shares", "saves"].map((name) => <Input key={name} name={name} type="number" min="0" placeholder={name} className="rounded border px-2 py-1" />)}</div><Textarea name="notes" placeholder="Notes" className="rounded border px-2 py-1" /><Button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Record post</Button></form> : null}</> : null}
    {section === "cost" ? <><div className="grid grid-cols-3 gap-3 text-center"><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Planned</p><strong>{workspace.cost.planned}</strong></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Committed</p><strong>{workspace.cost.committed}</strong></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Paid</p><strong>{workspace.cost.paid}</strong></div></div><p className="text-sm text-muted-foreground">Amounts come from linked Budget Lines. Campaign OS cannot mark a Creator Engagement paid.</p></> : null}
    {section === "report" ? <>
      <label className="block text-sm font-medium">Territories (two-letter ISO codes, separated by commas)</label>
      {canMutate ? <div className="flex gap-2"><Input value={territories} onChange={(event) => setTerritories(event.target.value)} className="flex-1" /><Button type="button" onClick={() => submit("set_territories", { country_codes: territories.split(",").map((value) => value.trim()).filter(Boolean) }).catch((reason) => setError(reason.message))}>Save</Button></div> : <p>{territories || "No territories recorded"}</p>}
      <p className="text-sm text-muted-foreground">Finalising saves a dated snapshot. The Campaign record can still change. Post metrics are manually captured observations; no platform monitoring occurs.</p>
      {workspace.report.finalized_at || snapshot ? <Card size="sm">
        <CardHeader><CardTitle>Finalised report · {new Date(workspace.report.finalized_at ?? snapshot!.finalized_at).toLocaleDateString()}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-wrap">{workspace.report.narrative}</p>
          {snapshot ? <><div className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
            <div><p className="font-medium">Saved at finalisation</p><p className="text-muted-foreground">Planned {snapshot.cost.planned} · Committed {snapshot.cost.committed} · Paid {snapshot.cost.paid}</p><p className="text-muted-foreground">Deliverables {snapshot.deliverable_count} · Approved {snapshot.approved_deliverable_count} · Posts {snapshot.post_count}</p><p className="text-muted-foreground">Manually captured metrics: {Object.entries(snapshot.manual_metrics).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}</p></div>
            <div><p className="font-medium">Current Campaign record</p><p className="text-muted-foreground">Planned {workspace.cost.planned} · Committed {workspace.cost.committed} · Paid {workspace.cost.paid}</p><p className="text-muted-foreground">Deliverables {workspace.deliverables.length} · Approved {workspace.deliverables.filter((item) => item.approval_status === "approved").length} · Posts {workspace.posts.length}</p><p className="text-muted-foreground">Manually captured metrics: {Object.entries(liveMetrics).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}</p></div>
          </div>
          <Accordion><AccordionItem value="evidence"><AccordionTrigger>Saved evidence at finalisation</AccordionTrigger><AccordionContent>
            {snapshot.post_evidence && snapshot.creator_delivery && snapshot.budget_lines ? <div className="space-y-3 text-muted-foreground">
              <div><p className="font-medium text-foreground">Creator delivery</p>{snapshot.creator_delivery.length ? snapshot.creator_delivery.map((creator, index) => <div key={index}><p>{creator.contact_name} · {creator.status}</p>{creator.deliverables.map((item, itemIndex) => <p key={itemIndex} className="pl-3">{item.description} · {item.approval_status}{item.evidence_url ? ` · Evidence: ${item.evidence_url}` : ""}</p>)}</div>) : <p>None recorded</p>}</div>
              <div><p className="font-medium text-foreground">Manual post observations</p>{snapshot.post_evidence.length ? snapshot.post_evidence.map((post, index) => <div key={index}><p>{post.platform} · {post.url}</p><p>Published {post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { timeZone: "UTC" }) : "date unknown"} · Metrics captured {post.metrics_captured_at ? new Date(post.metrics_captured_at).toLocaleDateString(undefined, { timeZone: "UTC" }) : "date unknown"}</p><p>Captured metrics: {Object.entries(post.manual_metrics ?? {}).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}</p>{post.notes ? <p>{post.notes}</p> : null}</div>) : <p>None recorded</p>}</div>
              <div><p className="font-medium text-foreground">Budget Lines</p>{snapshot.budget_lines.length ? snapshot.budget_lines.map((line, index) => <p key={index}>{line.name} · Planned {line.planned_amount ?? 0} · Committed {line.committed_amount ?? 0} · Paid {line.paid_amount ?? 0}</p>) : <p>None linked</p>}</div>
            </div> : <p className="text-muted-foreground">Item-level evidence was not saved with this older snapshot.</p>}
          </AccordionContent></AccordionItem></Accordion>
          </> : <p className="text-muted-foreground">No saved figures are available for this report.</p>}
        </CardContent>
      </Card> : null}
      {canMutate && !workspace.report.finalized_at && !snapshot ? <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); submit("finalize_report", { report }).catch((reason) => setError(reason.message)); }}><Textarea required value={report} onChange={(event) => setReport(event.target.value)} placeholder="Final report" className="min-h-32" /><Button type="submit">Finalise report</Button></form> : null}
    </> : null}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </div>;
}
