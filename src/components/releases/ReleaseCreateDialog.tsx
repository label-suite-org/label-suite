"use client";

import { useState } from "react";
import { ReleaseForm } from "./ReleaseForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
export function ReleaseCreateDialog({ artists, parentReleases }: { artists: Array<{ id: string; name: string }>; parentReleases?: Array<{ id: string; title: string; format?: string | null }> }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>+ New Release</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle>New Release</DialogTitle>
        <ReleaseForm artists={artists} parentReleases={parentReleases} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
