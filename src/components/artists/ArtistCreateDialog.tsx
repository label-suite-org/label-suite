"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ArtistForm } from "./ArtistForm";
import type { ContactOption } from "./ArtistForm";

import { Button } from "@/components/ui/button";
export function ArtistCreateDialog({ contactOptions }: { contactOptions?: ContactOption[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
      >
        <Plus className="h-4 w-4" />
        New Artist
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">New Artist</h2>
        <ArtistForm onClose={() => setOpen(false)} contactOptions={contactOptions} />
      </div>
    </div>
  );
}
