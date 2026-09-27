"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { ReleaseDeleteButton, ReleaseEditButton } from "./ReleaseActionButtons";
import { ReleaseCreateDialog } from "./ReleaseCreateDialog";
import type { Release } from "./ReleaseForm";
import type { ReleaseRosterRow } from "../../server/releases";
import { resolveFileUrl } from "../../lib/storage-client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
type FilterMode = "all" | "upcoming" | "ready" | "attention" | "released";
type SortMode = "date" | "readiness" | "budget" | "title";

function dateLabel(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86_400_000);
}

function readiness(row: ReleaseRosterRow): number {
  const checks = [
    Boolean(row.artist_id),
    Boolean(row.release_date),
    Boolean(row.format),
    Boolean(row.upc_ean),
    Boolean(row.cover_art_url),
    row.track_count > 0,
    row.track_count > 0 && row.ready_track_count === row.track_count,
    row.pitch_count > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "R";
}

function normalizedStatus(value: string | null): string {
  const key = (value || "draft").toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_production" || key === "production") return "in_production";
  if (key === "scheduled") return "scheduled";
  if (key === "released") return "released";
  if (key === "archived") return "archived";
  return "draft";
}

function statusStyle(row: ReleaseRosterRow): { label: string; className: string } {
  const status = normalizedStatus(row.status);
  if (row.release_ready) return { label: "Ready", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (status === "released") return { label: "Released", className: "border-sky-200 bg-sky-50 text-sky-700" };
  if (status === "scheduled") return { label: "Scheduled", className: "border-indigo-200 bg-indigo-50 text-indigo-700" };
  if (status === "in_production") return { label: "In Production", className: "border-neutral-200 bg-neutral-100 text-neutral-700" };
  if (row.missing_release_fields.length >= 4) return { label: "Setup", className: "border-amber-200 bg-amber-50 text-amber-800" };
  return { label: row.status || "Draft", className: "border-neutral-200 bg-neutral-100 text-neutral-700" };
}

function nextAction(row: ReleaseRosterRow): string {
  if (!row.artist_id) return "Assign artist";
  if (!row.release_date) return "Set date";
  if (!row.cover_art_url) return "Add cover";
  if (!row.upc_ean) return "Add UPC/EAN";
  if (!row.track_count) return "Add tracks";
  if (row.ready_track_count < row.track_count) return "Finish track readiness";
  if (!row.pitch_count) return "Create DSP pitch";
  if (!row.release_ready) return "Run readiness sweep";
  return "Monitor release";
}

function attentionScore(row: ReleaseRosterRow): number {
  return row.missing_release_fields.length + (row.release_ready ? 0 : 2) + (row.track_count ? 0 : 2);
}

function releaseTimingLabel(value: string | null): string {
  const days = daysUntil(value);
  if (days == null) return "Date to be set";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d out`;
}

export function ReleaseRoster({
  releases,
  artists,
  canMutate = true,
}: {
  releases: ReleaseRosterRow[];
  artists: Array<{ id: string; name: string }>;
  canMutate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("date");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return releases
      .filter((release) => {
        if (!q) return true;
        return [
          release.title,
          release.artist_name,
          release.format,
          release.status,
          release.upc_ean,
          release.release_missing,
        ].some((value) => (value || "").toLowerCase().includes(q));
      })
      .filter((release) => {
        const days = daysUntil(release.release_date);
        if (filter === "upcoming") return days != null && days >= 0 && normalizedStatus(release.status) !== "released";
        if (filter === "ready") return Boolean(release.release_ready);
        if (filter === "attention") return !release.release_ready || release.missing_release_fields.length > 0;
        if (filter === "released") return normalizedStatus(release.status) === "released";
        return true;
      })
      .sort((a, b) => {
        if (sort === "readiness") return readiness(a) - readiness(b) || attentionScore(b) - attentionScore(a);
        if (sort === "budget") return b.budget_planned - a.budget_planned || a.title.localeCompare(b.title);
        if (sort === "title") return a.title.localeCompare(b.title);
        const aDate = a.release_date ? new Date(`${a.release_date}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
        const bDate = b.release_date ? new Date(`${b.release_date}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
        return bDate - aDate || a.title.localeCompare(b.title);
      });
  }, [filter, query, releases, sort]);

  return (
    <div className="space-y-5">
      <section className="rounded-[1.5rem] border border-neutral-300 bg-neutral-100 px-4 py-4 shadow-[0_20px_70px_rgba(0,0,0,0.06)] dark:border-neutral-700 dark:bg-neutral-900 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search releases"
              placeholder="Search the record catalog..."
              className="h-11 w-full rounded-full border border-neutral-400 bg-white pl-9 pr-4 text-sm text-neutral-950 shadow-sm outline-none transition placeholder:text-neutral-500 hover:border-neutral-500 focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-400"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-11 items-center gap-2 rounded-full border border-neutral-400 bg-white px-3 text-sm text-neutral-600 shadow-sm transition hover:border-neutral-500 focus-within:border-neutral-700 focus-within:ring-2 focus-within:ring-neutral-300 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
              <SlidersHorizontal className="h-4 w-4" />
              <NativeSelect
                value={filter}
                onChange={(event) => setFilter(event.target.value as FilterMode)}
                aria-label="Filter releases by status"
                className="bg-transparent text-foreground outline-none"
              >
                <option value="all">All records</option>
                <option value="upcoming">Upcoming</option>
                <option value="ready">Ready</option>
                <option value="attention">Needs care</option>
                <option value="released">Released</option>
              </NativeSelect>
            </label>
            <label className="inline-flex h-11 items-center gap-2 rounded-full border border-neutral-400 bg-white px-3 text-sm text-neutral-600 shadow-sm transition hover:border-neutral-500 focus-within:border-neutral-700 focus-within:ring-2 focus-within:ring-neutral-300 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
              <ArrowUpDown className="h-4 w-4" />
              <NativeSelect
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                aria-label="Sort releases"
                className="bg-transparent text-foreground outline-none"
              >
                <option value="date">Release date</option>
                <option value="readiness">Most urgent</option>
                <option value="budget">Budget</option>
                <option value="title">Title</option>
              </NativeSelect>
            </label>
            {canMutate ? <ReleaseCreateDialog artists={artists} parentReleases={releases} /> : <ReadOnlyNotice />}
          </div>
        </div>
      </section>

      {visible.length ? (
        <ReleaseGallery releases={visible} artists={artists} canMutate={canMutate} />
      ) : (
        <div className="rounded-[1.5rem] border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">No releases match this catalog view.</p>
          <p className="mt-1 text-sm text-muted-foreground">Adjust search or filters to bring the records back.</p>
        </div>
      )}
    </div>
  );
}

function ReleaseGallery({
  releases,
  artists,
  canMutate,
}: {
  releases: ReleaseRosterRow[];
  artists: Array<{ id: string; name: string }>;
  canMutate: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {releases.map((release) => {
        const status = statusStyle(release);
        const pct = readiness(release);
        const releaseForActions = release as Release;
        return (
          <article key={release.id} className="group">
            <a href={`/releases/${release.id}`} className="block">
              <CoverThumb release={release} size="gallery" />
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {release.catalog_number && <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground">{release.catalog_number}</span>}
                    <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{release.title}</h2>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {release.artist_name || "No artist"} · {release.format || "No format"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.className}`}>{status.label}</span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <Signal icon={<CalendarDays className="h-3.5 w-3.5" />} label={dateLabel(release.release_date)} />
                <span>{releaseTimingLabel(release.release_date)}</span>
              </div>

              <div className="mt-3 h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-neutral-900 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </a>

            <div className="mt-3 flex items-center justify-between gap-2">
              {release.missing_release_fields.length ? (
                <div className="min-w-0 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{nextAction(release)}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Delivery ready
                </div>
              )}
              {canMutate && <div className="flex shrink-0 gap-1.5 opacity-70 transition group-hover:opacity-100">
                <ReleaseEditButton release={releaseForActions} artists={artists} />
                <ReleaseDeleteButton release={releaseForActions} />
              </div>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReadOnlyNotice() {
  return <span className="text-sm text-muted-foreground">Read-only for fundraiser</span>;
}

function CoverThumb({ release, size = "list" }: { release: ReleaseRosterRow; size?: "list" | "gallery" }) {
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
      setSrc(isUsableRemoteImageUrl(release.cover_art_url) ? release.cover_art_url : null);
      return;
    }
    resolveFileUrl(release.cover_art_url, size === "gallery" ? 320 : 96)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [release.cover_art_url]);

  const sizeClass = size === "gallery" ? "aspect-square w-full" : "h-12 w-12";

  if (src && !failed) {
    return (
      <div className={`${sizeClass} overflow-hidden border border-border bg-neutral-900 shadow-[0_24px_55px_rgba(0,0,0,0.12)] transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_30px_70px_rgba(0,0,0,0.16)]`}>
        <img
          src={src}
          alt=""
          width={size === "gallery" ? 320 : 96}
          height={size === "gallery" ? 320 : 96}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={`grid ${sizeClass} shrink-0 place-items-center border border-border bg-[radial-gradient(circle_at_30%_20%,#525252,#111)] text-xl font-semibold text-white shadow-[0_24px_55px_rgba(0,0,0,0.12)]`}>
      {initials(release.title)}
    </div>
  );
}

function isUsableRemoteImageUrl(value: string | null | undefined): value is string {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    // Airtable attachment URLs expire; attempting to render stale imports creates noisy 410s.
    return !url.hostname.endsWith("airtableusercontent.com");
  } catch {
    return false;
  }
}

function Signal({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      {icon}
      <span>{label}</span>
    </div>
  );
}
