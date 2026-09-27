"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Workspace = {
  territories: Array<{ id: string; country_code: string }>;
  engagements: Array<{ id: string; contact_id: string; contact_name: string; status: string; outreach_channel: string; outreach_permission_status: string; outreach_permission_basis: string | null; agreed_rate: number | null; agreed_currency: string | null; budget_line_id: string | null }>;
  deliverables: Array<{ id: string; engagement_id: string; description: string; approval_status: string; evidence_url: string | null }>;
  posts: Array<{ id: string; url: string; platform: string; published_at: string | null; manual_metrics: Record<string, number> }>;
  cost: { planned: number; committed: number; paid: number };
};

type Props = { campaignId: string; section: "creators" | "posts" | "cost" | "report"; canMutate: boolean; contacts: Array<{ id: string; name: string }>; finalReport?: string | null; finalizedAt?: string | null };

function metricsFromForm(form: FormData) {
  return Object.fromEntries(["views", "likes", "comments", "shares", "saves"].flatMap((name) => {
    const raw = String(form.get(name) ?? "").trim();
    return raw ? [[name, Number(raw)]] : [];
  }));
}

export default function CampaignOsWorkspace({ campaignId, section, canMutate, contacts, finalReport, finalizedAt }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState(finalReport ?? "");
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
  return <div className="space-y-4">
    {section === "creators" ? <>
      <p className="text-sm text-muted-foreground">Creator engagements are campaign-local. Record permission before outreach; this workspace never sends email.</p>
      <div className="space-y-2">{workspace.engagements.map((engagement) => <div key={engagement.id} className="rounded-lg border p-3 text-sm"><strong>{engagement.contact_name}</strong><span className="ml-2 text-muted-foreground">{engagement.status} · {engagement.outreach_permission_status} via {engagement.outreach_channel}</span>{engagement.outreach_permission_basis ? <p className="mt-1 text-muted-foreground">Permission basis: {engagement.outreach_permission_basis}</p> : null}{(deliverablesByEngagement.get(engagement.id) ?? []).map((item) => <p key={item.id} className="mt-1">Deliverable: {item.description} · {item.approval_status}</p>)}</div>)}</div>
      {canMutate ? <form className="grid gap-2 rounded-lg border p-3" onSubmit={submitForm("create_engagement", (form) => ({ contact_id: form.get("contact_id"), outreach_channel: form.get("channel") || "email", outreach_permission_status: form.get("permission") || "unknown", outreach_permission_basis: form.get("basis") || null, agreed_rate: form.get("rate") || null, agreed_currency: form.get("currency") || null, relationship_notes: form.get("notes") || null }))}><label className="text-sm font-medium">Add existing Directory Contact</label><NativeSelect required name="contact_id" className="rounded border px-2 py-1"><option value="">Select contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</NativeSelect><Input name="channel" placeholder="Channel (email, DM, etc.)" className="rounded border px-2 py-1" /><NativeSelect name="permission" className="rounded border px-2 py-1"><option value="unknown">Permission unknown</option><option value="permitted">Permission recorded</option><option value="do_not_contact">Do not contact</option></NativeSelect><Input name="basis" placeholder="Permission basis (required if permitted)" className="rounded border px-2 py-1" /><div className="grid grid-cols-2 gap-2"><Input name="rate" type="number" min="0" step="0.01" placeholder="Agreed rate" className="rounded border px-2 py-1" /><Input name="currency" placeholder="Currency (DKK)" className="rounded border px-2 py-1" /></div><Textarea name="notes" placeholder="Relationship notes" className="rounded border px-2 py-1" /><Button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Add Creator Engagement</Button></form> : null}
      {canMutate && workspace.engagements.length ? <form className="grid gap-2 rounded-lg border p-3" onSubmit={submitForm("create_deliverable", (form) => ({ engagement_id: form.get("engagement_id"), description: form.get("description"), due_date: form.get("due_date") ? new Date(String(form.get("due_date"))).toISOString() : null, notes: form.get("notes") || null }))}><label className="text-sm font-medium">Add deliverable</label><NativeSelect required name="engagement_id" className="rounded border px-2 py-1"><option value="">Select creator</option>{workspace.engagements.map((item) => <option key={item.id} value={item.id}>{item.contact_name}</option>)}</NativeSelect><Input required name="description" placeholder="Deliverable" className="rounded border px-2 py-1" /><Input name="due_date" type="date" className="rounded border px-2 py-1" /><Textarea name="notes" placeholder="Notes" className="rounded border px-2 py-1" /><Button type="submit" variant="outline" className="rounded border px-3 py-2">Add deliverable</Button></form> : null}
    </> : null}
    {section === "posts" ? <><p className="text-sm text-muted-foreground">Metrics are manual captured observations. Campaign OS does not monitor or refresh social platforms.</p><div className="space-y-2">{workspace.posts.map((post) => <div key={post.id} className="rounded-lg border p-3 text-sm"><a className="underline" href={post.url} target="_blank" rel="noreferrer">{post.platform} post</a><p className="mt-1 text-muted-foreground">Captured metrics: {Object.entries(post.manual_metrics).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}</p></div>)}</div>{canMutate ? <form className="grid gap-2 rounded-lg border p-3" onSubmit={submitForm("create_post", (form) => ({ url: form.get("url"), platform: form.get("platform"), published_at: form.get("published_at") ? new Date(String(form.get("published_at"))).toISOString() : null, engagement_id: form.get("engagement_id") || null, manual_metrics: metricsFromForm(form), notes: form.get("notes") || null }))}><Input required name="url" type="url" placeholder="Post URL" className="rounded border px-2 py-1" /><Input required name="platform" placeholder="Platform" className="rounded border px-2 py-1" /><Input name="published_at" type="date" className="rounded border px-2 py-1" /><NativeSelect name="engagement_id" className="rounded border px-2 py-1"><option value="">No creator linked</option>{workspace.engagements.map((item) => <option key={item.id} value={item.id}>{item.contact_name}</option>)}</NativeSelect><div className="grid grid-cols-2 gap-2">{["views", "likes", "comments", "shares", "saves"].map((name) => <Input key={name} name={name} type="number" min="0" placeholder={name} className="rounded border px-2 py-1" />)}</div><Textarea name="notes" placeholder="Notes" className="rounded border px-2 py-1" /><Button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Record post</Button></form> : null}</> : null}
    {section === "cost" ? <><div className="grid grid-cols-3 gap-3 text-center"><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Planned</p><strong>{workspace.cost.planned}</strong></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Committed</p><strong>{workspace.cost.committed}</strong></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Paid</p><strong>{workspace.cost.paid}</strong></div></div><p className="text-sm text-muted-foreground">Amounts come from linked Budget Lines. Campaign OS cannot mark a Creator Engagement paid.</p></> : null}
    {section === "report" ? <><label className="block text-sm font-medium">Territories (two-letter ISO codes, separated by commas)</label>{canMutate ? <div className="flex gap-2"><Input value={territories} onChange={(event) => setTerritories(event.target.value)} className="flex-1 rounded border px-2 py-1" /><Button type="button" onClick={() => submit("set_territories", { country_codes: territories.split(",").map((value) => value.trim()).filter(Boolean) }).catch((reason) => setError(reason.message))} className="rounded border px-3">Save</Button></div> : <p>{territories || "No territories recorded"}</p>}<p className="text-sm text-muted-foreground">Finalising saves a dated snapshot of costs, deliverables, and captured metrics. It does not freeze the live record.</p>{finalReport ? <div className="rounded-lg border p-3 text-sm"><p className="font-medium">Finalised report{finalizedAt ? ` · ${new Date(finalizedAt).toLocaleDateString()}` : ""}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{finalReport}</p></div> : null}{canMutate ? <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); submit("finalize_report", { report }).catch((reason) => setError(reason.message)); }}><Textarea required value={report} onChange={(event) => setReport(event.target.value)} placeholder="Final report" className="min-h-32 rounded border p-2" /><Button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Finalise report</Button></form> : null}</> : null}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </div>;
}
