"use client";

import { useState } from "react";
import { WorkForm, type Work } from "./WorkForm";

import { Button } from "@/components/ui/button";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">New Work</h2>
        <WorkForm onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}

export function WorkEditButton({ work }: { work: Work & { id: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded bg-muted hover:bg-accent transition-colors"
      >
        Edit
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Edit Work</h2>
            <WorkForm initial={work} onClose={() => setOpen(false)} />
          </div>
        </div>
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
      <Button
        onClick={() => setConfirming(true)}
        className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 transition-colors"
      >
        Delete
      </Button>
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirming(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete Work?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will remove <strong>{work.title}</strong>. Tracks linked to this work will be orphaned.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Button onClick={() => setConfirming(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button variant="ghost" onClick={doDelete} disabled={loading}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
                {loading ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
