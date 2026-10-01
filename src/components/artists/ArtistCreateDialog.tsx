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
      />}>
        <Plus className="h-4 w-4" />
        New Artist
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>New Artist</DialogTitle>
        <ArtistForm onClose={() => setOpen(false)} contactOptions={contactOptions} />
      </DialogContent>
    </Dialog>
  );
}
