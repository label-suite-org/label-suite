"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { FieldLabel, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export interface Work {
  id?: string;
  title?: string;
  isrc?: string | null;
  iswc?: string | null;
  audio_url?: string | null;
  duration?: number | null;
  genre?: string | null;
}

export function WorkForm({
  initial,
  onClose,
}: {
  initial?: Work | null;
  onClose: () => void;
}) {
  const formId = useId();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title || "");
  const [isrc, setIsrc] = useState(initial?.isrc || "");
  const [iswc, setIswc] = useState(initial?.iswc || "");
  const [audioUrl, setAudioUrl] = useState(initial?.audio_url || "");
  const [duration, setDuration] = useState(initial?.duration?.toString() || "");
  const [genre, setGenre] = useState(initial?.genre || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        title,
        isrc: isrc || null,
        iswc: iswc || null,
        audio_url: audioUrl || null,
        duration: duration ? Number(duration) : null,
        genre: genre || null,
      };
      const res = await fetch("/api/works", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...payload, id: initial!.id } : payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} work`);
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
        <FieldLabel htmlFor={`${formId}-title`} className="mb-2">Work Title *</FieldLabel>
        <Input id={`${formId}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Cherry-Coloured Funk"
          className="w-full"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${formId}-isrc`} className="mb-2">ISRC</FieldLabel>
          <Input id={`${formId}-isrc`}
            value={isrc}
            onChange={(e) => setIsrc(e.target.value)}
            placeholder="DKO7P2600001"
            className="w-full font-mono"
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${formId}-iswc`} className="mb-2">ISWC</FieldLabel>
          <Input id={`${formId}-iswc`}
            value={iswc}
            onChange={(e) => setIswc(e.target.value)}
            placeholder="T-000.000.001-0"
            className="w-full font-mono"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${formId}-duration`} className="mb-2">Duration (seconds)</FieldLabel>
          <Input id={`${formId}-duration`}
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="210"
            className="w-full"
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${formId}-genre`} className="mb-2">Genre</FieldLabel>
          <Input id={`${formId}-genre`}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Indie pop"
            className="w-full"
          />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={`${formId}-audio`} className="mb-2">Audio URL</FieldLabel>
        <Input id={`${formId}-audio`}
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://..."
          className="w-full"
        />
      </div>

      {error && <FieldError>{error}</FieldError>}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose}
         >
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Work"}
        </Button>
      </div>
    </form>
  );
}
