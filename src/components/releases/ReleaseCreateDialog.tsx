"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ReleaseForm } from "./ReleaseForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogHeader, DialogDescription } from "@/components/ui/dialog";
export function ReleaseCreateDialog({ artists, parentReleases }: { artists: Array<{ id: string; name: string }>; parentReleases?: Array<{ id: string; title: string; format?: string | null }> }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Plus aria-hidden="true" />New Release</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>New Release</DialogTitle>
          <DialogDescription>Connect the artist and release details. You can finish setup later.</DialogDescription>
        </DialogHeader>
        <ReleaseForm artists={artists} parentReleases={parentReleases} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
