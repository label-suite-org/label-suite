"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ContactForm } from "./ContactForm";

import { Button } from "@/components/ui/button";
export function ContactCreateDialog() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 transition-colors"
      >
        <Plus className="mr-2 size-4" />
        New Contact
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">New Contact</h2>
        <ContactForm onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
