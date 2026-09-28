"use client";

import { ReleaseDeliveryPanel } from "./ReleaseDeliveryPanel";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Disc3,
  FileAudio,
  Image as ImageIcon,
  ListChecks,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import type { ReleaseCockpit } from "../../server/analytics-command-center-core";
import { resolveFileUrl } from "../../lib/storage-client";
import { BudgetBucketSummary, type BudgetItemWithCategory } from "../budget/BudgetBucketSummary";
import { DspPitchForm } from "../pitches/DspPitchForm";
import { TrackDeleteButton, TrackEditButton, type Track } from "../tracks/TrackActionButtons";
import { ReleaseDeleteButton, ReleaseEditButton } from "./ReleaseActionButtons";
import { ReleaseFieldCorrection } from "./ReleaseFieldCorrection";
import type { ReleaseReadinessSnapshot } from "../../server/release-correction";
import { ReleaseOperationsBrief } from "./ReleaseOperationsBrief";
import { ReleaseTimeline } from "./ReleaseTimeline";
import type { Release } from "./ReleaseForm";
import type { ReleaseTimeline as ReleaseTimelineData } from "../../server/release-timeline-core";
import { buildReleaseOperationsBrief, type ReleaseBriefActionKey } from "../../server/release-operations-brief-core";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface ReleaseDetail extends Release {
  release_ready?: boolean | null;
  updated_at?: string | Date | null;
  artist_name?: string | null;
}

interface TrackRow extends Track {
  track_ready?: boolean | null;
  track_missing?: string | null;
  clearance_progress?: number | null;
  clearance_pub?: number | null;
  clearance_master?: number | null;
}

interface PitchRow {
  id: string;
  platform: string | null;
  status: string | null;
  sent_date: string | null;
  response: string | null;
}

interface SamplyReviewState {
  project: {
    id: string;
    remoteProjectId: string;
    remoteProjectName: string | null;
    uploadEnabled: boolean;
    primaryPlayerId: string | null;
  } | null;
  player: {
    id: string;
    remotePlayerId: string;
    name: string;
    playerType: string;
    embedUrl: string;
    shareUrl: string | null;
    public: boolean;
    downloadsEnabled: boolean;
    commentsEnabled: boolean;
    quality: string | null;
  } | null;
  fileCount: number;
  lastSyncedAt: string | null;
  artworkUrl: string | null;
  inventory: Array<{
    id: string;
    trackId: string | null;
    trackTitle: string | null;
    position: number | null;
    version: string | null;
    remoteBoxId: string;
    remoteStackId: string | null;
    fileName: string;
    duration: number | null;
    audioUrl: string | null;
    syncStatus: string;
    lastSyncedAt: string | null;
  }>;
}

interface SamplyProjectOption {
  id: string;
  name: string;
  creatorEmail: string | null;
  uploadEnabled: boolean;
  size: number;
  timeModified: number | null;
  linkedReleaseId: string | null;
  linkedReleaseTitle: string | null;
}

interface Props {
  readiness?: ReleaseReadinessSnapshot | null;
  release: ReleaseDetail;
  tracks: TrackRow[];
  budgetItems: BudgetItemWithCategory[];
  pitches: PitchRow[];
  works: Array<{ id: string; title: string; isrc: string | null }>;
  artists: Array<{ id: string; name: string }>;
  cockpit: ReleaseCockpit | null;
  samplyReview: SamplyReviewState | null;
  canManage: boolean;
  timeline: ReleaseTimelineData | null;
  parentReleases: Array<{ id: string; title: string; format?: string | null }>;
  campaigns: Array<{
    id: string;
    campaign_name: string;
    campaign_type: string | null;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    owner: string | null;
    budget_planned: number | null;
    performance_rating: number | null;
    main_platform: string | null;
    artist_name: string | null;
  }>;
  documents: Array<{
    id: string;
    name: string;
    doc_type: string | null;
    status: string | null;
    file_link: string | null;
    created_at: Date | null;
  }>;
  mediaAssets: Array<{
    id: string;
    asset_name: string;
    asset_type: string | null;
    version: string | null;
    approval_status: string | null;
    delivery_status: string | null;
    file_link: string | null;
    date_uploaded: string | null;
  }>;
}

type FixKey = "cover" | "upc" | "date" | "format" | "tracks" | "track-readiness" | "pitch" | "analytics";
type ReleaseOverviewFixFocus = Extract<FixKey, "cover" | "upc" | "date" | "format">;

type ParsedReleaseRoute = {
  section: ReleaseSection;
  focus: ReleaseOverviewFixFocus | null;
};

interface FixItem {
  key: FixKey;
  label: string;
  detail: string;
  done: boolean;
  action: string;
  tone?: "warn" | "neutral";
}

interface ReviewSelection {
  track: TrackRow;
  version: SamplyReviewState["inventory"][number];
}

interface SamplyReviewComment {
  id: string;
  message: string;
  completed: boolean;
  audioTimestamp: number | null;
  audioTimestampEnd: number | null;
  timeCreated: number | null;
  timeModified: number | null;
}

const WAVEFORM_BAR_COUNT = 220;
const COVER_FORM_FOCUS_ID = "release-cover-input";

type ReleaseSection = "overview" | "tracks" | "timeline" | "campaigns" | "budget" | "assets" | "analytics";

const RELEASE_SECTIONS: Array<{ key: ReleaseSection; label: string; description: string }> = [
  { key: "overview", label: "Overview", description: "Readiness and next actions" },
  { key: "tracks", label: "Tracks & rights", description: "Tracklist, review audio, and readiness" },
  { key: "timeline", label: "Timeline", description: "Milestones, tasks, and phase budget" },
  { key: "campaigns", label: "Campaigns", description: "Linked promotion and channels" },
  { key: "budget", label: "Budget", description: "Spend plan and DSP pitches" },
  { key: "assets", label: "Assets & delivery", description: "Release-linked files and manual delivery" },
  { key: "analytics", label: "Analytics", description: "Scoped performance data" },
];

