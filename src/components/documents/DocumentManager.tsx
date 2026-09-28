"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveFileUrl } from "../../lib/storage-client";
import { DocumentForm, type DocumentRecord } from "./DocumentForm";
import { getResourceAttention, matchesResourceAttentionFilter, type ResourceAttentionFilter } from "../resource-attention";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/external-url";
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  signed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  filed: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  archived: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border sticky top-0 bg-card">
          <h2 className="text-xl font-bold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted">
            ×
          </Button>
        </div>
        <div className="p-6 pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}

export function DocumentManager({
  initialDocuments,
  defaultContactId,
  artists,
  releases,
  contacts,
  projects,
  canMutate = true,
}: {
  initialDocuments: DocumentRecord[];
  defaultContactId?: string;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  contacts: Array<{ id: string; name: string }>;
  projects?: Array<{ id: string; name: string }>;
  canMutate?: boolean;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAttention, setFilterAttention] = useState<ResourceAttentionFilter>("all");
  const projectOptions = projects ?? [];

  const attentionFor = (doc: DocumentRecord) => getResourceAttention({
    hasOwner: Boolean(doc.artist_id || doc.release_id || doc.contact_id || doc.project_id || doc.grant_application_count),
    fileLink: doc.file_link,
    reviewed: Boolean(doc.status && doc.status !== "draft" && doc.status !== "review"),
  });

  useEffect(() => {
    if (!creating && !editingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCreating(false);
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, editingId]);

  const filtered = useMemo(() => {
    let result = documents;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((doc) =>
        doc.name.toLowerCase().includes(q)
        || (doc.doc_type || "").toLowerCase().includes(q)
        || (doc.artist_name || "").toLowerCase().includes(q)
        || (doc.release_title || "").toLowerCase().includes(q)
        || (doc.contact_name || "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") {
      result = result.filter((doc) => (doc.status || "draft") === filterStatus);
    }
    if (filterAttention !== "all") {
      result = result.filter((doc) => {
        const attention = attentionFor(doc);
        return matchesResourceAttentionFilter(attention, filterAttention);
      });
    }
    return result;
  }, [documents, filterAttention, filterStatus, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentRecord[]>();
    for (const doc of filtered) {
      const key = doc.status || "draft";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(doc);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function deleteDocument(id: string) {
    if (!confirm("Delete this document?")) return;
    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch (err: any) {
      alert(err.message || "Delete failed");
    }
  }

  async function openFile(fileLink?: string | null) {
    if (!fileLink) return;
    try {
      const url = await resolveFileUrl(fileLink);
      openExternalUrl(url);
    } catch (err: any) {
      alert(err.message || "Could not open file");
    }
  }

  const editing = documents.find((doc) => doc.id === editingId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents, artists, releases, contacts..."
          className="flex-1 min-w-[240px] px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
        <NativeSelect
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        >
          <option value="all">All statuses</option>
          {Object.keys(STATUS_STYLES).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={filterAttention} onChange={(e) => setFilterAttention(e.target.value as ResourceAttentionFilter)} aria-label="Ownership and evidence state" className="px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
          <option value="all">All ownership states</option>
          <option value="needs_attention">Needs attention</option>
          <option value="orphaned">No owner</option>
          <option value="missing">Missing file</option>
          <option value="unreviewed">Unreviewed</option>
        </NativeSelect>
        {canMutate ? <Button onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 shrink-0">
          + Add document
        </Button> : <span className="text-sm text-muted-foreground">Read-only for fundraiser</span>}
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {documents.length} document{documents.length === 1 ? "" : "s"}
        {search.trim() || filterStatus !== "all" ? " match your filters" : " in the library"}
      </p>

      {!documents.length && !creating ? (
        <div className="p-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <p className="text-lg">No documents yet.</p>
          <p className="text-sm mt-1">Store contracts, one-sheets, invoices, and legal paperwork here.</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground border border-border rounded-xl">No documents match your filters.</div>
      ) : (
        grouped.map(([status, rows]) => {
          const dotStyle = STATUS_STYLES[status] || STATUS_STYLES.draft;
          return (
            <section key={status} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotStyle.split(" ").find(c => c.startsWith("bg-"))}`} aria-hidden />
                <h2 className="text-base font-semibold capitalize tracking-tight">{status.replace(/_/g, " ")}</h2>
                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{rows.length}</span>
              </div>
              <div className="bg-card border border-border rounded-xl divide-y divide-border">
                {rows.map((doc) => (
                  <div key={doc.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{doc.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[doc.doc_type, doc.artist_name && `Artist: ${doc.artist_name}`, doc.release_title && `Release: ${doc.release_title}`, doc.contact_name && `Contact: ${doc.contact_name}`, doc.project_name && `Project: ${doc.project_name}`, doc.grant_application_count ? `Grant evidence (${doc.grant_application_count})` : null].filter(Boolean).join(" · ") || "No owner"}
                          </p>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium shrink-0 ${STATUS_STYLES[doc.status || "draft"] || "bg-muted text-muted-foreground"}`}>
                          {(doc.status || "draft").replace(/_/g, " ")}
                        </span>
                      </div>
                      {doc.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{doc.notes}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {attentionFor(doc).orphaned && <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">No owner</span>}
                        {attentionFor(doc).missing && <span className="rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Missing file</span>}
                        {attentionFor(doc).unreviewed && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Unreviewed</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {doc.file_link && (
                        <Button onClick={() => openFile(doc.file_link)} className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80">Open</Button>
                      )}
                      {canMutate && <><Button onClick={() => setEditingId(doc.id)} className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80">{attentionFor(doc).orphaned ? "Repair ownership" : "Edit"}</Button>
                      <Button onClick={() => deleteDocument(doc.id)} className="px-2.5 py-1 text-xs rounded-md bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-400">Delete</Button></>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}

      {canMutate && creating && (
        <ModalShell title="Add document" onClose={() => setCreating(false)}>
          <DocumentForm defaultContactId={defaultContactId} artists={artists} releases={releases} contacts={contacts} projects={projectOptions} onClose={() => setCreating(false)} />
        </ModalShell>
      )}

      {canMutate && editing && (
        <ModalShell title="Edit document" onClose={() => setEditingId(null)}>
          <DocumentForm initial={editing} artists={artists} releases={releases} contacts={contacts} projects={projectOptions} onClose={() => setEditingId(null)} />
        </ModalShell>
      )}
    </div>
  );
}
