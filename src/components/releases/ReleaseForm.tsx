"use client";

import { useId, useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FieldLabel, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export interface Release {
  id: string;
  title: string;
  catalog_number?: string | null;
  catalog_number_locked?: boolean | null;
  artist_id?: string | null;
  parent_release_id?: string | null;
  release_date?: string | null;
  format?: string | null;
  upc_ean?: string | null;
  cover_art_url?: string | null;
  status?: string | null;
}

export function ReleaseForm({ initial, artists, parentReleases = [], onClose }: {
  initial?: Release | null;
  artists: Array<{ id: string; name: string }>;
  parentReleases?: Array<{ id: string; title: string; format?: string | null }>;
  onClose: () => void;
}) {
  const formId = useId();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title || "");
  const [artistId, setArtistId] = useState(initial?.artist_id || "");
  const [parentReleaseId, setParentReleaseId] = useState(initial?.parent_release_id || "");
  const [releaseDate, setReleaseDate] = useState(initial?.release_date || "");
  const [format, setFormat] = useState(initial?.format || "single");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [upc, setUpc] = useState(initial?.upc_ean || "");
  const [coverArt, setCoverArt] = useState(initial?.cover_art_url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSingle = format.toLowerCase() === "single";

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        title,
        artist_id: artistId || null,
        parent_release_id: isSingle ? parentReleaseId || null : null,
        release_date: releaseDate || null,
        format, status,
        upc_ean: upc || null,
        cover_art_url: coverArt || null,
      };
      const res = await fetch("/api/releases", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} release`);
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
      <div>
        <FieldLabel htmlFor={`${formId}-title`} className="mb-2">Title *</FieldLabel>
        <Input id={`${formId}-title`} value={title} onChange={(e) => setTitle(e.target.value)} required
          className="w-full" />
      </div>
      <div>
        <FieldLabel htmlFor={`${formId}-artist`} className="mb-2">Artist</FieldLabel>
        <Select id={`${formId}-artist`} placeholder="Select artist" value={artistId} onValueChange={value => setArtistId(value ?? "")} className="w-full" options={[
          { value: "", label: "Select artist" }, ...artists.map(artist => ({ value: artist.id, label: artist.name })),
        ]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${formId}-release-date`} className="mb-2">Release Date</FieldLabel>
          <Input id={`${formId}-release-date`} type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
            className="w-full" />
        </div>
        <div>
          <FieldLabel htmlFor={`${formId}-format`} className="mb-2">Format</FieldLabel>
          <Select id={`${formId}-format`} value={format} onValueChange={value => { setFormat(value ?? "single"); if (value?.toLowerCase() !== "single") setParentReleaseId(""); }} className="w-full" options={[
            { value: "single", label: "Single" }, { value: "EP", label: "EP" }, { value: "album", label: "Album" },
            ...(!["single", "EP", "album"].includes(format) ? [{ value: format, label: format }] : []),
          ]} />
        </div>
      </div>
      {isSingle && parentReleases.length > 0 && (
        <div>
          <FieldLabel htmlFor={`${formId}-parent-release`} className="mb-2">Part of an EP rollout</FieldLabel>
          <Select id={`${formId}-parent-release`} placeholder="Independent release" value={parentReleaseId} onValueChange={value => setParentReleaseId(value ?? "")} className="w-full" options={[
            { value: "", label: "Independent release" },
            ...parentReleases.filter(release => release.id !== initial?.id && release.format != null && ["ep", "album"].includes(release.format.toLowerCase())).map(release => ({ value: release.id, label: `${release.title} (${release.format})` })),
          ]} />
          <p className="mt-1 text-xs text-muted-foreground">The single keeps its own release plan, budget, and results, while appearing in the parent EP’s rollout.</p>
        </div>
      )}
      <div>
        <FieldLabel htmlFor={`${formId}-status`} className="mb-2">Status</FieldLabel>
        <Select id={`${formId}-status`} value={status} onValueChange={value => setStatus(value ?? "draft")} className="w-full" options={[
          { value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }, { value: "released", label: "Released" }, { value: "archived", label: "Archived" },
          ...(!["draft", "scheduled", "released", "archived"].includes(status) ? [{ value: status, label: status }] : []),
        ]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${formId}-upc`} className="mb-2">UPC/EAN</FieldLabel>
          <Input id={`${formId}-upc`} value={upc} onChange={(e) => setUpc(e.target.value)}
            className="w-full" />
        </div>
        <div>
          <FieldLabel htmlFor={`${formId}-cover-art`} className="mb-2">Cover Art URL</FieldLabel>
          <Input id={`${formId}-cover-art`} value={coverArt} onChange={(e) => setCoverArt(e.target.value)} placeholder="https://..."
            className="w-full" />
        </div>
      </div>
      {error && <FieldError>{error}</FieldError>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Release"}
        </Button>
      </div>
    </form>
  );
}
