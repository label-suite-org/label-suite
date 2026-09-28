"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ArtistForm } from "./ArtistForm";
import type { ContactOption } from "./ArtistForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
export function ArtistCreateDialog({ contactOptions }: { contactOptions?: ContactOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
      />}>
        <Plus className="h-4 w-4" />
        New Artist
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-lg">
        <DialogTitle>New Artist</DialogTitle>
        <ArtistForm onClose={() => setOpen(false)} contactOptions={contactOptions} />
      </DialogContent>
    </Dialog>
  );
}
