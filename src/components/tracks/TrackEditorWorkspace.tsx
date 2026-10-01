"use client";

import { useEffect, useMemo, useState, type ReactNode, type SubmitEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { uploadFileToStorage } from "../../lib/storage-client";
import { TrackCreateDialog } from "./TrackCreateDialog";
import { TrackDeleteButton, type Track } from "./TrackActionButtons";
import { buildTrackReadinessChecks } from "./track-readiness-ui";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
      setPendingTrackFocus(null);
      const fieldId = trackFocusId(pendingTrackFocus);
      const element = document.getElementById(fieldId);
      if (!element || !(element instanceof HTMLElement)) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus();
    }, 0);
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
    <div className="space-y-6">
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
        {isrcAssignmentError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{isrcAssignmentError}</p>}

        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {release.artist_name || "No artist"} · {release.format || "No format"} · {release.release_date ? formatDate(release.release_date) : "No date"}
          </p>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{release.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{tracks.length} tracks · {readyCount} ready{needsWorkCount > 0 ? ` · ${needsWorkCount} need attention` : ""}</p>
        </div>
        <Accordion className="mt-2">
          <AccordionItem value="release-checks">
            <AccordionTrigger headingLevel={2} className="w-fit gap-3 text-muted-foreground">Release checks</AccordionTrigger>
            <AccordionContent>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div><dt className="text-muted-foreground">Missing audio</dt><dd>{missingAudioCount} tracks</dd></div>
                <div><dt className="text-muted-foreground">ISRCs assigned</dt><dd>{tracks.length - missingIsrcCount} of {tracks.length}</dd></div>
                <div><dt className="text-muted-foreground">Average clearance</dt><dd>{avgClearance}%</dd></div>
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </header>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <section className="min-w-0" aria-label="Tracks">
          <div className="mb-4 space-y-3">
            <h2 className="text-lg font-semibold">Tracks</h2>
            <ToggleGroup aria-label="Filter tracks" value={[filter]} onValueChange={(values) => { if (values[0]) setFilter(values[0] as FilterKey); }} size="sm" className="max-w-full flex-wrap">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="needs-work">Needs work</ToggleGroupItem>
              <ToggleGroupItem value="missing-audio">No audio</ToggleGroupItem>
              <ToggleGroupItem value="ready">Ready</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <TrackTable
            tracks={filteredTracks}
            selectedId={selectedTrack?.id ?? ""}
            onSelect={setSelectedId}
          />
        </section>

        <aside aria-label="Selected track editor" className="min-w-0 border-t border-border pt-6 lg:sticky lg:top-4 lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
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
    <div className="divide-y divide-border border-y border-border">
        {tracks.map((track) => {
          const selected = track.id === selectedId;
          return (
            <Button
              key={track.id}
              variant="ghost"
              type="button"
              onClick={() => onSelect(track.id)}
              aria-pressed={selected}
              className={`grid h-auto min-h-16 w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-3 rounded-none px-2 py-4 text-left whitespace-normal text-foreground ${selected ? "bg-accent text-accent-foreground" : ""}`}
            >
              <div className="text-sm font-medium text-muted-foreground">{track.position ?? "-"}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="break-words text-sm font-medium">{track.title}</p>
                  {track.version && track.version !== "Main" && <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{track.version}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge variant="ghost" className="h-auto px-0 text-xs font-normal">{track.track_ready ? "Ready" : "Needs work"}</Badge>
                  {track.track_missing && <span className={selected ? "text-accent-foreground" : "text-muted-foreground"}>{track.track_missing}</span>}
                </div>
              </div>
            </Button>
          );
        })}
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
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h2 className="break-words text-xl font-semibold tracking-tight">{track.title}</h2>
        {track.track_missing && <p className="mt-2 text-sm text-muted-foreground">{track.track_missing}</p>}
      </div>

      <div className="space-y-4">
        <Accordion>
          <AccordionItem value="track-checks">
            <AccordionTrigger>Readiness checks</AccordionTrigger>
            <AccordionContent className="space-y-3">
              {readinessChecks.map((check) => (
                <div key={check.label} className="flex items-start gap-3">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.state === "complete" ? "bg-success-foreground text-background" : check.state === "not-applicable" ? "bg-muted text-muted-foreground" : "bg-warning text-warning-foreground"}`}>
                    {check.state === "complete" ? <CheckCircle2 className="h-3.5 w-3.5" /> : check.state === "not-applicable" ? <span className="text-xs font-semibold">—</span> : <CircleAlert className="h-3.5 w-3.5" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">{check.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{check.detail}</span>
                  </span>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

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

        {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <TrackDeleteButton track={track} />
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground max-sm:hidden">Saving refreshes readiness.</p>
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4" />
            {loading ? "Saving..." : "Save track"}
          </Button>
        </div>
      </div>
    </form>
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
