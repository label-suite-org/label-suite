"use client";

import { useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
export interface Track {
  id: string;
  title: string;
  release_id: string | null;
  work_id?: string | null;
  position?: number | null;
  version?: string | null;
  isrc?: string | null;
  audio_url?: string | null;
  duration?: number | null;
}

export function TrackEditDialog({ track, works, onClose }: {
  track: Track;
  works: Array<{ id: string; title: string; isrc: string | null }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [position, setPosition] = useState(track.position?.toString() || "");
  const [version, setVersion] = useState(track.version || "Main");
  const [isrc, setIsrc] = useState(track.isrc || "");
  const [audioUrl, setAudioUrl] = useState(track.audio_url || "");
  const [duration, setDuration] = useState(track.duration?.toString() || "");
  const [workId, setWorkId] = useState(track.work_id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tracks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: track.id,
          title,
          position: position ? Number(position) : null,
          version,
          isrc: isrc || null,
          audio_url: audioUrl || null,
          duration: duration ? Number(duration) : null,
          work_id: workId || null,
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
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle>Edit Track</DialogTitle>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Position</label>
              <Input type="number" value={position} onChange={(e) => setPosition(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Version</label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ISRC</label>
            <Input value={isrc} onChange={(e) => setIsrc(e.target.value)} placeholder="DKO7P2500001"
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Audio URL</label>
            <Input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://..."
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Duration (seconds)</label>
            <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Linked work</label>
            <NativeSelect value={workId} onChange={(e) => setWorkId(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— No work linked —</option>
              {works.map((w) => <option key={w.id} value={w.id}>{w.title} {w.isrc ? `(${w.isrc})` : ""}</option>)}
            </NativeSelect>
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
      </DialogContent>
    </Dialog>
  );
}

export function TrackEditButton({ track, works }: { track: Track; works: Array<{ id: string; title: string; isrc: string | null }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="px-2.5 py-1 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded-md transition-colors"
        aria-label={`Edit ${track.title}`}
      >
        Edit
      </Button>
      {open && <TrackEditDialog track={track} works={works} onClose={() => setOpen(false)} />}
    </>
  );
}

export function TrackDeleteButton({ track }: { track: Track }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tracks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: track.id }),
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
      <Button variant="destructive"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
        className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
        aria-label={`Delete ${track.title}`}
      >
        Delete
      </Button>
    );
  }

  return (
    <Dialog open={confirming} onOpenChange={open => { if (!loading) setConfirming(open); }}>
      <DialogContent showCloseButton={!loading} aria-describedby={undefined}>
        <DialogTitle>Delete {track.title}?</DialogTitle>
        <p className="text-sm text-muted-foreground mb-4">This will permanently remove the track. This action cannot be undone.</p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button variant="ghost" onClick={onDelete} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}