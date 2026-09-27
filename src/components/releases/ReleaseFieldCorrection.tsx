import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { uploadFileToStorage } from "../../lib/storage-client";
import type { ReleaseReadinessSnapshot } from "../../server/release-correction";

type Field = "cover_art_url" | "upc_ean" | "release_date" | "format";
const labels: Record<Field, string> = { cover_art_url: "Cover art", upc_ean: "UPC/EAN", release_date: "Release date", format: "Format" };

export function ReleaseFieldCorrection({ releaseId, field, inputId, initial, fallbackValue = "", canManage, onSnapshot, onDirtyChange, onClose }: {
  releaseId: string; field: Field; inputId: string; initial: ReleaseReadinessSnapshot | null;
  fallbackValue?: string | null;
  canManage: boolean; onSnapshot: (snapshot: ReleaseReadinessSnapshot) => void;
  onDirtyChange: (dirty: boolean) => void; onClose: () => void;
}) {
  const [base, setBase] = useState(initial);
  const [value, setValue] = useState(initial ? initial.release[field] ?? "" : fallbackValue ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [comparison, setComparison] = useState<ReleaseReadinessSnapshot | null>(null);
  const dirty = Boolean(file) || Boolean(base && value !== (base.release[field] ?? ""));

  useEffect(() => {
    onDirtyChange(dirty || busy);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty || busy) window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); onDirtyChange(false); };
  }, [dirty, busy, onDirtyChange]);

  async function readResponse(response: Response, saved = false): Promise<ReleaseReadinessSnapshot> {
    const data = await response.json().catch(() => null);
    if (response.redirected || !response.ok || (saved && data?.ok !== true)
      || data?.release?.id !== releaseId || !data.release.updated_at
      || typeof data?.readiness?.isReady !== "boolean" || !Array.isArray(data?.readiness?.missing)) {
      throw Object.assign(new Error(response.redirected ? "Session changed. Sign in again, then compare the latest record."
        : data?.error || "The server did not confirm the result. Compare the latest record before retrying."), { status: response.status });
    }
    return data;
  }

  async function compareLatest() {
    setBusy(true); setError("");
    try {
      const latest = await readResponse(await fetch(`/api/releases/${encodeURIComponent(releaseId)}/readiness`, { cache: "no-store" }));
      onSnapshot(latest);
      if (!base) { setBase(latest); setValue(latest.release[field] ?? ""); }
      else setComparison(latest);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load current release"); }
    finally { setBusy(false); }
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !base?.release.updated_at || needsReview || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      let nextValue = value.trim();
      if (file) {
        const uploaded = await uploadFileToStorage(file, `releases/${releaseId}/artwork`);
        nextValue = uploaded.url ?? uploaded.key;
        setValue(nextValue); setFile(null);
      }
      const result = await readResponse(await fetch(`/api/releases/${encodeURIComponent(releaseId)}/readiness`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: nextValue || null, expected_updated_at: base.release.updated_at }),
      }), true);
      onSnapshot(result);
      if ((result.release[field] ?? "") !== nextValue) {
        setNeedsReview(true); setComparison(result);
        setError("The save completed, but the current value changed again. Compare it before continuing.");
      } else {
        setBase(result); setValue(result.release[field] ?? "");
        setStatus(`${labels[field]} saved. ${result.readiness.isReady ? "Release checks pass." : `${result.readiness.missing.length} release checks still need attention.`}`);
      }
    } catch (err) {
      setNeedsReview(!(err instanceof Error && "status" in err && err.status === 400));
      setError(err instanceof Error ? err.message : "Save was not confirmed. Your correction is retained.");
    } finally { setBusy(false); }
  }

  function acceptComparison(keepDraft: boolean) {
    if (!comparison) return;
    setBase(comparison);
    if (!keepDraft) { setValue(comparison.release[field] ?? ""); setFile(null); }
    setComparison(null); setNeedsReview(false); setError(""); setStatus("");
  }

  return <form onSubmit={save} className="space-y-3" onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}>
    <h2 className="text-base font-semibold">Correct {labels[field]}</h2>
    <p className="text-sm text-muted-foreground">{base?.release.title ?? "Release"} · Only this field will be saved.</p>
    {!base && <p role="status">Checks are unavailable. The displayed value has not been refreshed. Compare the latest record to continue.</p>}
    {!canManage ? <div><p className="break-all">{labels[field]}: {value || "Not set"}</p><p>You have read-only access. A workspace operator can make this correction.</p></div> : <>
      {field === "cover_art_url" && <div>
        <label htmlFor={`${inputId}-file`}>Upload cover image</label>
        <Input id={`${inputId}-file`} type="file" accept="image/*" disabled={busy || !base} onChange={event => { setFile(event.target.files?.[0] ?? null); setStatus(""); }} />
      </div>}
      <label htmlFor={inputId} className="block text-sm font-medium">{field === "cover_art_url" ? "Cover URL or storage key" : labels[field]}</label>
      {field === "format" ? <NativeSelect id={inputId} value={value} disabled={busy || !base} onChange={event => { setValue(event.target.value); setStatus(""); }}>
        <option value="">Select format</option>{["single", "EP", "album", "video"].map(option => <option key={option}>{option}</option>)}
      </NativeSelect> : <Input id={inputId} type={field === "release_date" ? "date" : "text"} maxLength={4096} value={value} disabled={busy || !base}
        onChange={event => { setValue(event.target.value); setStatus(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} />}
      <Button type="submit" disabled={busy || !base?.release.updated_at || needsReview || !dirty}>{busy ? "Working…" : `Save ${labels[field]}`}</Button>
    </>}
    {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{error} Your correction is retained.</p>}
    {(!base || needsReview) && <Button type="button" variant="outline" disabled={busy} onClick={compareLatest}>Compare latest record</Button>}
    {comparison && <div className="space-y-2 rounded border p-3">
      <p className="break-all text-sm">Current {labels[field]}: {comparison.release[field] || "Not set"}</p>
      <p className="text-sm">Your correction remains above. Keeping it does not save until you choose Save.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => acceptComparison(false)}>Use latest value</Button>
        <Button type="button" disabled={busy} onClick={() => acceptComparison(true)}>Keep my correction</Button>
      </div>
    </div>}
    <p role="status" className="text-sm">{status}</p>
    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close correction</Button>
  </form>;
}
