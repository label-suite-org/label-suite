"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ArtistForm } from "./ArtistForm";
import type { ContactOption } from "./ArtistForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogHeader, DialogDescription } from "@/components/ui/dialog";
export function ArtistCreateDialog({ contactOptions }: { contactOptions?: ContactOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus aria-hidden="true" />
        New Artist
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>New Artist</DialogTitle>
          <DialogDescription>Start with a name. You can add profile details later.</DialogDescription>
        </DialogHeader>
        <ArtistForm onClose={() => setOpen(false)} contactOptions={contactOptions} />
      </DialogContent>
    </Dialog>
  );
}
