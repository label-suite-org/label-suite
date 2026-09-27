"use client";

import { useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
export interface Contact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  image_url?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  address?: string | null;
  role?: string | null;
  company?: string | null;
  notes?: string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  organization_links?: ContactOrganizationLink[];
}

export interface ContactOrganizationLink {
  id: string;
  contact_id: string;
  organization_id: string;
  organization_name: string;
  organization_type?: string | null;
  organization_website?: string | null;
  organization_linkedin_url?: string | null;
  title?: string | null;
  department?: string | null;
  relationship_type?: string | null;
  is_primary?: boolean | null;
  source?: string | null;
  confidence?: number | null;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "C") + (parts[1]?.[0] ?? "");
}

export function ContactForm({ initial, onClose }: { initial?: Contact | null; onClose: () => void }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url || "");
  const [role, setRole] = useState(initial?.role || "");
  const [company, setCompany] = useState(initial?.company || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = { name, email, phone, image_url: imageUrl, role, company, notes };
      const res = await fetch("/api/contacts", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} contact`);
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-sm font-semibold text-white">
          {imageUrl ? (
            <img src={imageUrl} alt="" width={96} height={96} decoding="async" className="size-full object-cover" />
          ) : (
            <span>{initials(name || initial?.name || "Contact")}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <label className="block text-sm font-medium text-neutral-700 mb-1">Image URL</label>
          <Input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Name *</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Phone</label>
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Role</label>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Manager, Lawyer..."
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Company</label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Notes</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost" type="submit" disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Contact"}
        </Button>
      </div>
    </form>
  );
}
