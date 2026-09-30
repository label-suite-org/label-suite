"use client";

import { useState } from "react";
import { WorkForm, type Work } from "./WorkForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
export function WorkCreateDialog() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
      >
        + New Work
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle>New Work</DialogTitle>
        <WorkForm onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function WorkEditButton({ work }: { work: Work & { id: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline"
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
            <DialogTitle>Edit Work</DialogTitle>
            <WorkForm initial={work} onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function WorkDeleteButton({ work }: { work: Work & { id: string } }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function doDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/works", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: work.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete work");
      }
      window.location.assign("/works");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="destructive"
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      {confirming && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Delete Work?</DialogTitle>
            <p className="text-sm text-muted-foreground mb-4">
              This will remove <strong>{work.title}</strong>. Tracks linked to this work will be orphaned.
            </p>
            {error && <p className="text-sm text-destructive mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={doDelete} disabled={loading}>
                {loading ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
