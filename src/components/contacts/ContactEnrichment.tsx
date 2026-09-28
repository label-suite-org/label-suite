"use client";

import { useState, type FormEvent } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import type { ContactOrganizationLink } from "./ContactForm";
import type { DirectoryContact, EnrichmentScanState, EnrichmentSuggestion, GmailConnection, Organization } from "./contact-types";
import { apiWrite } from "./ContactControls";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export function AddOrganizationLink({
  contact,
  organizations,
  onCreateOrganization,
  onAddLink,
}: {
  contact: DirectoryContact;
  organizations: Organization[];
  onCreateOrganization: (organization: Organization) => void;
  onAddLink: (contactId: string, link: ContactOrganizationLink) => void;
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      let targetOrganization = organizations.find((organization) => organization.id === organizationId) ?? null;
      if (newOrganizationName.trim()) {
        const result = await apiWrite("/api/organizations", "POST", {
          name: newOrganizationName.trim(),
          type: "company",
        });
        targetOrganization = {
          id: result.id,
          name: newOrganizationName.trim(),
          type: "company",
          contact_count: 0,
          source: "manual",
        };
        onCreateOrganization(targetOrganization);
        setOrganizationId(result.id);
      }

      if (!targetOrganization) throw new Error("Choose or create an organization");

      const linkResult = await apiWrite("/api/contact-organizations", "POST", {
        contact_id: contact.id,
        organization_id: targetOrganization.id,
        title,
        relationship_type: "works_at",
        is_primary: contact.organization_links.length === 0,
      });

      onAddLink(contact.id, {
        id: linkResult.id,
        contact_id: contact.id,
        organization_id: targetOrganization.id,
        organization_name: targetOrganization.name,
        organization_type: targetOrganization.type ?? null,
        organization_website: targetOrganization.website ?? null,
        organization_linkedin_url: targetOrganization.linkedin_url ?? null,
        title: title.trim() || null,
        department: null,
        relationship_type: "works_at",
        is_primary: contact.organization_links.length === 0,
        source: "manual",
        confidence: 1,
      });
      setNewOrganizationName("");
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link organization");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-dashed border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Existing organization</span>
          <NativeSelect
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Title</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Manager, Lawyer..."
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        </label>
      </div>
      <label className="mt-2 block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Or create organization</span>
        <Input
          value={newOrganizationName}
          onChange={(event) => setNewOrganizationName(event.target.value)}
          placeholder="New company name"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <Button
        type="submit"
        disabled={saving}
        className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {saving ? "Linking..." : "Link organization"}
      </Button>
    </form>
  );
}

export function ContactEnrichmentPanel({
  connected,
  connection,
  scanState,
  suggestions,
  onConnect,
  onScan,
  onResolve,
}: {
  connected: boolean;
  connection?: GmailConnection | null;
  scanState: EnrichmentScanState;
  suggestions: EnrichmentSuggestion[];
  onConnect: () => Promise<void>;
  onScan: () => Promise<unknown>;
  onResolve: (suggestion: EnrichmentSuggestion, action: "apply" | "ignore") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Could not complete Gmail action";
      setMessage(gmailActionMessage(rawMessage));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Gmail suggestions</h3>
        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${connected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Extracts missing fields from Gmail signatures and headers for review.
      </p>
      {connection?.email && (
        <p className="mt-2 text-xs text-muted-foreground">
          Source: Gmail · {connection.email}
          {connection.last_scan_at ? ` · Last successful scan ${formatDate(connection.last_scan_at)}` : " · No successful scan yet"}
        </p>
      )}
      <Button
        type="button"
        onClick={() => run(connected ? onScan : onConnect, connected ? "Scan complete" : "Opening Gmail")}
        disabled={busy}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="size-3.5" />
        {busy ? "Working..." : connected ? "Scan this contact" : "Connect Gmail"}
      </Button>
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
      {scanState.status === "running" && <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">Scan in progress…</p>}
      {scanState.status === "error" && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          Scan failed: {gmailActionMessage(scanState.message ?? "Could not scan Gmail")}
        </p>
      )}
      {scanState.status === "success" && (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs leading-5 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
          Scanned {scanState.scanned_contacts ?? 0} contact{scanState.scanned_contacts === 1 ? "" : "s"} and {scanState.scanned_messages ?? 0} message{scanState.scanned_messages === 1 ? "" : "s"}; {scanState.suggestions_created ?? 0} new suggestion{scanState.suggestions_created === 1 ? "" : "s"}.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {suggestions.length ? (
          suggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border border-border bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {suggestionLabel(suggestion.field)}
                  </span>
                  <span className="mt-1 block break-words text-sm font-medium">{suggestion.value}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{Math.round(suggestion.confidence * 100)}%</span>
              </div>
              <EvidenceLine evidence={suggestion.evidence} />
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Provenance: {suggestion.source_type || "unknown source"}{suggestion.source_email ? ` · ${suggestion.source_email}` : ""}
                {suggestion.created_at ? ` · observed ${formatDate(suggestion.created_at)}` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={() => run(() => onResolve(suggestion, "apply"), "Suggestion applied")}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-foreground px-2 text-xs font-medium text-background"
                >
                  <Check className="size-3.5" />
                  Accept
                </Button>
                <Button
                  type="button"
                  onClick={() => run(() => onResolve(suggestion, "ignore"), "Suggestion ignored")}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground"
                >
                  <X className="size-3.5" />
                  Ignore
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">
            No pending suggestions for this contact yet.
          </div>
        )}
      </div>
    </div>
  );
}

function gmailActionMessage(message: string) {
  if (message.includes("GOOGLE_CLIENT_ID") || message.includes("GOOGLE_CLIENT_SECRET")) {
    return "Gmail is not configured yet. Add Google OAuth credentials to .env, then restart the dev server.";
  }
  if (message.includes("GMAIL_TOKEN_SECRET")) {
    return "Gmail needs GMAIL_TOKEN_SECRET or BETTER_AUTH_SECRET in .env before it can store tokens.";
  }
  return message;
}

function EvidenceLine({ evidence }: { evidence?: Record<string, unknown> | null }) {
  const from = typeof evidence?.from === "string" ? evidence.from : "";
  const subject = typeof evidence?.subject === "string" ? evidence.subject : "";
  const snippet = typeof evidence?.snippet === "string" ? evidence.snippet : "";
  const text = [from, subject || snippet].filter(Boolean).join(" · ");
  if (!text) return null;
  return <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{text}</p>;
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function suggestionLabel(field: string) {
  const labels: Record<string, string> = {
    email: "Email",
    phone: "Phone",
    website: "Website",
    linkedin_url: "LinkedIn",
    address: "Address",
    role: "Role",
    organization_name: "Organization",
  };
  return labels[field] ?? field;
}
