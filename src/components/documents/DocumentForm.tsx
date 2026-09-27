"use client";

import { useState, type FormEvent } from "react";
import { uploadFileToStorage } from "../../lib/storage-client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface DocumentRecord {
  id: string;
  name: string;
  doc_type?: string | null;
  release_id?: string | null;
  artist_id?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  status?: string | null;
  file_link?: string | null;
  notes?: string | null;
  release_title?: string | null;
  artist_name?: string | null;
  contact_name?: string | null;
  project_name?: string | null;
  grant_application_count?: number;
}

const DOC_TYPES = ["contract", "invoice", "one_sheet", "press_release", "artwork", "metadata", "legal", "other"];
const STATUSES = ["draft", "review", "sent", "signed", "filed", "archived"];

export function DocumentForm({
  initial,
  artists,
  releases,
  contacts,
  projects,
  onClose,
}: {
  initial?: DocumentRecord | null;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  contacts: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [docType, setDocType] = useState(initial?.doc_type || "contract");
  const [releaseId, setReleaseId] = useState(initial?.release_id || "");
  const [artistId, setArtistId] = useState(initial?.artist_id || "");
  const [contactId, setContactId] = useState(initial?.contact_id || "");
  const [projectId, setProjectId] = useState(initial?.project_id || "");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [fileLink, setFileLink] = useState(initial?.file_link || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let finalFileLink = fileLink || null;
      if (file) {
        const uploaded = await uploadFileToStorage(file, "documents");
        finalFileLink = uploaded.key;
      }

      const body: Record<string, unknown> = {
        name,
        doc_type: docType || null,
        release_id: releaseId || null,
        artist_id: artistId || null,
        contact_id: contactId || null,
        project_id: projectId || null,
        status: status || null,
        file_link: finalFileLink,
        notes: notes || null,
      };

      const res = await fetch("/api/documents", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} document`);
      }

      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Document name *</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Document type</label>
          <NativeSelect value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
            {DOC_TYPES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Status</label>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Artist</label>
          <NativeSelect value={artistId} onChange={(e) => setArtistId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
            <option value="">— None —</option>
            {artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Release</label>
          <NativeSelect value={releaseId} onChange={(e) => setReleaseId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
            <option value="">— None —</option>
            {releases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Contact</label>
          <NativeSelect value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
            <option value="">— None —</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </NativeSelect>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Project</label>
        <NativeSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
          <option value="">— None —</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </NativeSelect>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Upload file</label>
          <label className="flex items-center justify-center w-full min-h-24 border-2 border-dashed border-border rounded-xl px-4 py-3 text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors">
            <Input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span>{file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : "Choose file"}</span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Manual file link / storage key</label>
          <Input
            value={fileLink}
            onChange={(e) => setFileLink(e.target.value)}
            placeholder="https://... or documents/..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
        <Button type="submit" disabled={loading} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50">
          {loading ? (file ? "Uploading..." : "Saving...") : isEdit ? "Save changes" : "Create document"}
        </Button>
      </div>
    </form>
  );
}
