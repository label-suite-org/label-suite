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
  const buttonClasses =
    variant === "secondary"
      ? "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      : "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <>
      <Button variant="outline"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={buttonClasses}
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
      <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-lg">
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
      <Button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
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
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button variant="ghost" onClick={onDelete} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
