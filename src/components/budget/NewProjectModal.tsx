"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface ArtistOption { id: string; name: string }
interface ReleaseOption { id: string; title: string }

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
  artistOptions: ArtistOption[];
  releaseOptions: ReleaseOption[];
}

export default function NewProjectModal({ onClose, onCreated, artistOptions, releaseOptions }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [artistId, setArtistId] = useState<string>("");
  const [releaseId, setReleaseId] = useState<string>("");
  const [currency, setCurrency] = useState("DKK");
  const [baselineFunding, setBaselineFunding] = useState<number>(0);
  const [totalPlanned, setTotalPlanned] = useState<number>(0);
  const [trackCount, setTrackCount] = useState<number | "">("");
  const [singlesCount, setSinglesCount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/budget-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          artist_id: artistId || null,
          release_id: releaseId || null,
          currency,
          baseline_funding: baselineFunding,
          total_planned: totalPlanned,
          track_count: trackCount === "" ? null : Number(trackCount),
          singles_count: singlesCount === "" ? null : Number(singlesCount),
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      await onCreated(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">New budget project</h3>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</Button>
        </div>

        <div className="space-y-3">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              placeholder="e.g. Nouveau Boho"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Artist">
              <NativeSelect
                value={artistId}
                onChange={(e) => setArtistId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                <option value="">— none —</option>
                {artistOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Release">
              <NativeSelect
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                <option value="">— none —</option>
                {releaseOptions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <NativeSelect
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              >
                <option>USD</option>
                <option>DKK</option>
                <option>EUR</option>
                <option>GBP</option>
              </NativeSelect>
            </Field>
            <Field label="Tracks">
              <Input
                type="number"
                value={trackCount}
                onChange={(e) => setTrackCount(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Singles">
              <Input
                type="number"
                value={singlesCount}
                onChange={(e) => setSinglesCount(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </Field>
            <Field label={`Baseline funding (${currency})`}>
              <Input
                type="number"
                value={baselineFunding}
                onChange={(e) => setBaselineFunding(Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </Field>
          </div>
          <Field label={`Total planned (${currency})`}>
            <Input
              type="number"
              value={totalPlanned}
              onChange={(e) => setTotalPlanned(Number(e.target.value))}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-foreground text-background rounded-md font-medium disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
