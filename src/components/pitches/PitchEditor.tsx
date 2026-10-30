import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { NativeSelect } from "../ui/native-select";
import { pitchPublicPath, type PitchDraft } from "../../lib/pitches";
import type { getPitch, pitchOptions } from "../../server/pitches";

type Pitch = Awaited<ReturnType<typeof getPitch>>;
type Options = Awaited<ReturnType<typeof pitchOptions>>;

export function PitchEditor({ initial, options: initialOptions, replyEmail }: { initial: Pitch | null; options: Options; replyEmail: string }) {
  const [pitch, setPitch] = useState(initial);
  const [options, setOptions] = useState(initialOptions);
  const [form, setForm] = useState<PitchDraft>(() => ({
    id: initial?.id ?? crypto.randomUUID(), expected_version: initial?.version ?? 0,
    campaign_id: initial?.campaign_id ?? initialOptions.campaignId,
    sync_deal_id: initial?.sync_deal_id ?? initialOptions.syncId,
    release_id: initial?.release_id ?? initialOptions.releaseId,
    contact_id: initial?.contact_id ?? initialOptions.contactId ?? "",
    title: initial?.title ?? `${initialOptions.contextTitle} — music selection`,
    message: initial?.message ?? "", credits: initial?.credits ?? "", rights_note: initial?.rights_note ?? "",
    reply_email: initial?.reply_email ?? replyEmail,
    file_ids: initial?.recordings.map(file => file.file_id) ?? [], downloads: initial?.downloads ?? false,
  }));
  const [followup, setFollowup] = useState({ status: initial?.status ?? "draft", sent_date: initial?.sent_date ?? "", response_note: initial?.response_note ?? "", next_action: initial?.next_action ?? "", due_date: initial?.due_date ?? "" });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const followupDirty = Boolean(pitch && (followup.status !== pitch.status || followup.sent_date !== (pitch.sent_date ?? "") || followup.response_note !== pitch.response_note || followup.next_action !== pitch.next_action || followup.due_date !== (pitch.due_date ?? "")));
  useEffect(() => {
    if (!dirty && !followupDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, followupDirty]);
  const frozen = Boolean(pitch && pitch.link_state !== "draft");
  const contextQuery = new URLSearchParams(form.campaign_id ? { campaign: form.campaign_id } : { sync: form.sync_deal_id! }).toString();
  const listHref = `/pitches?${contextQuery}`;

  function edit<K extends keyof PitchDraft>(key: K, value: PitchDraft[K]) { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setNotice(""); }
  function accept(next: Pitch) {
    setPitch(next);
    setForm(previous => ({ ...previous, expected_version: next.version }));
  }
  async function request(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save pitch");
    return data.pitch as Pitch;
  }
  async function chooseRelease(release: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/pitches?${contextQuery}&release=${encodeURIComponent(release)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load release recordings");
      setOptions(data.options); setForm(previous => ({ ...previous, release_id: release, file_ids: [] })); setDirty(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load recordings"); }
    finally { setBusy(false); }
  }
  async function saveDraft(event: React.SubmitEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const next = await request("/api/pitches", { action: "save", input: form });
      accept(next); setDirty(false); setNotice("Draft saved. The listening link has not been created.");
      if (!pitch) window.history.replaceState(null, "", `/pitches/${next.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft"); }
    finally { setBusy(false); }
  }
  async function link(action: "create" | "revoke") {
    if (!pitch) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await request("/api/pitches/link", { action, id: pitch.id, expected_version: pitch.version });
      accept(next);
      setNotice(action === "create" ? "Listening link ready. Share it yourself, then record the date sent below." : "Listening page and its Samply link have been revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change listening link");
      // The provider reservation may have committed even if its response failed.
      try {
        const response = await fetch(`/api/pitches?id=${pitch.id}`);
        if (!response.ok) throw new Error("Reload the page before retrying.");
        accept((await response.json()).pitch);
      } catch { setError(previous => `${previous} Reload the page before retrying.`); }
    } finally { setBusy(false); }
  }
  async function saveFollowup(event: React.SubmitEvent) {
    event.preventDefault(); if (!pitch) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await request("/api/pitches", { action: "followup", input: { ...followup, id: pitch.id, expected_version: pitch.version, sent_date: followup.sent_date || null, due_date: followup.due_date || null } });
      accept(next);
      setFollowup({ status: next.status, sent_date: next.sent_date ?? "", response_note: next.response_note, next_action: next.next_action, due_date: next.due_date ?? "" });
      setNotice("Follow-up saved. Next actions are also available in Tasks.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save follow-up"); }
    finally { setBusy(false); }
  }
  async function copyLink() {
    if (!pitch?.public_path) return;
    try { await navigator.clipboard.writeText(new URL(pitch.public_path, window.location.origin).href); setNotice("Listening link copied."); }
    catch { setError("Could not copy the link. Open the listening page and copy its address."); }
  }
  return <div className="mx-auto max-w-3xl space-y-7">
    <a href={listHref} className="text-sm underline">← Pitches for {options.contextTitle}</a>
    <header><h1 className="text-2xl font-semibold">{pitch?.title ?? "New pitch"}</h1><p className="text-muted-foreground">Choose exact recordings, prepare a listening page, and keep the follow-up together.</p></header>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-md border p-3">{notice}</p>}
    <form onSubmit={saveDraft} className="space-y-5">
      <fieldset disabled={busy || frozen} className="space-y-5 disabled:opacity-75">
        <label className="block space-y-1"><span>Pitch title</span><Input required maxLength={180} value={form.title} onChange={event => edit("title", event.target.value)}/></label>
        <label className="block space-y-1"><span>Recipient · internal only</span><NativeSelect aria-label="Recipient · internal only" required value={form.contact_id} onChange={event => edit("contact_id", event.target.value)}><option value="">Choose a contact</option>{options.contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ""}</option>)}</NativeSelect></label>
        <label className="block space-y-1"><span>Release</span><NativeSelect aria-label="Release" required value={form.release_id} onChange={event => void chooseRelease(event.target.value)}><option value="" disabled>Choose a release</option>{options.releases.map(release => <option key={release.id} value={release.id}>{release.title}</option>)}</NativeSelect></label>
        <div className="space-y-2"><h2 className="font-semibold">Exact recording versions</h2><p className="text-sm text-muted-foreground">Choose files from this release’s linked Samply project. Additional versions will not be included.</p>
          {frozen ? <ul className="space-y-2">{pitch!.recordings.map(file => <li key={file.file_id}>{file.title} · {file.file_name}</li>)}</ul> : options.files.length ? options.files.map(file => <label key={file.id} className="flex items-start gap-3 rounded-md border p-3"><input type="checkbox" className="mt-1" checked={form.file_ids.includes(file.id)} onChange={event => edit("file_ids", event.target.checked ? [...form.file_ids, file.id] : form.file_ids.filter(id => id !== file.id))}/><span>{file.trackTitle}<small className="block text-muted-foreground">{file.fileName}</small></span></label>) : <p className="rounded-md border p-3 text-sm">No synced recordings are available. {form.release_id && <a className="underline" href={`/releases/${encodeURIComponent(form.release_id)}?section=tracks`}>Open the release to link and sync Samply.</a>}</p>}
        </div>
        <label className="block space-y-1"><span>Message for the recipient</span><Textarea rows={4} maxLength={4000} value={form.message} onChange={event => edit("message", event.target.value)}/></label>
        <label className="block space-y-1"><span>Credits · shown on the listening page</span><Textarea maxLength={2000} value={form.credits} onChange={event => edit("credits", event.target.value)}/></label>
        <label className="block space-y-1"><span>Rights information · shown on the listening page</span><Textarea maxLength={2000} placeholder="Include only confirmed information suitable for the recipient." value={form.rights_note} onChange={event => edit("rights_note", event.target.value)}/></label>
        <label className="block space-y-1"><span>Reply email · shown on the listening page</span><Input required type="email" value={form.reply_email} onChange={event => edit("reply_email", event.target.value)}/></label>
        <label className="flex gap-2"><input type="checkbox" checked={form.downloads} onChange={event => edit("downloads", event.target.checked)}/>Allow downloads of the selected files</label>
      </fieldset>
      {!frozen && <Button type="submit" disabled={busy || !form.file_ids.length}>{busy ? "Saving…" : "Save draft"}</Button>}
      {frozen && <p className="text-sm text-muted-foreground">This selection is frozen to preserve what was shared. <a className="underline" href={`/pitches/new?${contextQuery}`}>Create a new pitch</a> to change the content or recipient.</p>}
    </form>
    {pitch && <section className="space-y-3 border-t pt-6"><h2 className="text-lg font-semibold">Listening link</h2>
      {pitch.link_state === "ready" ? <>
        <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={copyLink}>Copy listening link</Button><a className="underline" href={pitchPublicPath(pitch.org_id, pitch.token)} target="_blank" rel="noreferrer">Open listening page</a><Button variant="outline" type="button" disabled={busy} onClick={() => void link("revoke")}>Revoke link</Button></div>
        <p className="text-sm text-muted-foreground">Anyone with the link can listen, including someone it is forwarded to. Label Suite does not send this link automatically.</p>
      </> : pitch.link_state === "revoked" ? <p>Access has been revoked.</p> : pitch.link_state === "revoking" ? <><p>The listening page is hidden. Revocation of the Samply link still needs confirmation.</p><Button disabled={busy} onClick={() => void link("revoke")}>Retry revocation</Button></> : <>
        <p className="text-sm text-muted-foreground">Creating the link makes the selected recordings available to anyone who receives it. Your message, credits, rights information, and reply email will be visible. Internal recipient and follow-up details remain private.</p>
        {!options.configured && <p>Samply needs to be configured by a workspace owner before a link can be created.</p>}
        <Button type="button" disabled={busy || dirty || !options.configured} onClick={() => void link("create")}>{busy ? "Preparing…" : pitch.link_state === "preparing" ? "Recover listening link" : "Create listening link"}</Button>
        {pitch.link_state === "preparing" && pitch.player_id && <Button type="button" variant="outline" disabled={busy} onClick={() => void link("revoke")}>Revoke unfinished link</Button>}
        {dirty && <p className="text-sm">Save your draft changes first.</p>}
      </>}
    </section>}
    {pitch && <form onSubmit={saveFollowup} className="space-y-4 border-t pt-6"><h2 className="text-lg font-semibold">Recipient and follow-up · internal only</h2><p>{pitch.recipient}{pitch.recipient_email ? ` · ${pitch.recipient_email}` : ""}</p>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1"><span>Status</span><NativeSelect aria-label="Status" value={followup.status} onChange={event => setFollowup({ ...followup, status: event.target.value })}>{["draft", "sent", "replied", "closed"].map(status => <option key={status} value={status}>{status}</option>)}</NativeSelect></label>
        <label className="space-y-1"><span>Date actually sent</span><Input type="date" value={followup.sent_date} onChange={event => setFollowup({ ...followup, sent_date: event.target.value })}/></label>
        <label className="space-y-1 sm:col-span-2"><span>Response / internal notes</span><Textarea maxLength={4000} value={followup.response_note} onChange={event => setFollowup({ ...followup, response_note: event.target.value })}/></label>
        <label className="space-y-1"><span>Next action</span><Input maxLength={500} value={followup.next_action} onChange={event => setFollowup({ ...followup, next_action: event.target.value })}/></label>
        <label className="space-y-1"><span>Follow-up date</span><Input type="date" value={followup.due_date} onChange={event => setFollowup({ ...followup, due_date: event.target.value })}/></label>
      </fieldset><Button type="submit" disabled={busy}>Save follow-up</Button>
      {pitch.task_id && <p className="text-sm"><a href="/tasks" className="underline">Manage the follow-up in Tasks</a>{pitch.task_status ? ` · ${pitch.task_status}` : ""}</p>}
    </form>}
  </div>;
}
