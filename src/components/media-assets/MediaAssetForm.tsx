"use client";

import { useId, useState, type FormEvent } from "react";
import { uploadFileToStorage } from "../../lib/storage-client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface MediaAssetRecord {
  id: string;
  asset_name: string;
  asset_type?: string | null;
  linked_artist_id?: string | null;
  linked_release_id?: string | null;
  project_id?: string | null;
  version?: string | null;
  approval_status?: string | null;
  delivery_status?: string | null;
  file_link?: string | null;
  notes?: string | null;
  date_uploaded?: string | null;
  artist_name?: string | null;
  release_title?: string | null;
  project_name?: string | null;
}

const ASSET_TYPES = [
  "cover_art",
  "press_photo",
  "audio_clip",
  "video",
  "social_asset",
  "lyric_video",
  "canvas",
  "other",
];

const APPROVAL_STATUSES = ["pending", "approved", "changes_requested", "rejected"];
const DELIVERY_STATUSES = ["not_sent", "queued", "sent", "delivered"];

export function MediaAssetForm({
  initial,
  artists,
  releases,
  projects,
  onClose,
}: {
  initial?: MediaAssetRecord | null;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const formId = useId();
  const [assetName, setAssetName] = useState(initial?.asset_name || "");
  const [assetType, setAssetType] = useState(initial?.asset_type || "cover_art");
  const [linkedArtistId, setLinkedArtistId] = useState(initial?.linked_artist_id || "");
  const [linkedReleaseId, setLinkedReleaseId] = useState(initial?.linked_release_id || "");
  const [projectId, setProjectId] = useState(initial?.project_id || "");
  const [version, setVersion] = useState(initial?.version || "");
  const [approvalStatus, setApprovalStatus] = useState(initial?.approval_status || "pending");
  const [deliveryStatus, setDeliveryStatus] = useState(initial?.delivery_status || "not_sent");
  const [fileLink, setFileLink] = useState(initial?.file_link || "");
  const [dateUploaded, setDateUploaded] = useState(initial?.date_uploaded || new Date().toISOString().slice(0, 10));
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
        const uploaded = await uploadFileToStorage(file, "media-assets");
        finalFileLink = uploaded.key;
      }

      const body: Record<string, unknown> = {
        asset_name: assetName,
        asset_type: assetType || null,
        linked_artist_id: linkedArtistId || null,
        linked_release_id: linkedReleaseId || null,
        project_id: projectId || null,
        version: version || null,
        approval_status: approvalStatus || null,
        delivery_status: deliveryStatus || null,
        file_link: finalFileLink,
        date_uploaded: dateUploaded || null,
        notes: notes || null,
      };

      const res = await fetch("/api/media-assets", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} media asset`);
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
        <label htmlFor={`${formId}-asset-name`} className="block text-sm font-medium text-foreground mb-1">Asset name *</label>
        <Input id={`${formId}-asset-name`}
          value={assetName}
          onChange={(e) => setAssetName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      <div>
        <label htmlFor={`${formId}-project`} className="block text-sm font-medium text-foreground mb-1">Project</label>
        <NativeSelect id={`${formId}-project`} value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
          <option value="">— None —</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </NativeSelect>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-asset-type`} className="block text-sm font-medium text-foreground mb-1">Asset type</label>
          <NativeSelect id={`${formId}-asset-type`}
            value={assetType}
            onChange={(e) => setAssetType(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            {ASSET_TYPES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-version`} className="block text-sm font-medium text-foreground mb-1">Version</label>
          <Input id={`${formId}-version`}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="v1, master, square crop..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-linked-artist`} className="block text-sm font-medium text-foreground mb-1">Linked artist</label>
          <NativeSelect id={`${formId}-linked-artist`}
            value={linkedArtistId}
            onChange={(e) => setLinkedArtistId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— None —</option>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>{artist.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-linked-release`} className="block text-sm font-medium text-foreground mb-1">Linked release</label>
          <NativeSelect id={`${formId}-linked-release`}
            value={linkedReleaseId}
            onChange={(e) => setLinkedReleaseId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">— None —</option>
            {releases.map((release) => (
              <option key={release.id} value={release.id}>{release.title}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-approval-status`} className="block text-sm font-medium text-foreground mb-1">Approval status</label>
          <NativeSelect id={`${formId}-approval-status`}
            value={approvalStatus}
            onChange={(e) => setApprovalStatus(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            {APPROVAL_STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-delivery-status`} className="block text-sm font-medium text-foreground mb-1">Delivery status</label>
          <NativeSelect id={`${formId}-delivery-status`}
            value={deliveryStatus}
            onChange={(e) => setDeliveryStatus(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            {DELIVERY_STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1" htmlFor={`${formId}-file`}>Upload file</label>
          <label className="flex items-center justify-center w-full min-h-24 border-2 border-dashed border-border rounded-xl px-4 py-3 text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors focus-within:ring-2 focus-within:ring-ring">
            <Input
              id={`${formId}-file`}
              type="file"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <span>{file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : "Choose file or drop here later"}</span>
          </label>
        </div>
        <div>
          <label htmlFor={`${formId}-upload-date`} className="block text-sm font-medium text-foreground mb-1">Upload date</label>
          <Input id={`${formId}-upload-date`}
            type="date"
            value={dateUploaded}
            onChange={(e) => setDateUploaded(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
          <label htmlFor={`${formId}-manual-file-link-storage-key`} className="block text-sm font-medium text-foreground mt-3 mb-1">Manual file link / storage key</label>
          <Input id={`${formId}-manual-file-link-storage-key`}
            value={fileLink}
            onChange={(e) => setFileLink(e.target.value)}
            placeholder="https://... or media-assets/..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${formId}-notes`} className="block text-sm font-medium text-foreground mb-1">Notes</label>
        <Textarea id={`${formId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
        <Button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50"
        >
          {loading ? (file ? "Uploading..." : "Saving...") : isEdit ? "Save changes" : "Create media asset"}
        </Button>
      </div>
    </form>
  );
}
