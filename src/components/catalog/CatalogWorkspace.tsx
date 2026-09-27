"use client";

import { useMemo, useState } from "react";
import type { SubmitEvent } from "react";
import type { CatalogEntryRow } from "../../server/catalog";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type CatalogEntryKind = "release" | "cd" | "lp" | "video";
type CatalogStatus = "planned" | "scheduled" | "published" | "archived";
type ReleaseOption = { id: string; title: string };

type FormState = {
  entry_type: CatalogEntryKind;
  title: string;
  release_id: string;
  release_date: string;
  status: CatalogStatus;
  sort_position: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  entry_type: "release",
  title: "",
  release_id: "",
  release_date: "",
  status: "planned",
  sort_position: "0",
  notes: "",
};

const KIND_LABELS: Record<CatalogEntryKind, string> = {
  release: "Release",
  cd: "CD",
  lp: "LP",
  video: "Video",
};

export function CatalogWorkspace({
  initialEntries,
  releaseOptions,
  canMutate,
}: {
  initialEntries: CatalogEntryRow[];
  releaseOptions: ReleaseOption[];
  canMutate: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => [
      entry.catalog_number,
      entry.title,
      entry.entry_type,
      entry.release_title,
      entry.status,
    ].some((value) => value?.toLowerCase().includes(needle)));
  }, [entries, query]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(entry: CatalogEntryRow) {
    setEditingId(entry.id);
    setForm({
      entry_type: entry.entry_type as CatalogEntryKind,
      title: entry.title,
      release_id: entry.release_id ?? "",
      release_date: entry.release_date ?? "",
      status: entry.status as CatalogStatus,
      sort_position: String(entry.sort_position ?? 0),
      notes: entry.notes ?? "",
    });
    setError("");
    setShowForm(true);
  }

  async function refresh() {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error("Could not refresh the catalog");
    const payload = await response.json() as { entries: CatalogEntryRow[] };
    setEntries(payload.entries);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        entry_type: form.entry_type,
        title: form.title,
        release_id: form.release_id || null,
        release_date: form.release_date || null,
        status: form.status,
        sort_position: Number(form.sort_position || 0),
        notes: form.notes || null,
      };
      const response = await fetch("/api/catalog", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save catalog entry");
      await refresh();
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save catalog entry");
    } finally {
      setLoading(false);
    }
  }

  async function archive(entry: CatalogEntryRow) {
    if (!window.confirm(`Archive ${entry.catalog_number ?? entry.title}?`)) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not archive catalog entry");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive catalog entry");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Shared numbering</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Catalog</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">One chronological sequence for releases, CDs, LPs, videos, and future editions. Unpublished entries can move; published numbers stay fixed.</p>
        </div>
        {canMutate && <Button variant="ghost" type="button" onClick={openCreate} className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-700">+ Add catalog entry</Button>}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search catalog" className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <p className="text-xs text-muted-foreground">{visibleEntries.length} {visibleEntries.length === 1 ? "entry" : "entries"}</p>
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[110px_minmax(0,1.8fr)_110px_150px_120px_100px] gap-3 border-b border-border bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
          <span>Number</span><span>Entry</span><span>Type</span><span>Release date</span><span>Status</span><span className="text-right">State</span>
        </div>
        {visibleEntries.length ? visibleEntries.map((entry) => (
          <div key={entry.id} className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[110px_minmax(0,1.8fr)_110px_150px_120px_100px] md:items-center">
            <div className="font-mono text-sm font-semibold text-foreground">{entry.catalog_number ?? "—"}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
              <p className="truncate text-xs text-muted-foreground">{entry.release_title ? `Linked release: ${entry.release_title}` : entry.notes || "Standalone catalog item"}</p>
            </div>
            <div><span className="rounded-full border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">{KIND_LABELS[entry.entry_type as CatalogEntryKind] ?? entry.entry_type}</span></div>
            <div className="text-sm text-muted-foreground">{entry.release_date || "No date"}</div>
            <div className="text-sm capitalize text-muted-foreground">{entry.status}</div>
            <div className="flex items-center justify-between gap-2 md:justify-end">
              <span className={`text-[11px] font-medium ${entry.catalog_number_locked ? "text-emerald-700" : "text-amber-700"}`}>{entry.catalog_number_locked ? "Locked" : "Moves"}</span>
              {canMutate && <div className="flex gap-1">
                <Button type="button" disabled={loading} onClick={() => openEdit(entry)} className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Edit</Button>
                <Button type="button" disabled={loading} onClick={() => void archive(entry)} className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Archive</Button>
              </div>}
            </div>
          </div>
        )) : (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">No catalog entries yet.</div>
        )}
      </div>

      {showForm && canMutate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
        <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div><p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{editingId ? "Edit entry" : "New entry"}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Catalog details</h2></div>
            <Button type="button" onClick={() => setShowForm(false)} className="text-sm text-muted-foreground hover:text-foreground">Close</Button>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Type<NativeSelect value={form.entry_type} onChange={(event) => setForm({ ...form, entry_type: event.target.value as CatalogEntryKind })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"><option value="release">Release</option><option value="cd">CD</option><option value="lp">LP</option><option value="video">Video</option></NativeSelect></label>
              <label className="block text-sm font-medium">Status<NativeSelect value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CatalogStatus })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"><option value="planned">Planned</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="archived">Archived</option></NativeSelect></label>
            </div>
            <label className="block text-sm font-medium">Title<Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Release date<Input type="date" value={form.release_date} onChange={(event) => setForm({ ...form, release_date: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" /></label>
              <label className="block text-sm font-medium">Tie-break position<Input type="number" min="0" value={form.sort_position} onChange={(event) => setForm({ ...form, sort_position: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" /></label>
            </div>
            <label className="block text-sm font-medium">Linked release<NativeSelect value={form.release_id} onChange={(event) => setForm({ ...form, release_id: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"><option value="">— None —</option>{releaseOptions.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</NativeSelect></label>
            <label className="block text-sm font-medium">Notes<Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" /></label>
            {editingId && entries.find((entry) => entry.id === editingId)?.catalog_number_locked && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">This number is locked because the entry has been published. Editing the date will not renumber it.</p>}
            <div className="flex justify-end gap-2 pt-2"><Button type="button" onClick={() => setShowForm(false)} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button><Button variant="ghost" type="submit" disabled={loading} className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">{loading ? "Saving…" : editingId ? "Save changes" : "Add entry"}</Button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
