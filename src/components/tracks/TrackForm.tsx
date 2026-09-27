"use client";

import { useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export function TrackForm({ releaseId, works, onClose }: {
  releaseId: string;
  works: Array<{ id: string; title: string; isrc: string | null }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState("");
  const [version, setVersion] = useState("Main");
  const [audioUrl, setAudioUrl] = useState("");
  const [mode, setMode] = useState<"auto" | "existing" | "new">("auto");
  const [workId, setWorkId] = useState("");
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [autoIsrc, setAutoIsrc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        title,
        release_id: releaseId,
        position: position ? Number(position) : null,
        version,
        audio_url: audioUrl || null,
        auto_isrc: autoIsrc,
      };
      // "auto" mode (default): send neither work_id nor new_work_title.
      // The server will create a work from the track title automatically.
      if (mode === "existing" && workId) {
        payload.work_id = workId;
      } else if (mode === "new" && newWorkTitle) {
        payload.new_work_title = newWorkTitle;
      }

      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create track");
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
        <label className="block text-sm font-medium text-neutral-700 mb-1">Track Title *</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Position</label>
          <Input type="number" value={position} onChange={(e) => setPosition(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Version</label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Audio URL</label>
        <Input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://..."
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <p className="text-xs text-neutral-400 mb-2">
          Leave blank to auto-create a work from the track title.
        </p>
        <div className="flex gap-3 mb-3">
          <Button type="button" onClick={() => setMode("auto")}
            className={`text-sm px-3 py-1.5 rounded-md ${mode === "auto" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>
            Auto (use title)
          </Button>
          <Button type="button" onClick={() => setMode("existing")}
            className={`text-sm px-3 py-1.5 rounded-md ${mode === "existing" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>
            Link to existing
          </Button>
          <Button type="button" onClick={() => setMode("new")}
            className={`text-sm px-3 py-1.5 rounded-md ${mode === "new" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>
            Create new work
          </Button>
        </div>
        {mode === "existing" && (
          <NativeSelect value={workId} onChange={(e) => setWorkId(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
            <option value="">— Select work —</option>
            {works.map((w) => <option key={w.id} value={w.id}>{w.title} {w.isrc ? `(${w.isrc})` : ""}</option>)}
          </NativeSelect>
        )}
        {mode === "new" && (
          <Input value={newWorkTitle} onChange={(e) => setNewWorkTitle(e.target.value)} placeholder="New work title"
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        )}
        {mode === "auto" && (
          <p className="text-sm text-neutral-500 italic">
            Work will be created as <strong>"{title || "(track title)"}"</strong> when you save.
          </p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Input type="checkbox" checked={autoIsrc} onChange={(e) => setAutoIsrc(e.target.checked)}
          className="rounded border-neutral-300" />
        Auto-generate ISRC (applied to work, track inherits it)
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost" type="submit" disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Creating..." : "Create Track"}
        </Button>
      </div>
    </form>
  );
}
