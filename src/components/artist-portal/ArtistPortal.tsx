import { useEffect, useState, type SubmitEvent } from "react";
import { ArrowUpRight, Check, FileText, Plus, X } from "lucide-react";
import { contributorRoles, type ArtistPortalData, type ArtistSubmission, type PortalSubmission } from "../../lib/artist-portal";

const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50";
const blankContributor = () => ({ name: "", role: "Music & lyrics" as ArtistSubmission["contributors"][number]["role"], details: "" });

export function SubmissionDetails({ submission }: { submission: PortalSubmission }) {
  const data = submission.details;
  return <details className="group border-t border-border py-5">
    <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-medium">{data.track_title}{data.version && ` · ${data.version}`}</p><p className="mt-1 text-sm text-muted-foreground">{data.release_title || "Release not specified"} · {new Date(submission.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</p></div>
      <span className="rounded-full border border-border px-3 py-1 text-xs">{submission.reviewed_at ? "Reviewed" : "Received"}</span>
    </div><span className="mt-2 inline-block text-xs underline underline-offset-4">View submitted details</span></summary>
    <div className="mt-5 space-y-4 text-sm">
      <p>Submitted by {data.submitted_by} · {data.email}</p>
      <ul className="space-y-2">{data.contributors.map((person, i) => <li key={i}><strong>{person.name}</strong> — {person.role}{person.details && ` · ${person.details}`}</li>)}</ul>
      <p className="whitespace-pre-wrap"><strong>Writing shares:</strong> {data.writing_shares || "Not supplied / not agreed yet"}</p>
      {data.notes && <p className="whitespace-pre-wrap"><strong>Notes:</strong> {data.notes}</p>}
      {submission.reviewed_at && <p className="text-muted-foreground">Reviewed means the label has read this submission. It does not confirm an agreement or change your rights.</p>}
    </div>
  </details>;
}

