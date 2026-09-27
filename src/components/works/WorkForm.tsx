"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
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
        <label className="block text-sm font-medium text-foreground mb-1">Work Title *</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Cherry-Coloured Funk"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ISRC</label>
          <Input
            value={isrc}
            onChange={(e) => setIsrc(e.target.value)}
            placeholder="DKO7P2600001"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background font-mono"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ISWC</label>
          <Input
            value={iswc}
            onChange={(e) => setIswc(e.target.value)}
            placeholder="T-000.000.001-0"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Duration (seconds)</label>
          <Input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="210"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Genre</label>
          <Input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Indie pop"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Audio URL</label>
        <Input
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://..."
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Button>
        <Button type="submit" disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50">
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Work"}
        </Button>
      </div>
    </form>
  );
}
