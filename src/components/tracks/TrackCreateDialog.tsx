"use client";

import { useState } from "react";
import { TrackForm } from "./TrackForm";

import { Button } from "@/components/ui/button";
export function TrackCreateDialog({ releaseId, works }: {
  releaseId: string;
  works: Array<{ id: string; title: string; isrc: string | null }>;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors">
        + Add Track
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4">
        <h2 className="text-xl font-bold mb-4">New Track</h2>
        <TrackForm releaseId={releaseId} works={works} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}