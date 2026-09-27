"use client";

import { useEffect, useMemo, useState, type ReactNode, type SubmitEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  FileAudio,
  ListFilter,
  Music2,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { uploadFileToStorage } from "../../lib/storage-client";
import { TrackCreateDialog } from "./TrackCreateDialog";
import { TrackDeleteButton, type Track } from "./TrackActionButtons";
import { buildTrackReadinessChecks, isTrackReadinessComplete } from "./track-readiness-ui";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface ReleaseDetail {
  id: string;
  title: string;
  artist_name?: string | null;
  format?: string | null;
  release_date?: string | null;
  release_ready?: boolean | null;
}

interface TrackRow extends Track {
  track_ready?: boolean | null;
  track_missing?: string | null;
  clearance_progress?: number | null;
  clearance_pub?: number | null;
  clearance_master?: number | null;
  clearance_pub_entered?: number | null;
  clearance_master_entered?: number | null;
}

interface Props {
  release: ReleaseDetail;
  tracks: TrackRow[];
  works: Array<{ id: string; title: string; isrc: string | null }>;
  canMutate?: boolean;
}

type FilterKey = "all" | "needs-work" | "missing-audio" | "ready";
type TrackFocus = "audio" | "isrc" | "work";

export function TrackEditorWorkspace({ release, tracks, works, canMutate = true }: Props) {
  const [selectedId, setSelectedId] = useState(tracks.find((track) => !track.track_ready)?.id ?? tracks[0]?.id ?? "");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [assigningIsrcs, setAssigningIsrcs] = useState(false);
  const [isrcAssignmentError, setIsrcAssignmentError] = useState("");
  const [pendingTrackFocus, setPendingTrackFocus] = useState<TrackFocus | null>(null);

  const selectedTrack = tracks.find((track) => track.id === selectedId) ?? tracks[0] ?? null;
  const readyCount = tracks.filter((track) => track.track_ready).length;
  const missingAudioCount = tracks.filter((track) => !track.audio_url).length;
  const needsWorkCount = tracks.length - readyCount;
  const missingIsrcCount = tracks.filter((track) => !track.isrc).length;
  const allTracksReady = isTrackReadinessComplete(readyCount, tracks.length);
  const avgClearance = tracks.length
    ? Math.round((tracks.reduce((sum, track) => sum + Number(track.clearance_progress ?? 0), 0) / tracks.length) * 100)
    : 0;

  const filteredTracks = useMemo(() => {
    if (filter === "ready") return tracks.filter((track) => track.track_ready);
    if (filter === "needs-work") return tracks.filter((track) => !track.track_ready);
    if (filter === "missing-audio") return tracks.filter((track) => !track.audio_url);
    return tracks;
  }, [filter, tracks]);

  useEffect(() => {
    if (filteredTracks.length && !filteredTracks.some((track) => track.id === selectedId)) {
      setSelectedId(filteredTracks[0].id);
    }
  }, [filteredTracks, selectedId]);

  useEffect(() => {
    const applyRoute = () => {
      const route = parseTrackRoute(window.location.search);
      const requestedTrack = route.trackId ? tracks.find((track) => track.id === route.trackId) : null;
      if (requestedTrack) {
        setSelectedId(requestedTrack.id);
      }
      setPendingTrackFocus(route.focus);
    };
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("popstate", applyRoute);
    };
  }, [tracks]);

  useEffect(() => {
    if (!selectedTrack || !pendingTrackFocus) return;
    const timeout = window.setTimeout(() => {
      const fieldId = trackFocusId(pendingTrackFocus);
      const element = document.getElementById(fieldId);
      if (!element || !(element instanceof HTMLElement)) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus();
    }, 0);
    setPendingTrackFocus(null);
    return () => window.clearTimeout(timeout);
  }, [selectedTrack?.id, pendingTrackFocus]);

  async function assignMissingIsrcs() {
    setAssigningIsrcs(true);
    setIsrcAssignmentError("");
    try {
      const response = await fetch(`/api/releases/${release.id}/isrc`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ISRC assignment failed");
      window.location.reload();
    } catch (error) {
      setIsrcAssignmentError(error instanceof Error ? error.message : "ISRC assignment failed");
      setAssigningIsrcs(false);
    }
  }

  return (
    <div className="space-y-5">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <header className="border-b border-border pb-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <a href={`/releases/${release.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to release
          </a>
          {canMutate && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {missingIsrcCount > 0 && (
                <Button variant="outline"
                  type="button"
                  onClick={assignMissingIsrcs}
                  disabled={assigningIsrcs}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${assigningIsrcs ? "animate-spin" : ""}`} />
                  {assigningIsrcs ? "Assigning ISRCs..." : `Assign ${missingIsrcCount} missing ISRC${missingIsrcCount === 1 ? "" : "s"}`}
                </Button>
              )}
              <TrackCreateDialog releaseId={release.id} works={works} />
            </div>
          )}
        </div>
        {isrcAssignmentError && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{isrcAssignmentError}</p>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {release.artist_name || "No artist"} · {release.format || "No format"} · {release.release_date ? formatDate(release.release_date) : "No date"}
            </p>
            <h1 className="mt-1 truncate text-4xl font-semibold tracking-tight">{release.title} tracks</h1>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Track readiness</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{readyCount}/{tracks.length}</p>
              </div>
              {allTracksReady ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <CircleAlert className="h-5 w-5 text-amber-700" />}
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-neutral-900" style={{ width: `${tracks.length ? (readyCount / tracks.length) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <Metric label="Tracks" value={String(tracks.length)} detail="on this release" />
        <Metric label="Needs work" value={String(needsWorkCount)} detail="open fixes" tone={needsWorkCount ? "warn" : "ok"} />
        <Metric label="Missing audio" value={String(missingAudioCount)} detail="files or links" tone={missingAudioCount ? "warn" : "ok"} />
        <Metric label="ISRCs" value={`${tracks.length - missingIsrcCount}/${tracks.length}`} detail="assigned to recordings" tone={missingIsrcCount ? "warn" : "ok"} />
        <Metric label="Clearance" value={`${avgClearance}%`} detail="average progress" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-w-0 rounded-lg border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Track queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">Select a track to edit metadata, audio, work link, and readiness blockers.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All</FilterButton>
              <FilterButton active={filter === "needs-work"} onClick={() => setFilter("needs-work")}>Needs work</FilterButton>
              <FilterButton active={filter === "missing-audio"} onClick={() => setFilter("missing-audio")}>No audio</FilterButton>
              <FilterButton active={filter === "ready"} onClick={() => setFilter("ready")}>Ready</FilterButton>
            </div>
          </div>

          <TrackTable
            tracks={filteredTracks}
            selectedId={selectedTrack?.id ?? ""}
            onSelect={setSelectedId}
          />
        </main>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          {selectedTrack && canMutate ? (
            <TrackInspector key={selectedTrack.id} track={selectedTrack} releaseId={release.id} works={works} />
          ) : selectedTrack ? (
            <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">Track details are read-only for fundraiser.</div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              Add a track to start editing this release.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TrackTable({
  tracks,
  selectedId,
  onSelect,
}: {
  tracks: TrackRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (!tracks.length) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No tracks match this filter.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-[44px_minmax(0,1fr)_160px_132px] border-b border-border bg-muted/35 px-4 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground max-md:hidden">
        <div>No.</div>
        <div>Track</div>
        <div>Essentials</div>
        <div>Readiness</div>
      </div>
      <div className="divide-y divide-border">
        {tracks.map((track) => {
          const selected = track.id === selectedId;
          const clearance = Math.round(Number(track.clearance_progress ?? 0) * 100);
          return (
            <Button
              key={track.id}
              type="button"
              onClick={() => onSelect(track.id)}
              className={`grid w-full gap-3 px-4 py-3 text-left outline-none transition focus:ring-0 focus-visible:ring-1 focus-visible:ring-neutral-300 md:grid-cols-[44px_minmax(0,1fr)_160px_132px] md:items-center ${selected ? "border-l-2 border-neutral-900 bg-muted/55 pl-3.5" : "border-l-2 border-transparent hover:bg-muted/30"}`}
            >
              <div className="text-sm font-medium text-muted-foreground">{track.position ?? "-"}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{track.title}</p>
                  {track.version && track.version !== "Main" && <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{track.version}</span>}
                </div>
                {track.track_missing && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{track.track_missing}</p>}
              </div>
              <div className="grid gap-1.5 text-xs md:text-sm">
                <Signal selected={selected} ok={Boolean(track.audio_url)} icon={<FileAudio className="h-4 w-4" />} label={track.audio_url ? "Audio linked" : "No audio"} />
                <Signal selected={selected} ok={Boolean(track.isrc)} icon={<Music2 className="h-4 w-4" />} label={track.isrc ? "ISRC linked" : "No ISRC"} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">{clearance}%</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${track.track_ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {track.track_ready ? "Ready" : "Needs work"}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-neutral-900" style={{ width: `${clearance}%` }} />
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function TrackInspector({
  track,
  releaseId,
  works,
}: {
  track: TrackRow;
  releaseId: string;
  works: Array<{ id: string; title: string; isrc: string | null }>;
}) {
  const [title, setTitle] = useState(track.title);
  const [position, setPosition] = useState(track.position?.toString() || "");
  const [version, setVersion] = useState(track.version || "Main");
  const [isrc, setIsrc] = useState(track.isrc || "");
  const [audioUrl, setAudioUrl] = useState(track.audio_url || "");
  const [duration, setDuration] = useState(track.duration?.toString() || "");
  const [workId, setWorkId] = useState(track.work_id || "");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const readinessChecks = buildTrackReadinessChecks({
    audioUrl,
    isrc,
    workId,
    clearance_pub: track.clearance_pub,
    clearance_master: track.clearance_master,
    clearance_pub_entered: track.clearance_pub_entered,
    clearance_master_entered: track.clearance_master_entered,
  });

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      let nextAudioUrl = audioUrl.trim();
      if (audioFile) {
        const uploaded = await uploadFileToStorage(audioFile, `releases/${releaseId}/audio`);
        nextAudioUrl = uploaded.url ?? uploaded.key;
      }

      const res = await fetch("/api/tracks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: track.id,
          title,
          position: position ? Number(position) : null,
          version,
          isrc: isrc || null,
          audio_url: nextAudioUrl || null,
          duration: duration ? Number(duration) : null,
          work_id: workId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Track update failed");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Track update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-background">
      <div className="border-b border-border p-4">
        <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Fix selected track</p>
        <h2 className="mt-1 line-clamp-2 text-xl font-semibold tracking-tight">{track.title}</h2>
        {track.track_missing && <p className="mt-2 text-sm text-muted-foreground">{track.track_missing}</p>}
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-2">
          {readinessChecks.map((check) => (
            <div key={check.label} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.state === "complete" ? "bg-emerald-600 text-white" : check.state === "not-applicable" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800"}`}>
                {check.state === "complete" ? <CheckCircle2 className="h-3.5 w-3.5" /> : check.state === "not-applicable" ? <span className="text-xs font-semibold">—</span> : <CircleAlert className="h-3.5 w-3.5" />}
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{check.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{check.detail}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-3">
          <Field label="No.">
            <Input value={position} onChange={(event) => setPosition(event.target.value)} type="number" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} required className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Version">
            <Input value={version} onChange={(event) => setVersion(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
          <Field label="Duration">
            <Input value={duration} onChange={(event) => setDuration(event.target.value)} type="number" placeholder="seconds" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
        </div>

        <Field label="ISRC">
          <Input
            id="track-isrc"
            value={isrc}
            onChange={(event) => setIsrc(event.target.value)}
            placeholder="DKO7P2500001"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <Field label="Audio">
          <div className="space-y-2">
            <label className="flex min-h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-3 text-center text-sm text-muted-foreground hover:bg-muted/35">
              <Input type="file" accept="audio/*" className="hidden" onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} />
              <span className="inline-flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {audioFile ? `${audioFile.name} (${Math.round(audioFile.size / 1024)} KB)` : "Upload audio file"}
              </span>
            </label>
            <Input
              id="track-audio"
              value={audioUrl}
              onChange={(event) => setAudioUrl(event.target.value)}
              placeholder="Audio URL or storage key"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </Field>

        <Field label="Linked work">
          <NativeSelect
            id="track-work"
            value={workId}
            onChange={(event) => setWorkId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No work linked</option>
            {works.map((work) => <option key={work.id} value={work.id}>{work.title}{work.isrc ? ` (${work.isrc})` : ""}</option>)}
          </NativeSelect>
        </Field>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border p-4">
        <TrackDeleteButton track={track} />
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground max-sm:hidden">Saving refreshes readiness.</p>
          <Button variant="ghost" type="submit" disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            <Save className="h-4 w-4" />
            {loading ? "Saving..." : "Save track"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-800" : "text-foreground"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function FilterButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${active ? "bg-neutral-900 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Signal({ ok, selected, icon, label }: { ok: boolean; selected: boolean; icon: ReactNode; label: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${selected ? "font-medium" : ""} ${ok ? "text-emerald-700" : "text-muted-foreground"}`}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function parseTrackRoute(search: string): { trackId: string | null; focus: TrackFocus | null } {
  const params = new URLSearchParams(search);
  const trackId = params.get("track")?.trim() || null;
  return {
    trackId: trackId || null,
    focus: parseTrackFocus(params.get("focus")),
  };
}

function parseTrackFocus(value: string | null): TrackFocus | null {
  if (value === "audio" || value === "isrc" || value === "work") return value;
  return null;
}

export function trackFocusId(focus: TrackFocus): string {
  if (focus === "audio") return "track-audio";
  if (focus === "isrc") return "track-isrc";
  return "track-work";
}
