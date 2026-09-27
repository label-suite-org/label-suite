"use client";

import { useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export function DspPitchForm({ releaseId, onClose }: { releaseId: string; onClose: () => void }) {
  const [platform, setPlatform] = useState("Spotify");
  const [status, setStatus] = useState("draft");
  const [sentDate, setSentDate] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dsp-pitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_id: releaseId, platform, status, sent_date: sentDate || null, response: response || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      window.location.reload();
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Platform</label>
        <NativeSelect value={platform} onChange={(e) => setPlatform(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
          <option>Spotify</option><option>Apple Music</option><option>Deezer</option><option>Tidal</option><option>Amazon Music</option>
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
            <option value="draft">Draft</option><option value="sent">Sent</option>
            <option value="responded">Responded</option><option value="approved">Approved</option>
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Sent Date</label>
          <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Response</label>
        <Textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost" type="submit" disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Adding..." : "Add Pitch"}
        </Button>
      </div>
    </form>
  );
}
