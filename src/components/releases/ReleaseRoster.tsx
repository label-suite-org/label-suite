"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Search,
} from "lucide-react";
import { ReleaseDeleteButton, ReleaseEditButton } from "./ReleaseActionButtons";
import { ReleaseCreateDialog } from "./ReleaseCreateDialog";
import type { Release } from "./ReleaseForm";
import type { ReleaseRosterRow } from "../../server/releases";
import { resolveFileUrl } from "../../lib/storage-client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription } from "@/components/ui/item";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
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

function statusStyle(row: ReleaseRosterRow): { label: string; variant: React.ComponentProps<typeof Badge>["variant"] } {
  const status = normalizedStatus(row.status);
  if (row.release_ready) return { label: "Ready", variant: "success" };
  if (status === "released") return { label: "Released", variant: "secondary" };
  if (status === "scheduled") return { label: "Scheduled", variant: "secondary" };
  if (status === "in_production") return { label: "In Production", variant: "secondary" };
  if (row.missing_release_fields.length >= 4) return { label: "Setup", variant: "warning" };
  return { label: row.status || "Draft", variant: "secondary" };
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
      <section className="border-b border-border pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search releases"
              placeholder="Search the record catalog..."
              className="w-full pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={value => setFilter((value ?? "all") as FilterMode)} aria-label="Filter releases by status" className="max-sm:w-full" options={[{ value: "all", label: "All records" }, { value: "upcoming", label: "Upcoming" }, { value: "ready", label: "Ready" }, { value: "attention", label: "Needs care" }, { value: "released", label: "Released" }]} />
            <Select value={sort} onValueChange={value => setSort((value ?? "date") as SortMode)} aria-label="Sort releases" className="max-sm:w-full" options={[{ value: "date", label: "Release date" }, { value: "readiness", label: "Most urgent" }, { value: "budget", label: "Budget" }, { value: "title", label: "Title" }]} />
            {canMutate ? <ReleaseCreateDialog artists={artists} parentReleases={releases} /> : <ReadOnlyNotice />}
          </div>
        </div>
      </section>

      {visible.length ? (
        <ReleaseRows releases={visible} artists={artists} canMutate={canMutate} />
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-foreground">No releases match this catalog view.</p>
          <p className="mt-1 text-sm text-muted-foreground">Adjust search or filters to bring the records back.</p>
        </div>
      )}
    </div>
  );
}

function ReleaseRows({
  releases,
  artists,
  canMutate,
}: {
  releases: ReleaseRosterRow[];
  artists: Array<{ id: string; name: string }>;
  canMutate: boolean;
}) {
  return (
    <div className="divide-y divide-border">
      {releases.map((release) => {
        const status = statusStyle(release);
        return (
          <article key={release.id} className="py-3">
            <Item className="px-0 py-0">
              <ItemMedia><a href={`/releases/${release.id}`} aria-label={`Open ${release.title}`}><CoverThumb release={release} /></a></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle><a href={`/releases/${release.id}`} className="hover:underline">{release.title}</a></ItemTitle>
                <ItemDescription>{release.artist_name || "No artist"} · {release.format || "No format"}</ItemDescription>
              </ItemContent>
              <Badge variant={status.variant}>{status.label}</Badge>
              <span className="hidden text-xs text-muted-foreground sm:block">{dateLabel(release.release_date)}</span>
            </Item>
            <div className="mt-2 pl-[58px]">
              <a href={`/releases/${release.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
                {release.release_ready ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                {nextAction(release)}
              </a>
              <Accordion>
                <AccordionItem value="details">
                  <AccordionTrigger className="py-1.5">Details <span className="sr-only">for {release.title}</span></AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <Signal icon={<CalendarDays className="size-3.5" />} label={`${dateLabel(release.release_date)} · ${releaseTimingLabel(release.release_date)}`} />
                    <p className="text-xs text-muted-foreground">{readiness(release)}% metadata complete · {release.ready_track_count} of {release.track_count} tracks ready{release.catalog_number ? ` · ${release.catalog_number}` : ""}</p>
                    {canMutate && <div className="flex gap-2">
                      <ReleaseEditButton release={release as Release} artists={artists} parentReleases={releases} />
                      <ReleaseDeleteButton release={release as Release} />
                    </div>}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReadOnlyNotice() {
  return <span className="text-sm text-muted-foreground">Read-only for your role</span>;
}

function CoverThumb({ release }: { release: ReleaseRosterRow }) {
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
    resolveFileUrl(release.cover_art_url, 96)
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

  const sizeClass = "h-12 w-12";

  if (src && !failed) {
    return (
      <div className={`${sizeClass} overflow-hidden rounded-lg bg-muted`}>
        <img
          src={src}
          alt=""
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={`grid ${sizeClass} shrink-0 place-items-center rounded-lg bg-muted text-sm font-medium text-muted-foreground`}>
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