export function ReleaseWorkspace({
  release: initialRelease,
  readiness: initialReadiness = null,
  tracks,
  budgetItems,
  pitches,
  works,
  artists,
  cockpit,
  samplyReview: initialSamplyReview,
  canManage,
  timeline,
  parentReleases,
  campaigns,
  documents,
  mediaAssets,
}: Props) {
  const [release, setRelease] = useState<ReleaseDetail>({ ...initialRelease, ...initialReadiness?.release,
    release_ready: initialReadiness?.readiness.isReady ?? initialRelease.release_ready });
  const [readiness, setReadiness] = useState(initialReadiness);
  const [fromToday, setFromToday] = useState(false);
  const correctionDirty = useRef(false);
  const correctionTrigger = useRef<HTMLElement | null>(null);
  const currentLocation = useRef("");
  const onCorrectionDirty = useCallback((dirty: boolean) => { correctionDirty.current = dirty; }, []);
  const confirmDeparture = () => !correctionDirty.current || window.confirm("Leave this correction? Unsaved input will be discarded; an in-flight save may still complete.");
  const acceptReadiness = (snapshot: ReleaseReadinessSnapshot) => {
    setReadiness(snapshot);
    setRelease(current => ({ ...current, ...snapshot.release, release_ready: snapshot.readiness.isReady }));
  };
  const [activeFix, setActiveFix] = useState<FixKey | null>(null);
  const [activeSection, setActiveSection] = useState<ReleaseSection>("overview");
  const [pendingSectionFocus, setPendingSectionFocus] = useState<ReleaseOverviewFixFocus | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [artworkPreviewFailed, setArtworkPreviewFailed] = useState(false);
  const [samplyReview, setSamplyReview] = useState<SamplyReviewState | null>(initialSamplyReview);
  const [reviewSelection, setReviewSelection] = useState<ReviewSelection | null>(null);
  const [reviewComments, setReviewComments] = useState<SamplyReviewComment[]>([]);
  const [reviewCommentsLoading, setReviewCommentsLoading] = useState(false);
  const [reviewCommentsError, setReviewCommentsError] = useState("");
  const [reviewAudioError, setReviewAudioError] = useState("");
  const [reviewWaveformPeaks, setReviewWaveformPeaks] = useState<number[]>([]);
  const [reviewWaveformLoading, setReviewWaveformLoading] = useState(false);
  const [reviewWaveformError, setReviewWaveformError] = useState("");
  const [reviewAutoplay, setReviewAutoplay] = useState(false);
  const [reviewPlaying, setReviewPlaying] = useState(false);
  const [reviewCurrentTime, setReviewCurrentTime] = useState(0);
  const [reviewDuration, setReviewDuration] = useState(0);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setArtworkPreviewFailed(false);
  }, [release.cover_art_url]);

  useEffect(() => {
    currentLocation.current = window.location.href;
    const applyRoute = () => {
      if (!confirmDeparture()) {
        window.history.pushState(null, "", currentLocation.current);
        return;
      }
      currentLocation.current = window.location.href;
      setFromToday(new URLSearchParams(window.location.search).get("returnTo") === "today");
      const route = routeFromLocation(window.location.search, window.location.hash);
      setActiveSection(route.section);
      setActiveFix(route.section === "overview" ? route.focus : null);
      setPendingSectionFocus(route.section === "overview" ? route.focus : null);
    };
    applyRoute();
    window.addEventListener("hashchange", applyRoute);
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("hashchange", applyRoute);
      window.removeEventListener("popstate", applyRoute);
    };
  }, []);

  useEffect(() => {
    if (!pendingSectionFocus || activeSection !== "overview") return;
    const timeout = window.setTimeout(() => {
      setPendingSectionFocus(null);
      const fieldId = releaseFocusId(pendingSectionFocus);
      const element = document.getElementById(fieldId);
      if (!element || !(element instanceof HTMLElement)) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeSection, pendingSectionFocus]);

  useEffect(() => {
    if (!reviewSelection) return;
    const controller = new AbortController();
    setReviewComments([]);
    setReviewCommentsError("");
    setReviewCommentsLoading(true);
    fetch(`/api/releases/${encodeURIComponent(release.id)}/samply/files/${encodeURIComponent(reviewSelection.version.remoteBoxId)}/comments`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load Samply comments");
        setReviewComments(Array.isArray(data.comments) ? data.comments : []);
      })
      .catch((err: any) => {
        if (err.name !== "AbortError") setReviewCommentsError(err.message || "Could not load Samply comments");
      })
      .finally(() => {
        if (!controller.signal.aborted) setReviewCommentsLoading(false);
      });
    return () => controller.abort();
  }, [release.id, reviewSelection]);

  useEffect(() => {
    if (!reviewSelection) return;
    setReviewCurrentTime(0);
    setReviewDuration(0);
    setReviewAudioError("");
    const audio = reviewAudioRef.current;
    if (!audio || !reviewAutoplay) return;
    void audio.play()
      .then(() => setReviewPlaying(true))
      .catch(() => {
        setReviewPlaying(false);
        setReviewAudioError("Audio playback needs a click, or the Samply download link could not be opened.");
      });
  }, [reviewAutoplay, reviewSelection]);

  useEffect(() => {
    const audioUrl = reviewSelection?.version.audioUrl;
    if (!audioUrl) {
      setReviewWaveformPeaks([]);
      setReviewWaveformLoading(false);
      setReviewWaveformError("");
      return;
    }

    const waveformAudioUrl = audioUrl;
    const controller = new AbortController();
    let audioContext: AudioContext | null = null;
    setReviewWaveformPeaks([]);
    setReviewWaveformError("");
    setReviewWaveformLoading(true);

    async function loadWaveform() {
      try {
        const response = await fetch(waveformAudioUrl, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Waveform audio request failed");
        const audioData = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unavailable");
        audioContext = new AudioContextClass();
        const decoded = await audioContext.decodeAudioData(audioData.slice(0));
        if (!controller.signal.aborted) {
          setReviewWaveformPeaks(buildWaveformPeaks(decoded, WAVEFORM_BAR_COUNT));
        }
      } catch (err: any) {
        if (err.name !== "AbortError") setReviewWaveformError("Waveform unavailable");
      } finally {
        if (!controller.signal.aborted) setReviewWaveformLoading(false);
        void audioContext?.close().catch(() => {});
      }
    }

    void loadWaveform();
    return () => {
      controller.abort();
      void audioContext?.close().catch(() => {});
    };
  }, [reviewSelection?.version.audioUrl]);

  useEffect(() => {
    if (!reviewPlaying) return;
    let frame = 0;
    const syncPlaybackClock = () => {
      const audio = reviewAudioRef.current;
      if (audio) {
        setReviewCurrentTime(audio.currentTime);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setReviewDuration(audio.duration);
        }
      }
      frame = requestAnimationFrame(syncPlaybackClock);
    };
    frame = requestAnimationFrame(syncPlaybackClock);
    return () => cancelAnimationFrame(frame);
  }, [reviewPlaying, reviewSelection?.version.remoteBoxId]);

  const hasCoverArt = Boolean(release.cover_art_url) && !artworkPreviewFailed;

  const hasScopedAnalytics = Boolean(
    cockpit &&
      (
        cockpit.periods.some((period) => period.streamTotal > 0) ||
        cockpit.leaderboard.some((track) => track.combinedStreams > 0) ||
        cockpit.cities.some((city) => city.streams > 0) ||
        cockpit.playlists.some((playlist) => playlist.streams > 0) ||
        cockpit.shazams.some((row) => row.shazams > 0)
      ),
  );

  const fixItems = useMemo<FixItem[]>(() => {
    const hasTrackReadinessIssue = tracks.some((track) => !track.track_ready);
    return [
      {
        key: "cover",
        label: "Cover art",
        detail: hasCoverArt ? "Artwork preview is linked" : release.cover_art_url ? "Saved artwork link needs review" : "Upload or link final cover art",
        done: hasCoverArt,
        action: release.cover_art_url ? "Replace cover" : "Add cover",
        tone: hasCoverArt ? "neutral" : "warn",
      },
      {
        key: "upc",
        label: "UPC/EAN",
        detail: release.upc_ean ? release.upc_ean : "Add distributor barcode",
        done: Boolean(release.upc_ean),
        action: "Add UPC/EAN",
      },
      {
        key: "date",
        label: "Release date",
        detail: release.release_date ? formatDate(release.release_date) : "Set a release date",
        done: Boolean(release.release_date),
        action: "Set date",
      },
      {
        key: "format",
        label: "Format",
        detail: release.format || "Single, EP, album, video...",
        done: Boolean(release.format),
        action: "Set format",
      },
      {
        key: "tracks",
        label: "Tracklist",
        detail: tracks.length ? `${tracks.length} track${tracks.length === 1 ? "" : "s"} linked` : "Add tracks to this release",
        done: tracks.length > 0,
        action: "Manage tracks",
      },
      {
        key: "track-readiness",
        label: "Track readiness",
        detail: hasTrackReadinessIssue ? `${tracks.filter((track) => !track.track_ready).length} track${tracks.filter((track) => !track.track_ready).length === 1 ? "" : "s"} need work` : "All tracks pass readiness",
        done: tracks.length > 0 && !hasTrackReadinessIssue,
        action: "Review tracks",
      },
      {
        key: "pitch",
        label: "DSP pitch",
        detail: pitches.length ? `${pitches.length} pitch${pitches.length === 1 ? "" : "es"} logged` : "Create the first DSP pitch",
        done: pitches.length > 0,
        action: "Add pitch",
      },
      {
        key: "analytics",
        label: "Scoped analytics",
        detail: hasScopedAnalytics ? "Release analytics are linked" : "No matched stream data yet",
        done: hasScopedAnalytics,
        action: "Check data",
        tone: hasScopedAnalytics ? "neutral" : "warn",
      },
    ];
  }, [cockpit, hasCoverArt, hasScopedAnalytics, pitches.length, release, tracks]);

  const completed = fixItems.filter((item) => item.done).length;
  const progress = Math.round((completed / fixItems.length) * 100);
  const priorityItems = [...fixItems].sort((a, b) => priorityRank(a, release.release_date ?? null) - priorityRank(b, release.release_date ?? null));
  const nextFix = priorityItems.find((item) => !item.done) ?? null;
  const operationsBrief = useMemo(() => buildReleaseOperationsBrief({
    today: timeline?.today ?? new Date().toISOString().slice(0, 10),
    release: {
      id: release.id,
      title: release.title,
      artistName: release.artist_name ?? null,
      releaseDate: release.release_date ?? null,
      format: release.format ?? null,
      upcEan: release.upc_ean ?? null,
      coverArtUrl: release.cover_art_url ?? null,
      releaseReady: release.release_ready ?? null,
      status: release.status ?? null,
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      ready: track.track_ready ?? null,
      missing: track.track_missing ?? null,
      workId: track.work_id ?? null,
    })),
    pitches: pitches.map((pitch) => ({ id: pitch.id, status: pitch.status ?? null })),
    timeline,
    hasScopedAnalytics,
  }), [hasScopedAnalytics, pitches, release, timeline, tracks]);
  const handleFixSelect = (key: FixKey) => {
    if (key === "pitch") {
      if (selectSection("budget")) setPitchOpen(true);
    } else if (key === "tracks" || key === "track-readiness") {
      selectSection("tracks");
    } else if (key === "cover" || key === "upc" || key === "date" || key === "format") {
      selectSection("overview", key);
    } else {
      selectSection(key);
    }
  };
  const selectSection = (section: ReleaseSection, focus?: ReleaseOverviewFixFocus) => {
    if (!confirmDeparture()) return false;
    if (focus) correctionTrigger.current = document.activeElement as HTMLElement | null;
    setActiveSection(section);
    setActiveFix(section === "overview" ? focus ?? null : null);
    if (section === "overview" && focus) {
      setPendingSectionFocus(focus);
    } else {
      setPendingSectionFocus(null);
    }
    const search = new URLSearchParams(window.location.search);
    if (section === "overview") {
      search.set("section", "overview");
      if (focus) {
        search.set("focus", focus);
      } else {
        search.delete("focus");
      }
    } else {
      search.set("section", section);
      if (focus) search.set("focus", focus); else search.delete("focus");
    }
    const nextSearch = search.toString();
    const hash = `#${sectionHash(section)}`;
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`);
    currentLocation.current = window.location.href;
    return true;
  };
  const handleBriefAction = (key: ReleaseBriefActionKey, evidenceHref?: string) => {
    const navigationTarget = briefActionNavigationTarget(key, evidenceHref);
    if (navigationTarget) {
      window.location.assign(navigationTarget);
      return;
    }
    if (key === "timeline" || key === "analytics") {
      selectSection(key === "timeline" ? "timeline" : "analytics");
      return;
    }
    handleFixSelect(key);
  };
  const handleReviewSelect = (track: TrackRow, version: SamplyReviewState["inventory"][number]) => {
    setReviewAudioError("");
    setReviewSelection({ track, version });
    setReviewAutoplay(true);
  };
  const handleReviewClose = () => {
    reviewAudioRef.current?.pause();
    setReviewPlaying(false);
    setReviewAutoplay(false);
    setReviewSelection(null);
  };
  const toggleReviewPlayback = () => {
    const audio = reviewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setReviewAudioError("");
      void audio.play()
        .then(() => setReviewPlaying(true))
        .catch(() => {
          setReviewPlaying(false);
          setReviewAudioError("Could not start audio. The Samply download link may be unavailable or the token may need attention.");
        });
    } else {
      audio.pause();
      setReviewPlaying(false);
    }
  };
  const seekReview = (time: number) => {
    const audio = reviewAudioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, time);
    setReviewCurrentTime(audio.currentTime);
    void audio.play().then(() => setReviewPlaying(true)).catch(() => setReviewPlaying(false));
  };

  return (
    <div className="space-y-5">
      <header className="rounded-[1.5rem] border border-border bg-card p-4 shadow-[0_20px_70px_rgba(0,0,0,0.04)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <CoverWorkbench
            release={release}
            active={activeFix === "cover"}
              onOpen={() => selectSection("overview", "cover")}
            onPreviewFailed={() => setArtworkPreviewFailed(true)}
          />

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusPill ready={Boolean(release.release_ready)} />
                {release.catalog_number && <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs font-medium text-muted-foreground">{release.catalog_number}</span>}
                {release.status && <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium capitalize text-muted-foreground">{release.status.replace(/_/g, " ")}</span>}
              </div>
              <h1 className="truncate text-2xl font-semibold tracking-tight">{release.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {release.artist_name || "No artist"} · {release.format || "No format"} · {release.release_date ? formatDate(release.release_date) : "No date"}
              </p>
              {release.parent_release_id && <a href={`/releases/${release.parent_release_id}`} className="mt-1 inline-block text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">Part of an EP rollout</a>}
            </div>

            <div className="flex flex-wrap gap-2">
              <ReleaseEditButton release={release} artists={artists} parentReleases={parentReleases} />
              <ReleaseDeleteButton release={release} />
              <a
                href={`/releases/${release.id}/tracks`}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Manage tracks
              </a>
            </div>
          </div>

          <aside className="w-full rounded-2xl border border-border bg-card p-3 lg:w-64">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Setup checklist</p>
                <p className="mt-1 text-xl font-semibold tracking-tight">{progress}%</p>
              </div>
              <ListChecks className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {nextFix ? `Next: ${nextFix.label}` : "Checklist complete."}<br />Includes optional pitch and analytics setup.
            </p>
          </aside>
        </div>
      </header>

      <nav className="sticky top-2 z-20 overflow-x-auto rounded-xl border border-border bg-background/95 p-1 shadow-sm backdrop-blur" aria-label="Release sections" role="tablist">
        <div className="flex min-w-max gap-1">
          {RELEASE_SECTIONS.map((section) => (
            <Button
              key={section.key}
              id={`release-tab-${section.key}`}
              variant="ghost"
              type="button"
              role="tab"
              aria-selected={activeSection === section.key}
              title={section.description}
              onClick={() => selectSection(section.key)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeSection === section.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {section.label}
            </Button>
          ))}
        </div>
      </nav>

      {activeSection === "overview" && <ReleaseDeliveryPanel compact releaseId={release.id} canManage={canManage} onOpen={()=>selectSection("assets")} onInspect={tracks=>tracks?selectSection("tracks"):selectSection("overview","upc")} />}

      {activeSection === "overview" && <ReleaseOperationsBrief brief={operationsBrief} onAction={handleBriefAction} />}

      {activeSection === "overview" && (
        <ReleaseAuthorityPanel release={release} tracks={tracks} works={works} />
      )}

      {activeSection === "overview" && <section id="release-readiness" aria-label="Required release checks" className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold">{readiness ? readiness.readiness.isReady ? "Required release checks pass" : "Release needs attention" : "Required checks have not been refreshed"}</h2>
        <p className="text-sm text-muted-foreground">Required metadata, track audio and rights checks are separate from the optional setup checklist.</p>
        {readiness && <ul className="list-disc pl-5 text-sm">{readiness.readiness.missing.map((missing, index) => <li key={`${index}-${missing}`}>{missing}</li>)}</ul>}
        <div className="flex flex-wrap gap-2">
          {(["cover", "upc", "date", "format"] as const).map(key => <Button id={`release-correct-${key}`} key={key} type="button" variant="outline" onClick={() => selectSection("overview", key)}>{canManage ? "Correct" : "Inspect"} {key === "upc" ? "UPC/EAN" : key === "cover" ? "cover art" : key}</Button>)}
          <Button type="button" variant="outline" onClick={() => selectSection("tracks")}>Review track evidence</Button>
          {fromToday && <a className="self-center underline" href="/today">Back to Today</a>}
        </div>
      </section>}

      {activeFix && (["cover", "upc", "date", "format"] as string[]).includes(activeFix) && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Release action editor">
          <ReleaseFieldCorrection key={activeFix} releaseId={release.id}
            field={({ cover: "cover_art_url", upc: "upc_ean", date: "release_date", format: "format" } as const)[activeFix as ReleaseOverviewFixFocus]}
            fallbackValue={({ cover: release.cover_art_url, upc: release.upc_ean, date: release.release_date, format: release.format })[activeFix as ReleaseOverviewFixFocus]}
            inputId={releaseFocusId(activeFix as ReleaseOverviewFixFocus)} initial={readiness} canManage={canManage}
            onSnapshot={acceptReadiness} onDirtyChange={onCorrectionDirty}
            onClose={() => { if (selectSection("overview")) requestAnimationFrame(() => (correctionTrigger.current ?? document.getElementById("release-tab-overview"))?.focus()); }} />
        </section>
      )}

      <section className="space-y-4" aria-label="Release workspace content">
        {activeSection === "overview" && (
          <Panel title="Release workspace map">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RELEASE_SECTIONS.filter((section) => section.key !== "overview").map((section) => (
                <Button key={section.key} variant="outline" type="button" onClick={() => selectSection(section.key)} className="block h-auto min-w-0 whitespace-normal rounded-lg border border-border p-3 text-left transition hover:border-foreground/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="text-sm font-medium">{section.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                </Button>
              ))}
            </div>
          </Panel>
        )}

        {activeSection === "timeline" && <div id="release-timeline" className="scroll-mt-4">
          <ReleaseTimeline releaseId={release.id} canManage={canManage} timeline={timeline} />
        </div>}

        {activeSection === "tracks" && <Panel
          title="Tracklist"
          action={<a href={`/releases/${release.id}/tracks`} className="text-xs font-medium text-muted-foreground hover:text-foreground">Manage tracks</a>}
        >
          <div className="space-y-3">
            <SamplyReviewPanel
              releaseId={release.id}
              canManage={canManage}
              review={samplyReview}
              onUpdate={setSamplyReview}
            />
            <TrackTable
              tracks={tracks}
              works={works}
              samplyInventory={samplyReview?.inventory ?? []}
              activeRemoteBoxId={reviewSelection?.version.remoteBoxId ?? null}
              onReviewSelect={handleReviewSelect}
            />
          </div>
        </Panel>}

        {activeSection === "campaigns" && <ReleaseCampaignsPanel campaigns={campaigns} />}

        {activeSection === "budget" && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title="Budget">
            <BudgetBucketSummary items={budgetItems} />
          </Panel>
          <div id="dsp-pitches" className="scroll-mt-4">
            <Panel title="DSP pitches" action={<Button type="button" onClick={() => setPitchOpen(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground">Add pitch</Button>}>
              <PitchList pitches={pitches} />
            </Panel>
          </div>
        </div>}

        {activeSection === "assets" && <div className="space-y-5"><ReleaseDeliveryPanel releaseId={release.id} canManage={canManage} onOpen={()=>selectSection("assets")} onInspect={tracks=>tracks?selectSection("tracks"):selectSection("overview","upc")} /><ReleaseAssetsPanel documents={documents} mediaAssets={mediaAssets} /></div>}

        {activeSection === "analytics" && <div id="performance-data" className="scroll-mt-4">
          <Panel title="Performance data" action={<span className="text-xs text-muted-foreground">{cockpit?.dataWindow.from ? `${formatDate(cockpit.dataWindow.from)} to ${cockpit.dataWindow.to ? formatDate(cockpit.dataWindow.to) : "now"}` : "No scoped window"}</span>}>
            <ReleaseDataPanel cockpit={cockpit} hasScopedAnalytics={hasScopedAnalytics} />
          </Panel>
        </div>}
      </section>

      {pitchOpen && (
        <Modal title="Add DSP pitch" onClose={() => setPitchOpen(false)}>
          <DspPitchForm releaseId={release.id} onClose={() => setPitchOpen(false)} />
        </Modal>
      )}

      {reviewSelection && (
        <ReviewPlaybackDock
          selection={reviewSelection}
          comments={reviewComments}
          commentsLoading={reviewCommentsLoading}
          commentsError={reviewCommentsError}
          audioError={reviewAudioError}
          waveformPeaks={reviewWaveformPeaks}
          waveformLoading={reviewWaveformLoading}
          waveformError={reviewWaveformError}
          audioRef={reviewAudioRef}
          playing={reviewPlaying}
          currentTime={reviewCurrentTime}
          duration={reviewDuration}
          onTogglePlayback={toggleReviewPlayback}
          onSeek={seekReview}
          onClose={handleReviewClose}
          onTimeUpdate={(time) => setReviewCurrentTime(time)}
          onDurationChange={(duration) => setReviewDuration(duration)}
          onPlayingChange={setReviewPlaying}
          onAudioError={() => setReviewAudioError("Could not load audio from Samply. Try syncing the project or checking Samply download permissions.")}
        />
      )}
    </div>
  );
}

function ReleaseAuthorityPanel({
  release,
  tracks,
  works,
}: {
  release: ReleaseDetail;
  tracks: TrackRow[];
  works: Array<{ id: string; title: string; isrc: string | null }>;
}) {
  const linkedTrackCount = tracks.filter((track) => Boolean(track.work_id && works.some((work) => work.id === track.work_id))).length;
  const missingWorkCount = tracks.length - linkedTrackCount;
  const publishingReadyCount = tracks.filter((track) => (track.clearance_pub ?? 0) >= 1).length;
  const masterReadyCount = tracks.filter((track) => (track.clearance_master ?? 0) >= 1).length;

  return (
    <Panel title="Record authority & sign-off evidence">
      <div className="grid gap-3 md:grid-cols-3">
        <EvidenceCell
          label="Canonical record chain"
          value={`${release.catalog_number ? "Release → catalog entry" : "Release → catalog entry pending"}`}
          detail={`${tracks.length} track${tracks.length === 1 ? "" : "s"} · ${works.length} work${works.length === 1 ? "" : "s"}`}
          tone={release.catalog_number ? "ready" : "warn"}
        />
        <EvidenceCell
          label="Track → work links"
          value={`${linkedTrackCount}/${tracks.length || 0} linked`}
          detail={missingWorkCount ? `${missingWorkCount} track${missingWorkCount === 1 ? "" : "s"} need an explicit work link` : "Every release track has a linked work"}
          tone={missingWorkCount ? "warn" : "ready"}
        />
        <EvidenceCell
          label="Rights readiness"
          value={`${publishingReadyCount}/${tracks.length || 0} publishing · ${masterReadyCount}/${tracks.length || 0} master`}
          detail={release.release_ready ? "Release readiness is currently true" : "Missing rights or release fields remain visible"}
          tone={release.release_ready ? "ready" : "warn"}
        />
      </div>
      <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Source boundary:</span> Label Suite release, catalog, track, work, and rights fields are canonical. Airtable may be consulted as read-only reference evidence; this workspace performs no Airtable writes or destructive migration.
      </div>
    </Panel>
  );
}

function EvidenceCell({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "ready" | "warn";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/15 p-3">
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${tone === "ready" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SamplyReviewPanel({
  releaseId,
  canManage,
  review,
  onUpdate,
}: {
  releaseId: string;
  canManage: boolean;
  review: SamplyReviewState | null;
  onUpdate: (next: SamplyReviewState) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [projectOptions, setProjectOptions] = useState<SamplyProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [manualProjectId, setManualProjectId] = useState("");

  const hasProject = Boolean(review?.project);
  const audioVersionCount = review?.inventory.length ?? 0;
  const syncedTrackCount = new Set(review?.inventory.map((item) => item.trackId).filter(Boolean)).size;

  async function loadProjects() {
    setProjectsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/samply/projects");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not load Samply projects");
      }
      const options = (data.projects || []) as SamplyProjectOption[];
      setProjectOptions(options);
      if (!selectedProjectId && options[0]?.id) setSelectedProjectId(options[0].id);
    } catch (err: any) {
      setError(err.message || "Could not load Samply projects");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function createProjectWorkspace() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/releases/${releaseId}/samply`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not create Samply project");
      }
      onUpdate(data as SamplyReviewState);
    } catch (err: any) {
      setError(err.message || "Could not create Samply project");
    } finally {
      setLoading(false);
    }
  }

  async function linkExistingProject() {
    const remoteProjectId = (manualProjectId.trim() || selectedProjectId).trim();
    if (!remoteProjectId) {
      setError("Choose a Samply project or paste a project id");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/releases/${releaseId}/samply/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteProjectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not link Samply project");
      }
      onUpdate(data as SamplyReviewState);
      setLinkMode(false);
      setManualProjectId("");
    } catch (err: any) {
      setError(err.message || "Could not link Samply project");
    } finally {
      setLoading(false);
    }
  }

  async function syncProject() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/releases/${releaseId}/samply/sync`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not sync Samply project");
      }
      onUpdate(data as SamplyReviewState);
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Could not sync Samply project");
    } finally {
      setLoading(false);
    }
  }

  if (!hasProject) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5">
          <p className="text-sm font-medium text-foreground">No Samply release project is linked yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a Samply project for this release, or link an existing Samply project that should act as the authoritative home for artwork, tracklist, audio, versions, and review activity.
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={createProjectWorkspace}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Samply project"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                const next = !linkMode;
                setLinkMode(next);
                if (next && !projectOptions.length) {
                  void loadProjects();
                }
              }}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              {linkMode ? "Cancel link" : "Link existing project"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ask an owner or operator to link a Samply project for this release.</p>
        )}
        {canManage && linkMode && (
          <div className="space-y-3 rounded-lg border border-border bg-background p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Link an existing Samply project</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This tells Label Suite which Samply project should be treated as the release’s authoritative audio workspace.
              </p>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Choose from your Samply projects</label>
              <NativeSelect
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{projectsLoading ? "Loading..." : "Select a project..."}</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.linkedReleaseTitle ? ` (linked to ${project.linkedReleaseTitle})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Or paste a Samply project URL/id</label>
              <Input
                value={manualProjectId}
                onChange={(event) => setManualProjectId(event.target.value)}
                placeholder="https://next.samply.app/p/EqiEV20qyJgYFD9n2PUq"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button
              type="button"
              onClick={linkExistingProject}
              disabled={loading || projectsLoading}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              {loading ? "Linking..." : "Link Samply project"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const player = review?.player ?? null;
  const project = review!.project;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Source: Samply</span>
            <p className="truncate text-sm font-medium text-foreground">{project?.remoteProjectName || "Samply project"}</p>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{syncedTrackCount} release track{syncedTrackCount === 1 ? "" : "s"}</span>
            <span>{audioVersionCount} audio version{audioVersionCount === 1 ? "" : "s"}</span>
            <span>{review?.artworkUrl ? "cover synced" : "no Samply cover"}</span>
            <span>{review?.lastSyncedAt ? `last sync ${formatSamplyDateTime(review.lastSyncedAt)}` : "not synced yet"}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canManage && (
            <Button
              type="button"
              onClick={syncProject}
              disabled={loading}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              {loading ? "Syncing..." : "Sync from Samply"}
            </Button>
          )}
          {canManage && (
            <Button
              type="button"
              onClick={() => {
                const next = !linkMode;
                setLinkMode(next);
                if (next && !projectOptions.length) {
                  void loadProjects();
                }
              }}
              className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              {linkMode ? "Cancel relink" : "Link different project"}
            </Button>
          )}
          {player && (
            <a
              href={player.shareUrl || player.embedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Open link
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {!audioVersionCount && (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          The project is linked, but Label Suite has not pulled the Samply file inventory yet. Run sync to ingest cover art, tracklist, and stable audio links.
        </p>
      )}

      {canManage && linkMode && (
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Relink to a different Samply project</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use this if the release should follow a different Samply project as its authoritative audio/review workspace.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Choose from your Samply projects</label>
            <NativeSelect
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">{projectsLoading ? "Loading..." : "Select a project..."}</option>
              {projectOptions.map((projectOption) => (
                <option key={projectOption.id} value={projectOption.id}>
                  {projectOption.name}
                  {projectOption.linkedReleaseTitle ? ` (linked to ${projectOption.linkedReleaseTitle})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Or paste a Samply project URL/id</label>
            <Input
              value={manualProjectId}
              onChange={(event) => setManualProjectId(event.target.value)}
              placeholder="https://next.samply.app/p/EqiEV20qyJgYFD9n2PUq"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button
            type="button"
            onClick={linkExistingProject}
            disabled={loading || projectsLoading}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            {loading ? "Linking..." : "Link Samply project"}
          </Button>
        </div>
      )}
    </div>
  );
}

function CoverWorkbench({
  release,
  active,
  onOpen,
  onPreviewFailed,
}: {
  release: ReleaseDetail;
  active: boolean;
  onOpen: () => void;
  onPreviewFailed: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!release.cover_art_url) {
      setSrc(null);
      return;
    }
    if (/^https?:\/\//i.test(release.cover_art_url)) {
      setSrc(release.cover_art_url);
      return;
    }
    resolveFileUrl(release.cover_art_url, 320)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
          onPreviewFailed();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [release.cover_art_url]);

  return (
    <div className="w-24 shrink-0 sm:w-28">
      <Button
        type="button"
        onClick={onOpen}
        id="release-cover-button"
        variant="outline"
        className={`group relative block aspect-square h-auto w-full overflow-hidden rounded-lg border p-0 text-left whitespace-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${active ? "border-foreground" : "border-border hover:border-foreground/60"}`}
      >
        {src && !failed ? (
          <img
            src={src}
            alt=""
            width={320}
            height={320}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => {
              setFailed(true);
              onPreviewFailed();
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-80" />
            <span className="mt-2 px-2 text-center text-xs font-medium">{release.cover_art_url ? "Preview unavailable" : "Add cover"}</span>
          </div>
        )}
        <span className="absolute inset-x-2 bottom-2 rounded-md bg-background/95 px-2 py-1.5 text-center text-xs font-medium text-foreground opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
          Replace
        </span>
      </Button>
    </div>
  );
}

function priorityRank(item: FixItem, releaseDate: string | null): number {
  if (item.done) return 100 + basePriority(item.key);
  const days = daysUntilRelease(releaseDate);
  const urgencyBoost = days != null && days >= 0 && days <= 30 ? -10 : 0;
  return basePriority(item.key) + urgencyBoost;
}

function basePriority(key: FixKey): number {
  switch (key) {
    case "date":
    case "format":
    case "cover":
    case "upc":
      return 10;
    case "tracks":
    case "track-readiness":
      return 20;
    case "pitch":
      return 40;
    case "analytics":
      return 60;
  }
}

function daysUntilRelease(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86_400_000);
}

function TrackTable({
  tracks,
  works,
  samplyInventory,
  activeRemoteBoxId,
  onReviewSelect,
}: {
  tracks: TrackRow[];
  works: Array<{ id: string; title: string; isrc: string | null }>;
  samplyInventory: SamplyReviewState["inventory"];
  activeRemoteBoxId: string | null;
  onReviewSelect: (track: TrackRow, version: SamplyReviewState["inventory"][number]) => void;
}) {
  if (!tracks.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No tracks yet. Add tracks so release readiness can become meaningful.
      </div>
    );
  }

  const versionsByTrack = new Map<string, SamplyReviewState["inventory"]>();
  for (const item of samplyInventory) {
    if (!item.trackId) continue;
    const versions = versionsByTrack.get(item.trackId) ?? [];
    versions.push(item);
    versionsByTrack.set(item.trackId, versions);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="grid grid-cols-[44px_minmax(180px,1fr)_120px_134px_100px_120px] bg-muted/35 px-3 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground max-xl:hidden">
        <div>No.</div>
        <div>Track</div>
        <div>Audio</div>
        <div>ISRC</div>
        <div>Clearance</div>
        <div className="text-right">Actions</div>
      </div>
      <div className="divide-y divide-border">
        {tracks.map((track) => {
          const clearance = Math.round((track.clearance_progress ?? 0) * 100);
          const versions = versionsByTrack.get(track.id) ?? [];
          const primaryVersion = versions.find((version) => version.audioUrl === track.audio_url) ?? versions.at(-1) ?? null;
          const activeOnTrack = versions.some((version) => activeRemoteBoxId === version.remoteBoxId);
          return (
            <div key={track.id} className={`grid gap-2 px-3 py-2.5 transition xl:grid-cols-[44px_minmax(180px,1fr)_120px_134px_100px_120px] xl:items-center ${activeOnTrack ? "bg-muted/30" : ""}`}>
              <div className="text-sm font-medium text-muted-foreground">{track.position ?? "-"}</div>
              <div className="flex min-w-0 items-start gap-2.5">
                {primaryVersion ? (
                  <Button
                    type="button"
                    onClick={() => onReviewSelect(track, primaryVersion)}
                    disabled={!primaryVersion.audioUrl}
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${activeOnTrack ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-muted text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"}`}
                    aria-label={`Review ${track.title}`}
                    title={primaryVersion.audioUrl ? `Play ${track.title}` : "No playable audio URL"}
                  >
                    <Play className="ml-0.5 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                    <FileAudio className="h-3.5 w-3.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{track.title}</p>
                    {track.track_ready ? (
                      <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">Ready</span>
                    ) : (
                      <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Needs work</span>
                    )}
                  </div>
                  {track.track_missing && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{track.track_missing}</p>}
                  {versions.length > 1 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {versions.map((version, index) => (
                        <Button
                          type="button"
                          key={version.remoteBoxId}
                          onClick={() => onReviewSelect(track, version)}
                          disabled={!version.audioUrl}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${activeRemoteBoxId === version.remoteBoxId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                          title={version.fileName}
                        >
                          {version.version ?? version.fileName.match(/\bv\d+(?:\.\d+)?\b/i)?.[0] ?? `v${index + 1}`}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <Signal ok={Boolean(primaryVersion?.audioUrl || track.audio_url)} icon={<FileAudio className="h-4 w-4" />} label={primaryVersion ? `${versions.length || 1} version${versions.length === 1 ? "" : "s"}` : track.audio_url ? "Audio linked" : "No audio"} />
              <Signal ok={Boolean(track.isrc)} icon={<Music2 className="h-4 w-4" />} label={track.isrc || "No ISRC"} />
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span>{clearance}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${clearance}%` }} />
                </div>
              </div>
              <div className="flex justify-end gap-2 whitespace-nowrap">
                <TrackEditButton track={track} works={works} />
                <TrackDeleteButton track={track} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewPlaybackDock({
  selection,
  comments,
  commentsLoading,
  commentsError,
  audioError,
  waveformPeaks,
  waveformLoading,
  waveformError,
  audioRef,
  playing,
  currentTime,
  duration,
  onTogglePlayback,
  onSeek,
  onClose,
  onTimeUpdate,
  onDurationChange,
  onPlayingChange,
  onAudioError,
}: {
  selection: ReviewSelection;
  comments: SamplyReviewComment[];
  commentsLoading: boolean;
  commentsError: string;
  audioError: string;
  waveformPeaks: number[];
  waveformLoading: boolean;
  waveformError: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  currentTime: number;
  duration: number;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onClose: () => void;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onAudioError: () => void;
}) {
  const versionLabel = selection.version.version
    ?? selection.version.fileName.match(/\bv\d+(?:\.\d+)?\b/i)?.[0]
    ?? "Main";
  const progressMax = duration > 0 ? duration : Math.max(currentTime, 1);
  const displayDuration = duration || selection.version.duration || 0;
  const progressPct = displayDuration > 0 ? Math.min(100, Math.max(0, (currentTime / displayDuration) * 100)) : 0;
  const timedComments = comments.filter((comment) => comment.audioTimestamp != null && displayDuration > 0);
  const [volume, setVolume] = useState(1);

  const updateVolume = (nextVolume: number) => {
    const safeVolume = Math.min(1, Math.max(0, nextVolume));
    setVolume(safeVolume);
    if (audioRef.current) audioRef.current.volume = safeVolume;
  };

  return (
    <aside data-review-dock className="fixed inset-x-0 bottom-16 z-40 border-t border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_-12px_36px_rgba(0,0,0,0.08)] md:bottom-0">
      <audio
        ref={audioRef}
        src={selection.version.audioUrl ?? undefined}
        onLoadedMetadata={(event) => {
          onDurationChange(event.currentTarget.duration || 0);
          onTimeUpdate(event.currentTarget.currentTime);
        }}
        onDurationChange={(event) => onDurationChange(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onEnded={() => onPlayingChange(false)}
        onError={onAudioError}
        className="hidden"
      />

      <div className="flex min-h-24 md:h-20 md:min-h-0">
        <div className="flex w-12 shrink-0 flex-col border-r border-sidebar-border">
          <Button variant="ghost"
            type="button"
            onClick={onTogglePlayback}
            disabled={!selection.version.audioUrl}
            className="grid size-12 place-items-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={playing ? "Pause audio" : "Play audio"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
          </Button>
          <Button variant="outline"
            type="button"
            onClick={onClose}
            className="grid size-12 place-items-center border-t border-sidebar-border text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
            aria-label="Close reviewer"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col px-3 py-2 md:px-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-tight">{selection.track.title}</p>
              <p className="truncate text-[11px] leading-tight text-sidebar-foreground/55">{versionLabel} · {selection.version.fileName}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-sidebar-foreground/60">
              <span data-review-current-time>{formatDuration(currentTime)}</span>
              <span>/</span>
              <span>{displayDuration ? formatDuration(displayDuration) : "--:--"}</span>
            </div>
          </div>

          <div className="relative mt-2 h-12 min-w-0">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sidebar-border" />
            <WaveformBars peaks={waveformPeaks} progressPct={progressPct} loading={waveformLoading} />
            {waveformError && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[11px] text-sidebar-foreground/55">
                {waveformError}
              </span>
            )}
            {timedComments.map((comment) => {
              const left = Math.min(99, Math.max(1, ((comment.audioTimestamp ?? 0) / displayDuration) * 100));
              return (
                <div
                  key={comment.id}
                  className="group/comment absolute inset-y-0 -translate-x-1/2"
                  style={{ left: `${left}%` }}
                >
                  <Button
                    type="button"
                    onClick={() => onSeek(comment.audioTimestamp ?? 0)}
                    className="relative h-full w-4 cursor-pointer outline-none"
                    aria-label={`Jump to comment at ${formatDuration(comment.audioTimestamp)}`}
                  >
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-sidebar-foreground/45 transition-colors group-hover/comment:bg-sidebar-foreground group-focus-visible/comment:bg-sidebar-foreground" />
                    <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 bg-sidebar-foreground transition-transform group-hover/comment:scale-150 group-focus-visible/comment:scale-150" />
                  </Button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 w-64 -translate-x-1/2 translate-y-1 border border-sidebar-border bg-sidebar p-3 text-xs text-sidebar-foreground opacity-0 shadow-lg transition-all duration-200 ease-out group-hover/comment:translate-y-0 group-hover/comment:opacity-100 group-focus-within/comment:translate-y-0 group-focus-within/comment:opacity-100">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/55">
                      <span>{formatDuration(comment.audioTimestamp)}</span>
                      <span>{comment.completed ? "Resolved" : "Open"}</span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap">{comment.message}</p>
                  </div>
                </div>
              );
            })}
            <div className="absolute inset-y-0 w-px bg-sidebar-foreground" style={{ left: `${progressPct}%` }} />
            <Input
              type="range"
              min={0}
              max={progressMax}
              step={0.1}
              value={Math.min(currentTime, progressMax)}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Audio progress"
            />
          </div>

          {(audioError || commentsError) && (
            <p className="mt-1 truncate text-[11px] text-sidebar-foreground/70">
              {audioError || commentsError}
            </p>
          )}
        </div>

        <div className="hidden w-44 shrink-0 items-center gap-3 border-l border-sidebar-border px-3 md:flex">
          <Volume2 className="size-4 text-sidebar-foreground/65" />
          <Input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => updateVolume(Number(event.target.value))}
            className="h-1 flex-1 accent-sidebar-foreground"
            aria-label="Volume"
          />
        </div>

        <div className="group/notes relative hidden w-14 shrink-0 border-l border-sidebar-border md:block">
          <Button variant="ghost"
            type="button"
            className="grid h-full w-full place-items-center text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={`${comments.length} Samply comments`}
          >
            <MessageCircle className="size-4" />
            {comments.length > 0 && <span className="absolute right-2 top-2 text-[10px] tabular-nums">{comments.length}</span>}
          </Button>
          <div className="pointer-events-none absolute bottom-full right-2 mb-3 w-72 translate-y-1 border border-sidebar-border bg-sidebar p-3 text-xs opacity-0 shadow-lg transition-all duration-200 ease-out group-hover/notes:translate-y-0 group-hover/notes:opacity-100">
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/55">
              <span>Samply notes</span>
              <span>{comments.length} synced</span>
            </div>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {commentsLoading && <p className="text-sidebar-foreground/60">Loading comments...</p>}
              {!commentsLoading && !comments.length && !commentsError && <p className="text-sidebar-foreground/60">No comments on this version yet.</p>}
              {comments.slice(0, 5).map((comment) => (
                <Button
                  type="button"
                  key={comment.id}
                  onClick={() => comment.audioTimestamp != null && onSeek(comment.audioTimestamp)}
                  className="pointer-events-auto block w-full border-l border-sidebar-border pl-2 text-left transition-colors hover:border-sidebar-foreground"
                >
                  <span className="mb-0.5 block text-[11px] text-sidebar-foreground/55">
                    {comment.audioTimestamp == null ? "General note" : formatDuration(comment.audioTimestamp)}
                  </span>
                  <span className="line-clamp-2">{comment.message}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        <Button variant="outline"
          type="button"
          onClick={onClose}
          className="hidden w-12 shrink-0 place-items-center border-l border-sidebar-border text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:grid"
          aria-label="Close reviewer"
        >
          <X className="size-4" />
        </Button>
      </div>
    </aside>
  );
}

function WaveformBars({
  peaks,
  progressPct,
  loading,
}: {
  peaks: number[];
  progressPct: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-px">
        {Array.from({ length: 64 }).map((_, index) => (
          <span
            key={index}
            className="h-2 flex-1 animate-pulse bg-sidebar-foreground/15"
            style={{ animationDelay: `${index * 16}ms` }}
          />
        ))}
      </div>
    );
  }

  if (!peaks.length) return null;

  return (
    <div data-review-waveform className="absolute inset-0 overflow-hidden">
      <WaveformLayer peaks={peaks} className="bg-sidebar-foreground/20" />
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${progressPct}%` }}>
        <WaveformLayer peaks={peaks} className="bg-sidebar-foreground/70" />
      </div>
    </div>
  );
}

function WaveformLayer({ peaks, className }: { peaks: number[]; className: string }) {
  return (
    <div className="absolute inset-0 flex items-center gap-px">
      {peaks.map((peak, index) => (
        <span
          key={`${index}-${peak.toFixed(3)}`}
          data-review-waveform-bar
          className={`w-px min-w-px ${className}`}
          style={{ height: `${Math.max(1, peak * 28)}px`, flex: "1 1 0" }}
        />
      ))}
    </div>
  );
}

function ReleaseDataPanel({ cockpit, hasScopedAnalytics }: { cockpit: ReleaseCockpit | null; hasScopedAnalytics: boolean }) {
  if (!cockpit || !hasScopedAnalytics) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">No trustworthy release-level stream data yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This release has no matched nonzero analytics rows. Import Sisense rows linked by release, track, or ISRC before showing top track, city, source, or trend claims.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const period = cockpit.periods.find((item) => item.key === cockpit.defaultPeriod) ?? cockpit.periods[0];
  const topTrack = cockpit.leaderboard[0] ?? null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Period streams" value={formatNumber(period.streamTotal)} detail={period.label} icon={<BarChart3 className="h-4 w-4" />} />
        <Metric label="Top track" value={topTrack?.trackTitle ?? "No track data"} detail={topTrack ? `${formatNumber(topTrack.combinedStreams)} streams` : "not enough data"} icon={<Music2 className="h-4 w-4" />} />
        <Metric label="Top city" value={period.topCity?.city ?? "No city data"} detail={period.topCity ? `${formatNumber(period.topCity.streams)} streams` : "not enough data"} icon={<CalendarDays className="h-4 w-4" />} />
        <Metric label="Top source" value={period.topSource?.source ?? "No source data"} detail={period.topSource ? `${Math.round(period.topSource.sharePct * 100)}% share` : "not enough data"} icon={<Disc3 className="h-4 w-4" />} />
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium text-foreground">Track leaderboard</p>
        <div className="mt-3 space-y-2">
          {cockpit.leaderboard.length ? (
            cockpit.leaderboard.slice(0, 5).map((track) => (
              <div key={track.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{track.trackTitle}</span>
                <span className="font-medium tabular-nums">{formatNumber(track.combinedStreams)}</span>
              </div>
            ))
          ) : (
            <p className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
              No nonzero track-level rows matched this release yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PitchList({ pitches }: { pitches: PitchRow[] }) {
  if (!pitches.length) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No DSP pitches yet.</p>;
  }
  return (
    <div className="space-y-2">
      {pitches.map((pitch) => (
        <div key={pitch.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{pitch.platform || "DSP pitch"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{pitch.sent_date ? formatDate(pitch.sent_date) : "No sent date"}</p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{pitch.status || "draft"}</span>
          </div>
          {pitch.response && <p className="mt-2 text-xs text-muted-foreground">{pitch.response}</p>}
        </div>
      ))}
    </div>
  );
}

function ReleaseCampaignsPanel({
  campaigns,
}: {
  campaigns: Props["campaigns"];
}) {
  return (
    <Panel
      title="Linked campaigns"
      action={<a href="/campaigns" className="text-xs font-medium text-muted-foreground hover:text-foreground">Open campaigns</a>}
    >
      {campaigns.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {campaigns.map((campaign) => (
            <a key={campaign.id} href={`/campaigns/${campaign.id}`} className="rounded-lg border border-border p-3 transition hover:border-foreground/40 hover:bg-muted/30">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{campaign.campaign_name}</p>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">{campaign.status || "planning"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {[campaign.campaign_type, campaign.main_platform, campaign.artist_name].filter(Boolean).join(" · ") || "Campaign context"}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {[campaign.start_date, campaign.end_date ? `→ ${campaign.end_date}` : null, campaign.owner].filter(Boolean).join(" ") || "No schedule or owner"}
              </p>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No campaigns are linked to this release yet. Create or link one from the campaigns workspace before planning a channel.
        </div>
      )}
    </Panel>
  );
}

function ReleaseAssetsPanel({
  documents,
  mediaAssets,
}: {
  documents: Props["documents"];
  mediaAssets: Props["mediaAssets"];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Media assets" action={<a href="/media-assets" className="text-xs font-medium text-muted-foreground hover:text-foreground">Open assets</a>}>
        {mediaAssets.length ? (
          <div className="space-y-2">
            {mediaAssets.map((asset) => (
              <a key={asset.id} href={asset.file_link || "/media-assets"} target={asset.file_link ? "_blank" : undefined} rel={asset.file_link ? "noreferrer" : undefined} className="block rounded-lg border border-border p-3 transition hover:border-foreground/40 hover:bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{asset.asset_name}</p>
                  <span className="text-[11px] text-muted-foreground">{asset.approval_status || "pending"}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{[asset.asset_type, asset.version, asset.delivery_status].filter(Boolean).join(" · ") || "Release asset"}</p>
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No release-linked media assets yet.</p>
        )}
      </Panel>
      <Panel title="Documents" action={<a href="/documents" className="text-xs font-medium text-muted-foreground hover:text-foreground">Open documents</a>}>
        {documents.length ? (
          <div className="space-y-2">
            {documents.map((document) => (
              <a key={document.id} href={document.file_link || "/documents"} target={document.file_link ? "_blank" : undefined} rel={document.file_link ? "noreferrer" : undefined} className="block rounded-lg border border-border p-3 transition hover:border-foreground/40 hover:bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{document.name}</p>
                  <span className="text-[11px] text-muted-foreground">{document.status || "draft"}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{document.doc_type || "Release document"}</p>
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No release-linked documents yet.</p>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function sectionFromHash(hash: string): ReleaseSection {
  const value = hash.replace(/^#/, "");
  if (value === "release-timeline") return "timeline";
  if (value === "dsp-pitches") return "budget";
  if (value === "performance-data") return "analytics";
  const section = value.replace(/^release-/, "") as ReleaseSection;
  return RELEASE_SECTIONS.some((item) => item.key === section) ? section : "overview";
}

function sectionHash(section: ReleaseSection): string {
  if (section === "timeline") return "release-timeline";
  if (section === "budget") return "dsp-pitches";
  if (section === "analytics") return "performance-data";
  return `release-${section}`;
}

function sectionFromSearch(value: string | null): ReleaseSection | null {
  return RELEASE_SECTIONS.some((section) => section.key === value) ? (value as ReleaseSection) : null;
}

function releaseFixFromSearch(value: string | null): ReleaseOverviewFixFocus | null {
  if (value === "cover" || value === "upc" || value === "date" || value === "format") return value;
  return null;
}

export function routeFromLocation(search: string, hash: string): ParsedReleaseRoute {
  const params = new URLSearchParams(search);
  const section = sectionFromSearch(params.get("section")) ?? sectionFromHash(hash);
  const focus = section === "overview" ? releaseFixFromSearch(params.get("focus")) : null;
  return { section, focus };
}

export function briefActionNavigationTarget(key: ReleaseBriefActionKey, evidenceHref?: string): string | null {
  if (key === "track-readiness" && evidenceHref) {
    return evidenceHref;
  }
  return null;
}

export function releaseFocusId(focus: ReleaseOverviewFixFocus): string {
  if (focus === "upc") return "release-upc-ean";
  if (focus === "date") return "release-date";
  if (focus === "format") return "release-format";
  return COVER_FORM_FOCUS_ID;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-1.5 truncate text-lg font-semibold tracking-tight" title={value}>{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Signal({ ok, icon, label }: { ok: boolean; icon: ReactNode; label: string }) {
  return (
    <div className={`inline-flex items-center gap-1.5 text-sm ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function StatusPill({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Ready</span>
  ) : (
    <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">Needs finishing</span>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "--:--";
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function buildWaveformPeaks(audioBuffer: AudioBuffer, barCount: number): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBar = Math.max(1, Math.floor(channelData.length / barCount));
  const peaks: number[] = [];

  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const start = barIndex * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(0.08, peak / maxPeak));
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatSamplyDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
