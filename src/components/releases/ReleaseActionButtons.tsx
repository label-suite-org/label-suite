"use client";

import { useState } from "react";
import { ReleaseForm, type Release } from "./ReleaseForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
export function ReleaseEditButton({ release, artists, parentReleases = [] }: { release: Release; artists: Array<{ id: string; name: string }>; parentReleases?: Array<{ id: string; title: string; format?: string | null }> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
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

function EditDialog({ release, artists, parentReleases, onClose }: { release: Release; artists: Array<{ id: string; name: string }>; parentReleases: Array<{ id: string; title: string; format?: string | null }>; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle>Edit Release</DialogTitle>
        <ReleaseForm initial={release} artists={artists} parentReleases={parentReleases} onClose={onClose} />
      </DialogContent>
    </Dialog>
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
      <Button variant="destructive"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
        aria-label={`Delete ${release.title}`}
      >
        Delete
      </Button>
    );
  }

  return (
    <Dialog open={confirming} onOpenChange={open => { if (!loading) setConfirming(open); }}>
      <DialogContent showCloseButton={!loading} aria-describedby={undefined}>
        <DialogTitle>Delete {release.title}?</DialogTitle>
        <p className="text-sm text-muted-foreground mb-2">
          This deletes linked tracks, budget items, single-release pitches, and side-artist links. Multi-release pitches and other linked records keep their history and are detached.
        </p>
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={onDelete} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
