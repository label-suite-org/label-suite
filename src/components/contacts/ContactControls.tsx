"use client";

import { useState } from "react";
import { Building2, Globe2, Image as ImageIcon, Link2, Mail, MapPin, MessageSquareText, Pencil, Phone, Save, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import type { CompletenessFilter, DirectoryContact, Organization } from "./contact-types";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const avatarStyles = [
  "bg-[#111827] text-white",
  "bg-[#194d44] text-white",
  "bg-[#7c2d12] text-white",
  "bg-[#1e3a8a] text-white",
  "bg-[#4c1d95] text-white",
  "bg-[#365314] text-white",
];

export const completenessLabels: Record<CompletenessFilter, string> = {
  all: "All records",
  "has-image": "Has image",
  "missing-email": "Needs email",
  "missing-phone": "Needs phone",
  "has-notes": "Has notes",
  "missing-organization": "Needs organization",
};

export function normalizeValue(value?: string | null, fallback = "Unassigned") {
  return value?.trim() || fallback;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "C"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function hashClass(id: string, name: string) {
  let hash = 0;
  for (const char of id || name) hash += char.charCodeAt(0);
  return avatarStyles[hash % avatarStyles.length] ?? avatarStyles[0];
}

export function ContactAvatar({ contact, size = "md" }: { contact: DirectoryContact; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-24 text-2xl" : size === "sm" ? "size-10 text-xs" : "size-12 text-sm";

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold shadow-sm ring-1 ring-black/5 ${sizeClass} ${hashClass(contact.id, contact.name)}`}>
      {contact.image_url ? (
        <img src={contact.image_url} alt="" width={96} height={96} className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span>{initials(contact.name)}</span>
      )}
    </div>
  );
}

export function OrganizationAvatar({ organization, size = "md" }: { organization: Organization; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-24 text-2xl" : size === "sm" ? "size-10 text-xs" : "size-12 text-sm";

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg font-semibold shadow-sm ring-1 ring-black/5 ${sizeClass} ${hashClass(organization.id, organization.name)}`}>
      <Building2 className={size === "lg" ? "size-9" : "size-4"} />
    </div>
  );
}

export function formatDate(value?: string | Date | null) {
  if (!value) return "Not updated yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function emptyFallback(value?: string | null) {
  return value?.trim() || "Not set";
}

export function primaryOrganization(contact: DirectoryContact) {
  return contact.organization_links.find((link) => link.is_primary) ?? contact.organization_links[0] ?? null;
}

export async function apiWrite(path: string, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Save failed");
  }
  return response.json();
}

export function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      <span className="truncate">{label}</span>
      <span>{count}</span>
    </div>
  );
}

export function InlineText({ value, onSave, className, canEdit = true }: { value: string; onSave: (value: string) => Promise<void>; className?: string; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={`min-w-0 rounded-md border border-border bg-background px-2 py-1 outline-none focus:ring-2 focus:ring-ring/30 ${className ?? ""}`}
        />
        <Button type="button" onClick={save} disabled={saving} className="inline-flex size-8 items-center justify-center rounded-md bg-foreground text-background">
          <Save className="size-4" />
        </Button>
        <Button type="button" onClick={() => { setDraft(value); setEditing(false); }} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </Button>
      </span>
    );
  }

  if (!canEdit) return <span className={`inline-block truncate ${className ?? ""}`}>{value}</span>;

  return (
    <Button type="button" onClick={() => setEditing(true)} className={`group inline-flex min-w-0 max-w-full items-center gap-2 text-left ${className ?? ""}`}>
      <span className="truncate">{value}</span>
      <Pencil className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
    </Button>
  );
}

export function InlineLabelField({ label, value, onSave, canEdit = true }: { label: string; value?: string | null; onSave: (value: string) => Promise<void>; canEdit?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <InlineText value={value || "Not set"} onSave={onSave} canEdit={canEdit} className="mt-1 text-sm font-medium" />
    </div>
  );
}

export function EditableInfoRow({
  icon: Icon,
  label,
  value,
  onSave,
  canEdit = true,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  onSave: (value: string) => Promise<void>;
  canEdit?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <InlineText value={value || "Not set"} onSave={onSave} canEdit={canEdit} className="text-sm font-medium" />
      </span>
    </div>
  );
}

export function EditableBlock({ value, onSave, canEdit = true }: { value?: string | null; onSave: (value: string) => Promise<void>; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border bg-muted/25 p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          className="w-full resize-none bg-transparent text-sm leading-6 outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" onClick={() => { setDraft(value || ""); setEditing(false); }} className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving} className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  if (!canEdit) return <div className="block min-h-32 w-full rounded-lg border border-border bg-muted/25 p-4 text-left text-sm leading-6 text-muted-foreground">{value || "No notes yet."}</div>;

  return (
    <Button
      type="button"
      onClick={() => setEditing(true)}
      className="block min-h-32 w-full rounded-lg border border-border bg-muted/25 p-4 text-left text-sm leading-6 text-muted-foreground transition hover:border-foreground/30"
    >
      {value ? value : "No notes yet."}
    </Button>
  );
}

export function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
      className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:text-foreground"
      aria-label={label}
    >
      <Icon className="size-4" />
    </a>
  );
}

export function HealthPanel({ contact }: { contact: DirectoryContact }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Directory health</h3>
      <div className="mt-3 space-y-2 text-sm">
        <HealthRow complete={!!contact.image_url} icon={ImageIcon} label="Image" />
        <HealthRow complete={!!contact.email} icon={Mail} label="Email" />
        <HealthRow complete={!!contact.phone} icon={Phone} label="Phone" />
        <HealthRow complete={!!contact.website} icon={Globe2} label="Website" />
        <HealthRow complete={!!contact.linkedin_url} icon={Link2} label="LinkedIn" />
        <HealthRow complete={!!contact.address} icon={MapPin} label="Address" />
        <HealthRow complete={!!contact.notes} icon={MessageSquareText} label="Notes" />
        <HealthRow complete={contact.organization_links.length > 0} icon={Building2} label="Organization" />
      </div>
    </div>
  );
}

export function HealthRow({ complete, icon: Icon, label }: { complete: boolean; icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </span>
      <span className={`text-xs font-medium ${complete ? "text-foreground" : "text-muted-foreground"}`}>
        {complete ? "Ready" : "Missing"}
      </span>
    </div>
  );
}

export function RecordPanel({ createdAt, updatedAt, source }: { createdAt?: string | Date | null; updatedAt?: string | Date | null; source: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Record</h3>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        <div>{source}</div>
        <div>Updated {formatDate(updatedAt ?? createdAt)}</div>
      </div>
    </div>
  );
}

export function ControlSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Icon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none truncate rounded-md border border-border bg-background pl-8 pr-7 text-xs font-medium text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-ring/30"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </NativeSelect>
      <SlidersHorizontal className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </label>
  );
}
