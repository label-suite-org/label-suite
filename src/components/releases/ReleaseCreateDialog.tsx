"use client";

import { useState } from "react";
import { ReleaseForm } from "./ReleaseForm";

import { Button } from "@/components/ui/button";
export function ReleaseCreateDialog({ artists, parentReleases }: { artists: Array<{ id: string; name: string }>; parentReleases?: Array<{ id: string; title: string; format?: string | null }> }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
      >
        + New Release
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">New Release</h2>
        <ReleaseForm artists={artists} parentReleases={parentReleases} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
