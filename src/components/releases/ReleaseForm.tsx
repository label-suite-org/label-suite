"use client";

import { useId, useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface Release {
  id: string;
  title: string;
  catalog_number?: string | null;
  catalog_number_locked?: boolean | null;
  artist_id?: string | null;
  parent_release_id?: string | null;
  release_date?: string | null;
  format?: string | null;
  upc_ean?: string | null;
  cover_art_url?: string | null;
  status?: string | null;
}

export function ReleaseForm({ initial, artists, parentReleases = [], onClose }: {
  initial?: Release | null;
  artists: Array<{ id: string; name: string }>;
  parentReleases?: Array<{ id: string; title: string; format?: string | null }>;
  onClose: () => void;
}) {
  const formId = useId();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title || "");
  const [artistId, setArtistId] = useState(initial?.artist_id || "");
  const [parentReleaseId, setParentReleaseId] = useState(initial?.parent_release_id || "");
  const [releaseDate, setReleaseDate] = useState(initial?.release_date || "");
  const [format, setFormat] = useState(initial?.format || "single");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [upc, setUpc] = useState(initial?.upc_ean || "");
  const [coverArt, setCoverArt] = useState(initial?.cover_art_url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSingle = format.toLowerCase() === "single";

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        title,
        artist_id: artistId || null,
        parent_release_id: isSingle ? parentReleaseId || null : null,
        release_date: releaseDate || null,
        format, status,
        upc_ean: upc || null,
        cover_art_url: coverArt || null,
      };
      const res = await fetch("/api/releases", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} release`);
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor={`${formId}-title`} className="block text-sm font-medium text-neutral-700 mb-1">Title *</label>
        <Input id={`${formId}-title`} value={title} onChange={(e) => setTitle(e.target.value)} required
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div>
        <label htmlFor={`${formId}-artist`} className="block text-sm font-medium text-neutral-700 mb-1">Artist</label>
        <NativeSelect id={`${formId}-artist`} value={artistId} onChange={(e) => setArtistId(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
          <option value="">— Select artist —</option>
          {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-release-date`} className="block text-sm font-medium text-neutral-700 mb-1">Release Date</label>
          <Input id={`${formId}-release-date`} type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
        <div>
          <label htmlFor={`${formId}-format`} className="block text-sm font-medium text-neutral-700 mb-1">Format</label>
          <NativeSelect id={`${formId}-format`} value={format} onChange={(e) => { setFormat(e.target.value); if (e.target.value.toLowerCase() !== "single") setParentReleaseId(""); }}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
            <option value="single">Single</option>
            <option value="EP">EP</option>
            <option value="album">Album</option>
          </NativeSelect>
        </div>
      </div>
      {isSingle && parentReleases.length > 0 && (
        <div>
          <label htmlFor={`${formId}-parent-release`} className="block text-sm font-medium text-neutral-700 mb-1">Part of an EP rollout</label>
          <NativeSelect id={`${formId}-parent-release`} value={parentReleaseId} onChange={(e) => setParentReleaseId(e.target.value)} className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
            <option value="">— Independent release —</option>
            {parentReleases.filter((release) => release.id !== initial?.id && release.format != null && ["ep", "album"].includes(release.format.toLowerCase())).map((release) => <option key={release.id} value={release.id}>{release.title} ({release.format})</option>)}
          </NativeSelect>
          <p className="mt-1 text-xs text-muted-foreground">The single keeps its own release plan, budget, and results, while appearing in the parent EP’s rollout.</p>
        </div>
      )}
      <div>
        <label htmlFor={`${formId}-status`} className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
        <NativeSelect id={`${formId}-status`} value={status} onChange={(e) => setStatus(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="released">Released</option>
          <option value="archived">Archived</option>
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-upc`} className="block text-sm font-medium text-neutral-700 mb-1">UPC/EAN</label>
          <Input id={`${formId}-upc`} value={upc} onChange={(e) => setUpc(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
        <div>
          <label htmlFor={`${formId}-cover-art`} className="block text-sm font-medium text-neutral-700 mb-1">Cover Art URL</label>
          <Input id={`${formId}-cover-art`} value={coverArt} onChange={(e) => setCoverArt(e.target.value)} placeholder="https://..."
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost" type="submit" disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Release"}
        </Button>
      </div>
    </form>
  );
}
