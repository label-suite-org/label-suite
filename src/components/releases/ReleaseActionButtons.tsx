"use client";

import { useState, type SubmitEvent } from "react";
import { type Release } from "./ReleaseForm";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export function ReleaseEditButton({ release, artists, parentReleases = [] }: { release: Release; artists: Array<{ id: string; name: string }>; parentReleases?: Array<{ id: string; title: string; format?: string | null }> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="px-2.5 py-1 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
        aria-label={`Edit ${release.title}`}
      >
        Edit
      </Button>
      {open && (
        <EditDialog release={release} artists={artists} parentReleases={parentReleases} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function EditDialog({ release, artists, parentReleases, onClose }: { release: Release; artists: any[]; parentReleases: Array<{ id: string; title: string; format?: string | null }>; onClose: () => void }) {
  const [title, setTitle] = useState(release.title);
  const [artistId, setArtistId] = useState(release.artist_id || "");
  const [parentReleaseId, setParentReleaseId] = useState(release.parent_release_id || "");
  const [releaseDate, setReleaseDate] = useState(release.release_date || "");
  const [format, setFormat] = useState(release.format || "single");
  const [status, setStatus] = useState(release.status || "draft");
  const [upc, setUpc] = useState(release.upc_ean || "");
  const [coverArt, setCoverArt] = useState(release.cover_art_url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSingle = format.toLowerCase() === "single";

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/releases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: release.id,
          title, artist_id: artistId || null, release_date: releaseDate || null,
          format, status, upc_ean: upc || null, cover_art_url: coverArt || null, parent_release_id: isSingle ? parentReleaseId || null : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">Edit Release</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          {isSingle && parentReleases.length > 0 && <div>
            <label className="block text-sm font-medium text-foreground mb-1">Part of an EP rollout</label>
            <NativeSelect value={parentReleaseId} onChange={(e) => setParentReleaseId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Independent release —</option>
              {parentReleases.filter((candidate) => candidate.id !== release.id && candidate.format != null && ["ep", "album"].includes(candidate.format.toLowerCase())).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} ({candidate.format})</option>)}
            </NativeSelect>
          </div>}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Artist</label>
            <NativeSelect value={artistId} onChange={(e) => setArtistId(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Select artist —</option>
              {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Release Date</label>
              <Input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Format</label>
              <NativeSelect value={format} onChange={(e) => { setFormat(e.target.value); if (e.target.value.toLowerCase() !== "single") setParentReleaseId(""); }}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="single">Single</option>
                <option value="EP">EP</option>
                <option value="album">Album</option>
              </NativeSelect>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Status</label>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="released">Released</option>
              <option value="archived">Archived</option>
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">UPC/EAN</label>
              <Input value={upc} onChange={(e) => setUpc(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Cover Art URL</label>
              <Input value={coverArt} onChange={(e) => setCoverArt(e.target.value)} placeholder="https://..."
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
            <Button type="submit" disabled={loading}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50">
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReleaseDeleteButton({ release }: { release: Release }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/releases", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
        className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-destructive/20"
        aria-label={`Delete ${release.title}`}
      >
        Delete
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !loading && setConfirming(false)}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Delete {release.title}?</h2>
        <p className="text-sm text-muted-foreground mb-2">
          This deletes linked tracks, budget items, single-release pitches, and side-artist links. Multi-release pitches and other linked records keep their history and are detached.
        </p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button onClick={() => setConfirming(false)} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button variant="ghost" onClick={onDelete} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
