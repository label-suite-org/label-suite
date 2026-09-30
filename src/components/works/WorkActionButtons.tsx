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
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
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
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirming(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button variant="ghost" onClick={doDelete} disabled={loading}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
                {loading ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
