"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ContactForm, type Contact } from "./ContactForm";

import { Button } from "@/components/ui/button";
export function ContactEditButton({ contact, className, children }: { contact: Contact; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={className ?? "px-2.5 py-1 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded-md transition-colors"}
        aria-label={`Edit ${contact.name}`}
      >
        {children ?? "Edit"}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Edit Contact</h2>
            <ContactForm initial={contact} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

export function ContactDeleteButton({ contact, className, children }: { contact: Contact; className?: string; children?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contact.id }),
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
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
        className={className ?? "px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"}
        aria-label={`Delete ${contact.name}`}
      >
        {children ?? "Delete"}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !loading && setConfirming(false)}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Delete {contact.name}?</h2>
        <p className="text-sm text-muted-foreground mb-4">This will permanently remove the contact. This action cannot be undone.</p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button onClick={() => setConfirming(false)} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button variant="ghost" onClick={onDelete} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