export function ArtistPortal() {
  const [portal, setPortal] = useState<ArtistPortalData | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [contributors, setContributors] = useState([blankContributor()]);
  const [submissionId, setSubmissionId] = useState("");

  async function request(access: string, query = "", init?: RequestInit) {
    const response = await fetch(`/api/artist-portal${query}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  useEffect(() => {
    const access = new URLSearchParams(window.location.hash.slice(1)).get("access") ?? "";
    setToken(access);
    setSubmissionId(crypto.randomUUID());
    if (!access) { setError("Open the private link sent by your label to access your archive."); return; }
    void request(access).then(setPortal).catch((err) => setError(err.message));
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true); setError(""); setNotice("");
    try {
      await request(token, "", { method: "POST", body: JSON.stringify({ ...fields, id: submissionId, contributors }) });
      setNotice("Details received. Thank you — the label can now review them.");
      setSubmissionId(crypto.randomUUID());
      form.reset();
      for (const name of ["submitted_by", "email", "release_title"]) {
        (form.elements.namedItem(name) as HTMLInputElement).value = String(fields[name] ?? "");
      }
      setContributors([blankContributor()]);
      try { setPortal(await request(token)); }
      catch { setError("Your submission was saved, but the archive could not refresh. Reload to see it."); }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send details. Your form has been kept."); }
    finally { setBusy(false); }
  }

  async function openAgreement(id: string) {
    setError("");
    try { const { url } = await request(token, `?document=${encodeURIComponent(id)}`); window.location.assign(url); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not open the agreement."); }
  }

  if (!portal) return <main className="mx-auto max-w-xl px-6 py-24"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Artist archive</p><h1 className="mt-4 text-3xl font-medium">Agreements & details</h1><p role={error ? "alert" : "status"} className="mt-5 text-muted-foreground">{error || "Opening your archive…"}</p></main>;

  return <main className="mx-auto max-w-4xl px-5 pb-16 pt-10 sm:px-10 sm:pt-16">
    <header className="border-b border-border pb-9">
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground"><span className="uppercase tracking-[0.2em]">Artist archive</span><span>Private link</span></div>
      <h1 className="mt-8 text-4xl font-medium tracking-tight sm:text-5xl">{portal.artist_name}</h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">Your agreements in one place. Send us the details behind your music whenever you’re ready.</p>
      <nav aria-label="Archive sections" className="mt-7 flex flex-wrap gap-5 text-sm"><a href="#agreements" className="underline underline-offset-4" onClick={(event) => { event.preventDefault(); document.getElementById("agreements")?.scrollIntoView({ behavior: "smooth" }); }}>Agreements</a><a href="#send-details" className="underline underline-offset-4" onClick={(event) => { event.preventDefault(); document.getElementById("send-details")?.scrollIntoView({ behavior: "smooth" }); }}>Send details</a><a href="#submitted" className="underline underline-offset-4" onClick={(event) => { event.preventDefault(); document.getElementById("submitted")?.scrollIntoView({ behavior: "smooth" }); }}>Previously sent</a></nav>
    </header>
    <section id="agreements" className="scroll-mt-8 py-9">
      <div className="flex items-baseline justify-between gap-4"><h2 className="text-2xl font-medium tracking-tight">Agreements</h2><span className="text-sm text-muted-foreground">{portal.agreements.length} shared</span></div>
      <p className="mt-2 text-sm text-muted-foreground">Documents shared with you by the label.</p>
      <div className="mt-5">{portal.agreements.length ? portal.agreements.map((agreement) => <button key={agreement.id} type="button" onClick={() => void openAgreement(agreement.id)} className="flex w-full items-center gap-4 border-t border-border py-5 text-left hover:bg-muted/40">
        <FileText size={22} className="shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-words font-medium">{agreement.name}</span><span className="mt-1 block text-sm text-muted-foreground">{agreement.status || "Shared document"}</span></span><ArrowUpRight size={20} aria-hidden="true" />
      </button>) : <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No agreements shared yet. They’ll appear here when the label adds them.</p>}</div>
    </section>
    <section id="send-details" className="scroll-mt-8 border-t border-border py-9">
      <h2 className="text-2xl font-medium tracking-tight">Send details</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">One track at a time. Tell us who did what. Leave anything you haven’t agreed on in the notes.</p>
      <form onSubmit={submit} className="mt-7 space-y-7">
        <fieldset disabled={busy} className="space-y-7">
          <legend className="sr-only">Track and contributor details</legend>
          <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-medium">Your name<input name="submitted_by" required maxLength={160} autoComplete="name" className={inputClass} /></label><label className="text-sm font-medium">Your email<input name="email" type="email" required maxLength={254} autoComplete="email" className={inputClass} /></label></div>
          <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-medium">Track title<input name="track_title" required maxLength={200} className={inputClass} /></label><label className="text-sm font-medium">Version <span className="font-normal text-muted-foreground">(optional)</span><input name="version" maxLength={100} placeholder="e.g. Original, radio edit" className={inputClass} /></label></div>
          <label className="block text-sm font-medium">Release title <span className="font-normal text-muted-foreground">(if known)</span><input name="release_title" maxLength={200} className={inputClass} /></label>
          <div><h3 className="font-medium">Who contributed?</h3><p className="mt-1 text-sm text-muted-foreground">Use full credit names. Add another entry if someone has several roles.</p>
            <div className="mt-4 space-y-4">{contributors.map((person, index) => <fieldset key={index} className="rounded-xl border border-border p-4 sm:p-5"><legend className="px-2 text-xs text-muted-foreground">Contributor {index + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Full name<input required maxLength={160} value={person.name} onChange={(e) => setContributors(contributors.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} className={inputClass} /></label><div><label htmlFor={`contributor-role-${index}`} className="text-sm font-medium">Role</label><select id={`contributor-role-${index}`} value={person.role} onChange={(e) => setContributors(contributors.map((item, i) => i === index ? { ...item, role: e.target.value as typeof person.role } : item))} className={inputClass}>{contributorRoles.map((role) => <option key={role}>{role}</option>)}</select></div></div>
              <label className="mt-4 block text-sm font-medium">Details <span className="font-normal text-muted-foreground">(optional)</span><input maxLength={300} value={person.details} placeholder="e.g. Vocals, drums, publisher or IPI number" onChange={(e) => setContributors(contributors.map((item, i) => i === index ? { ...item, details: e.target.value } : item))} className={inputClass} /></label>
              {contributors.length > 1 && <button type="button" onClick={() => setContributors(contributors.filter((_, i) => i !== index))} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground" aria-label={`Remove contributor ${index + 1}`}><X size={16} aria-hidden="true" />Remove</button>}
            </fieldset>)}</div>
            <button type="button" disabled={contributors.length >= 30} onClick={() => setContributors([...contributors, blankContributor()])} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium disabled:opacity-50"><Plus size={17} aria-hidden="true" />Add contributor</button>
          </div>
          <label className="block text-sm font-medium">Writing shares <span className="font-normal text-muted-foreground">(if agreed)</span><textarea name="writing_shares" maxLength={2000} rows={3} placeholder="e.g. Alex 50%, Sam 50% — or “not agreed yet”" className={inputClass} /><span className="mt-2 block text-xs font-normal text-muted-foreground">These are the songwriting shares, separate from ownership of the recording. This form records your information; it does not create an agreement.</span></label>
          <label className="block text-sm font-medium">Anything else? <span className="font-normal text-muted-foreground">(optional)</span><textarea name="notes" maxLength={4000} rows={3} placeholder="Missing details, corrections to a previous submission, or a question for the label." className={inputClass} /></label>
          <button disabled={busy} className={buttonClass}>{busy ? "Sending…" : "Send details"}<ArrowUpRight size={17} aria-hidden="true" /></button>
        </fieldset>
        {notice && <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm"><Check size={18} className="shrink-0" aria-hidden="true" />{notice}</p>}
      </form>
    </section>
    {error && <p role="alert" className="mb-6 rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>}
    <section id="submitted" className="scroll-mt-8 border-t border-border py-9"><h2 className="text-2xl font-medium tracking-tight">Previously sent</h2><p className="mt-2 text-sm text-muted-foreground">A record of the details sent through this link.</p><div className="mt-6">{portal.submissions.length ? portal.submissions.map((submission) => <SubmissionDetails key={submission.id} submission={submission} />) : <p className="text-sm text-muted-foreground">Nothing sent yet. Your first submission will appear here.</p>}</div></section>
    <footer className="border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">This link opens your private archive. Share it only with your manager or someone you trust to act for you.</footer>
  </main>;
}
