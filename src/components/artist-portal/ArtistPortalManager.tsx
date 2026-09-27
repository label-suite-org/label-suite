import { useEffect, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import type { PortalSubmission, SharedAgreement } from "../../lib/artist-portal";
import { SubmissionDetails } from "./ArtistPortal";

type ManagementData = {
  artist: { id: string; name: string };
  portal: { id: string; agreements: SharedAgreement[]; revoked_at: string | null } | null;
  documents: { id: string; name: string; status: string | null; file_link: string | null }[];
  submissions: PortalSubmission[];
};
const buttonClass = "min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

export function ArtistPortalManager({ initial }: { initial: ManagementData }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState(initial.portal?.agreements.map((doc) => doc.id) ?? []);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const endpoint = `/api/artists/${encodeURIComponent(data.artist.id)}/portal`;
  async function mutate(input: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save changes.");
      if (result.token) setLink(`${window.location.origin}/artist-portal#access=${result.token}`);
      if (input.action === "revoke") setLink("");
      setNotice(input.action === "share" ? "Archive saved." : input.action === "revoke" ? "Private link revoked." : input.action === "review" ? "Marked as reviewed." : "Private link created. Copy it before leaving this page.");
      const refreshed = await fetch(endpoint, { cache: "no-store" });
      if (!refreshed.ok) throw new Error("Changes saved, but the page could not refresh. Reload to see them.");
      const next = await refreshed.json() as ManagementData;
      setData(next); setSelected(next.portal?.agreements.map((doc) => doc.id) ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save changes."); }
    finally { setBusy(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setNotice("Private link copied."); }
    catch { setError("Could not copy automatically. Select and copy the link below."); }
  }
  const active = data.portal && !data.portal.revoked_at;
  return <div className="mx-auto max-w-4xl space-y-9">
    <header><a href={`/artists/${encodeURIComponent(data.artist.id)}`} className="text-sm text-muted-foreground underline underline-offset-4">Back to {data.artist.name}</a><p className="mt-7 text-xs uppercase tracking-[0.18em] text-muted-foreground">Artist archive</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{data.artist.name}</h1><p className="mt-3 text-muted-foreground">Share agreements and collect credits from the artist or their manager.</p></header>
    <section className="rounded-xl border border-border p-5 sm:p-6"><h2 className="text-lg font-semibold">Private link</h2><p className="mt-2 text-sm text-muted-foreground">{active ? "The link is active. Anyone holding it can read this archive and send details." : "Create a link to give this artist access. No Label Suite account is needed."}</p>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={busy || !ready} onClick={() => {
        if (!active || window.confirm("Replace the private link? The old link will stop working immediately.")) void mutate({ action: "create_link" });
      }} className={`${buttonClass} inline-flex items-center gap-2`}><Link2 size={16} aria-hidden="true" />{active ? "Replace private link" : "Create private link"}</button>
      {active && <button type="button" disabled={busy || !ready} onClick={() => { if (window.confirm("Revoke access? This link will stop working. Agreements and submissions will be kept.")) void mutate({ action: "revoke" }); }} className={buttonClass}>Revoke access</button>}</div>
      {link && <div className="mt-5 space-y-3"><label className="block text-sm font-medium">Copy and send this link<input readOnly value={link} onFocus={(e) => e.target.select()} className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm" /></label><div className="flex flex-wrap gap-3"><button type="button" onClick={() => void copyLink()} className={`${buttonClass} inline-flex items-center gap-2`}><Copy size={16} aria-hidden="true" />Copy link</button><a href={link} target="_blank" rel="noreferrer" className={`${buttonClass} inline-flex items-center`}>Open artist view</a></div></div>}
      <p className="mt-4 text-xs text-muted-foreground">The full link is shown only when created. Replacing it keeps the archive and submission history.</p>
    </section>
    <section><h2 className="text-xl font-semibold">Agreements to share</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Choose which documents appear in this artist’s archive. Only the document name, status and file are shared. Save again after changing a document to update the archive.</p>
      <fieldset disabled={busy || !ready || !data.portal} className="mt-5 space-y-3"><legend className="sr-only">Documents shared with the artist</legend>
        {data.documents.map((doc) => <label key={doc.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4"><input type="checkbox" className="mt-1 h-4 w-4" disabled={!doc.file_link} checked={selected.includes(doc.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, doc.id] : selected.filter((id) => id !== doc.id))} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{doc.name}</span><span className="mt-1 block text-xs text-muted-foreground">{doc.file_link ? doc.status || "No status" : "Add a file in Documents before sharing"}</span></span></label>)}
        {!data.documents.length && <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No documents are linked to this artist yet. Add an agreement in <a href="/documents" className="underline">Documents</a> and select this artist.</p>}
        {data.portal?.agreements.some((doc) => !data.documents.some((item) => item.id === doc.id)) && <p className="text-sm text-muted-foreground">Some previously shared documents are no longer linked to this artist. Saving removes those entries from the archive.</p>}
        <button type="button" onClick={() => void mutate({ action: "share", document_ids: selected.filter((id) => data.documents.some((doc) => doc.id === id && doc.file_link)) })} className={buttonClass}>Save archive</button>
      </fieldset>{!data.portal && <p className="mt-3 text-sm text-muted-foreground">Create a private link to start sharing documents.</p>}
    </section>
    <div aria-live="polite">{notice && <p role="status" className="rounded-lg bg-muted p-4 text-sm">{notice}</p>}{error && <p role="alert" className="mt-3 rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>}</div>
    <section><h2 className="text-xl font-semibold">Submitted details</h2><p className="mt-2 text-sm text-muted-foreground">Review what the artist or manager sent. These submissions do not change catalog credits or agreements.</p><div className="mt-5">{data.submissions.length ? data.submissions.map((submission) => <div key={submission.id} className="pb-4"><SubmissionDetails submission={submission} />{!submission.reviewed_at && <button type="button" disabled={busy || !ready} onClick={() => void mutate({ action: "review", submission_id: submission.id })} className={buttonClass}>Mark reviewed</button>}</div>) : <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">Nothing submitted yet. Details will appear here when the artist or manager sends the form.</p>}</div></section>
  </div>;
}
