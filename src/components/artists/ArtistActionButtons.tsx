"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ArtistForm, type Artist, type ArtistFocusField, type ContactOption } from "./ArtistForm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
type ArtistEditButtonVariant = "primary" | "secondary";

const BUTTON_LABELS: Record<ArtistFocusField, string> = {
  bio: "Bio",
  pro: "PRO",
  ipi: "IPI",
  spotify_id: "Spotify ID",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export function ArtistEditButton({
  artist,
  focusField,
  label,
  contactOptions,
  variant = "primary",
}: {
  artist: Artist;
  focusField?: ArtistFocusField;
  label?: string;
  contactOptions?: ContactOption[];
  variant?: ArtistEditButtonVariant;
}) {
  const [open, setOpen] = useState(false);

  const buttonLabel = label || "Edit";
  const focusSuffix = focusField ? ` ${BUTTON_LABELS[focusField]}` : "";

  return (
    <>
      <Button variant={variant === "secondary" ? "ghost" : "outline"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Edit ${artist.name}${focusSuffix}`}
        data-focus-field={focusField || ""}
      >
        <Pencil className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
      <ArtistEditDialog
        artist={artist}
        focusField={focusField}
        contactOptions={contactOptions}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function ArtistEditDialog({
  artist,
  focusField,
  contactOptions,
  open,
  onOpenChange,
}: {
  artist: Artist;
  focusField?: ArtistFocusField;
  contactOptions?: ContactOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>Edit Artist</DialogTitle>
        <ArtistForm
          initial={artist}
          focusField={focusField}
          contactOptions={contactOptions}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ArtistDeleteButton({ artist }: { artist: Artist }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/artists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: artist.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="destructive"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        aria-label={`Delete ${artist.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
    );
  }

  return (
    <Dialog open={confirming} onOpenChange={open => { if (!loading) setConfirming(open); }}>
      <DialogContent showCloseButton={!loading} aria-describedby={undefined}>
        <DialogTitle>Delete {artist.name}?</DialogTitle>
        <p className="text-sm text-muted-foreground mb-4">This will permanently remove the artist. This action cannot be undone.</p>
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={onDelete} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
