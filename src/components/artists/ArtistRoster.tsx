"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Disc3,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { resolveFileUrl } from "../../lib/storage-client";
import type { ArtistRosterRow } from "../../server/artists";
import { buildArtistProfileReadiness, firstIncompleteArtistReadinessAction } from "./artist-readiness";
import { ArtistDeleteButton, ArtistEditButton } from "./ArtistActionButtons";
import { ArtistCreateDialog } from "./ArtistCreateDialog";
import type { Artist, ContactOption } from "./ArtistForm";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type FilterMode = "all" | "active" | "attention" | "quiet";
type RelationshipMode = "all" | "roster" | "collaborator" | "unclassified";
type SortMode = "name" | "followers" | "releases" | "attention";
type ViewMode = "gallery" | "ops";

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("en-US");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No upcoming date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function completeness(row: ArtistRosterRow): number {
  return buildArtistProfileReadiness(row).complete;
}

function missingProfileItems(row: ArtistRosterRow): string[] {
  return buildArtistProfileReadiness({
    bio: row.bio,
    hasPrimaryImage: Boolean(row.image_url),
    image_url: row.image_url,
    pro: row.pro,
    ipi: row.ipi,
    spotify_id: row.spotify_id,
    spotify_followers: row.spotify_followers,
    spotify_popularity: row.spotify_popularity,
    instagram: row.instagram,
    tiktok: row.tiktok,
  }).missing;
}

function attentionScore(row: ArtistRosterRow): number {
  const missing = missingProfileItems(row);
  return missing.length + (row.release_count === 0 ? 2 : 0) + (row.open_task_count > 0 ? 1 : 0);
}

function statusLabel(row: ArtistRosterRow): { label: string; className: string } {
  if (row.next_release_id) {
    return { label: "Upcoming", className: "border-emerald-200 bg-emerald-50/95 text-emerald-700" };
  }
  if (row.campaign_count || row.open_task_count) {
    return { label: "Active", className: "border-sky-200 bg-sky-50/95 text-sky-700" };
  }
  if (row.release_count) {
    return { label: "Catalog", className: "border-white/25 bg-black/45 text-white backdrop-blur-sm" };
  }
  return { label: "Needs setup", className: "border-amber-200 bg-amber-50/95 text-amber-800" };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
}

function linkedReleaseTitle(row: ArtistRosterRow): string {
  return row.next_release_title || row.latest_release_title || "No release linked";
}

function linkedReleaseHref(row: ArtistRosterRow): string | null {
  if (row.next_release_id) return `/releases/${row.next_release_id}`;
  if (row.latest_release_id) return `/releases/${row.latest_release_id}`;
  return null;
}

function coverArtLink(row: ArtistRosterRow): string | null {
  return row.image_url || row.next_release_cover_art_url || row.latest_release_cover_art_url || null;
}

function attentionLabel(row: ArtistRosterRow): string | null {
  if (row.release_count === 0) return "No catalog yet";
  const missing = missingProfileItems(row);
  if (missing.length > 0) return `${missing.length} profile gap${missing.length === 1 ? "" : "s"}`;
  return null;
}

function primaryReadinessHref(row: ArtistRosterRow): string {
  const action = firstIncompleteArtistReadinessAction({
    bio: row.bio,
    hasPrimaryImage: Boolean(row.image_url),
    image_url: row.image_url,
    pro: row.pro,
    ipi: row.ipi,
    spotify_id: row.spotify_id,
    spotify_followers: row.spotify_followers,
    spotify_popularity: row.spotify_popularity,
    instagram: row.instagram,
    tiktok: row.tiktok,
  });

  if (!action) return `/artists/${row.id}`;

  const params = new URLSearchParams();
  if (action.kind === "edit") {
    params.set("tab", "overview");
    params.set("focus", action.focusField);
  } else {
    params.set("tab", action.tab);
    params.set("destination", action.destination);
  }

  return `/artists/${row.id}?${params.toString()}`;
}

function gallerySummary(row: ArtistRosterRow): string {
  if (row.bio?.trim()) return row.bio;

  const missing = missingProfileItems(row);
  if (missing.length > 0) {
    const summary = missing.slice(0, 2).join(", ");
    return `Missing ${summary}${missing.length > 2 ? ` +${missing.length - 2}` : ""}`;
  }

  if (row.next_release_title) return `Next release: ${row.next_release_title}`;
  if (row.latest_release_title) return `Latest release: ${row.latest_release_title}`;
  return "No release linked.";
}

function artistRelationship(row: ArtistRosterRow): Exclude<RelationshipMode, "all"> {
  if (row.relationship === "roster" || row.relationship === "collaborator") {
    return row.relationship;
  }
  return "unclassified";
}

function relationshipLabel(row: ArtistRosterRow): { label: string; className: string; detail: string } {
  if (artistRelationship(row) === "roster") {
    return {
      label: "Roster",
      className: "border-cyan-200 bg-cyan-50/95 text-cyan-800",
      detail: "Signed to the label",
    };
  }

  if (artistRelationship(row) === "collaborator") {
    return {
      label: "Collaborator",
      className: "border-stone-200 bg-stone-50/95 text-stone-700",
      detail: "Project collaborator",
    };
  }

  return {
    label: "Unclassified",
    className: "border-amber-200 bg-amber-50/95 text-amber-800",
    detail: "Relationship not set",
  };
}

function relationshipEvidence(row: ArtistRosterRow): string {
  const source = row.airtable_record_id ? `Airtable mapping ${row.airtable_record_id}` : "no Airtable mapping";
  if (row.relationship) return `Label Suite current value · ${source}`;
  if (row.contact_id) return `Unclassified in Label Suite · linked contact${row.contact_name ? ` ${row.contact_name}` : ""} · ${source}`;
  return `Unclassified in Label Suite · no artist contact · ${source}`;
}

export function ArtistRoster({
  artists,
  contactOptions = [],
  canMutate = true,
}: {
  artists: ArtistRosterRow[];
  contactOptions?: ContactOption[];
  canMutate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [relationship, setRelationship] = useState<RelationshipMode>("all");
  const [sort, setSort] = useState<SortMode>("name");
  const [view, setView] = useState<ViewMode>("gallery");

  const stats = useMemo(() => {
    const roster = artists.filter((artist) => artistRelationship(artist) === "roster").length;
    const collaborators = artists.filter((artist) => artistRelationship(artist) === "collaborator").length;
    const unclassified = artists.filter((artist) => artistRelationship(artist) === "unclassified").length;
    const active = artists.filter((artist) => artist.next_release_id || artist.campaign_count || artist.open_task_count).length;
    const attention = artists.filter((artist) => missingProfileItems(artist).length || artist.release_count === 0).length;
    const releases = artists.reduce((sum, artist) => sum + artist.release_count, 0);
    const avgCompleteness = artists.length
      ? Math.round(artists.reduce((sum, artist) => sum + completeness(artist), 0) / artists.length)
      : 0;
    return { active, attention, collaborators, roster, unclassified, releases, avgCompleteness };
  }, [artists]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artists
      .filter((artist) => {
        if (!q) return true;
        return [
          artist.name,
          artist.pro,
          artist.next_release_title,
          artist.latest_release_title,
          artist.bio,
        ].some((value) => (value || "").toLowerCase().includes(q));
      })
      .filter((artist) => {
        if (relationship === "roster") return artistRelationship(artist) === "roster";
        if (relationship === "collaborator") return artistRelationship(artist) === "collaborator";
        if (relationship === "unclassified") return artistRelationship(artist) === "unclassified";
        return true;
      })
      .filter((artist) => {
        if (filter === "active") return Boolean(artist.next_release_id || artist.campaign_count || artist.open_task_count);
        if (filter === "attention") return missingProfileItems(artist).length > 0 || artist.release_count === 0;
        if (filter === "quiet") return !artist.next_release_id && !artist.campaign_count && !artist.open_task_count;
        return true;
      })
      .sort((a, b) => {
        if (sort === "followers") return (b.spotify_followers ?? -1) - (a.spotify_followers ?? -1);
        if (sort === "releases") return b.release_count - a.release_count || a.name.localeCompare(b.name);
        if (sort === "attention") return attentionScore(b) - attentionScore(a) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
  }, [artists, filter, query, relationship, sort]);

  const groupedVisible = useMemo(() => ({
    roster: visible.filter((artist) => artistRelationship(artist) === "roster"),
    collaborators: visible.filter((artist) => artistRelationship(artist) === "collaborator"),
    unclassified: visible.filter((artist) => artistRelationship(artist) === "unclassified"),
  }), [visible]);

  return (
    <div className="space-y-5">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <RosterStat label="Roster" value={artists.length.toString()} detail="artists in workspace" />
        <RosterStat label="Roster artists" value={stats.roster.toString()} detail="signed to the label" />
        <RosterStat label="Collaborators" value={stats.collaborators.toString()} detail="project contributors" />
        <RosterStat label="Unclassified" value={stats.unclassified.toString()} detail="needs a relationship" />
        <RosterStat label="Catalog" value={stats.releases.toString()} detail="linked releases" />
      </div>

      <div className="flex flex-col gap-3 border-y border-border py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search artists"
              placeholder="Search roster, PRO, release..."
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <NativeSelect
                value={relationship}
                onChange={(event) => setRelationship(event.target.value as RelationshipMode)}
                aria-label="Filter artists by relationship"
                className="bg-transparent text-foreground outline-none"
              >
                <option value="all">All relationships</option>
                <option value="roster">Roster artists</option>
                <option value="collaborator">Collaborators</option>
                <option value="unclassified">Unclassified</option>
              </NativeSelect>
            </label>
            <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
              <NativeSelect
                value={filter}
                onChange={(event) => setFilter(event.target.value as FilterMode)}
                aria-label="Filter artists by activity state"
                className="bg-transparent text-foreground outline-none"
              >
                <option value="all">All artists</option>
                <option value="active">Active work</option>
                <option value="attention">Needs attention</option>
                <option value="quiet">Quiet roster</option>
              </NativeSelect>
            </label>
            <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
              <ArrowUpDown className="h-4 w-4" />
              <NativeSelect
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                aria-label="Sort artists"
                className="bg-transparent text-foreground outline-none"
              >
                <option value="name">Name</option>
                <option value="followers">Followers</option>
                <option value="releases">Releases</option>
                <option value="attention">Attention</option>
              </NativeSelect>
            </label>
            {canMutate && <ArtistCreateDialog contactOptions={contactOptions} />}
          </div>
        </div>

        <div className="flex justify-end">
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1" role="group" aria-label="Artist roster view">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setView("gallery")}
              aria-pressed={view === "gallery"}
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                view === "gallery"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Gallery
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setView("ops")}
              aria-pressed={view === "ops"}
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                view === "ops"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-4 w-4" />
              Ops
            </Button>
          </div>
        </div>
      </div>

      {visible.length ? view === "gallery" ? (
        <div className="space-y-6">
          {groupedVisible.roster.length ? (
            <RosterGroup
              title="Roster artists"
              detail="Artists signed to the label and actively represented in the roster."
              artists={groupedVisible.roster}
            />
          ) : null}
          {groupedVisible.collaborators.length ? (
            <RosterGroup
              title="Collaborators"
              detail="Artists and contributors connected to releases, rights, sessions, or campaigns."
              artists={groupedVisible.collaborators}
            />
          ) : null}
          {groupedVisible.unclassified.length ? (
            <RosterGroup
              title="Unclassified artists"
              detail="Artist profiles that still need their roster relationship set."
              artists={groupedVisible.unclassified}
            />
          ) : null}
        </div>
      ) : (
        <ArtistOpsTable artists={visible} contactOptions={contactOptions} canMutate={canMutate} />
      ) : (
        <div className="rounded-lg border border-dashed border-border py-14 text-center">
          <p className="text-sm font-medium text-foreground">No artists match this view.</p>
          <p className="mt-1 text-sm text-muted-foreground">Adjust the search or roster filter.</p>
        </div>
      )}
    </div>
  );
}

function RosterGroup({
  title,
  detail,
  artists,
}: {
  title: string;
  detail: string;
  artists: ArtistRosterRow[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 border-b border-border pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">{artists.length}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {artists.map((artist) => (
          <ArtistGalleryCard key={artist.id} artist={artist} />
        ))}
      </div>
    </section>
  );
}

function ArtistGalleryCard({
  artist,
}: {
  artist: ArtistRosterRow;
}) {
  const status = statusLabel(artist);
  const relationship = relationshipLabel(artist);
  const health = completeness(artist);
  const releaseHref = linkedReleaseHref(artist);
  const attention = attentionLabel(artist);
  const summary = gallerySummary(artist);
  const openArtistHref = `/artists/${artist.id}`;
  const readinessHref = primaryReadinessHref(artist);

  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-background shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <a href={openArtistHref} className="block" aria-label={`Open ${artist.name} artist workspace`}>
        <div className="relative aspect-square overflow-hidden bg-neutral-950">
          <ArtistCoverArt artist={artist} size="hero" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.08)_0%,rgba(5,5,5,0.28)_38%,rgba(5,5,5,0.82)_100%)]" />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.label}</span>
            {attention ? (
              <span className="rounded-md border border-amber-200/70 bg-amber-50/95 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                {attention}
              </span>
            ) : (
              <span className="rounded-md border border-white/20 bg-black/35 px-2 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
                {health}% ready
              </span>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-normal text-white/70">
              {artist.image_url ? "Artist image" : artist.next_release_id ? "Upcoming release" : artist.latest_release_id ? "Latest release" : "Artist profile"}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-white">{artist.name}</h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-white/82">{linkedReleaseTitle(artist)}</p>
          </div>
        </div>
      </a>

      <div className="space-y-2 p-2.5 sm:p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${relationship.className}`}>{relationship.label}</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">Evidence: {relationshipEvidence(artist)}</p>

        <a href={readinessHref} className="line-clamp-2 block min-h-9 text-sm leading-snug text-muted-foreground hover:text-foreground hover:underline">
          {summary}
        </a>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <MetaPill icon={<Users className="h-3.5 w-3.5" />} label={formatNumber(artist.spotify_followers)} />
          <MetaPill icon={<Disc3 className="h-3.5 w-3.5" />} label={`${artist.release_count}`} />
          <MetaPill icon={<CalendarDays className="h-3.5 w-3.5" />} label={formatDate(artist.next_release_date)} />
          {artist.pro ? <MetaPill label={artist.pro} /> : null}
        </div>

        {releaseHref ? (
          <a href={releaseHref} className="block truncate text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
            {linkedReleaseTitle(artist)}
          </a>
        ) : (
          <p className="truncate text-xs text-muted-foreground">No release linked</p>
        )}
      </div>
    </article>
  );
}

function ArtistOpsTable({
  artists,
  contactOptions,
  canMutate,
}: {
  artists: ArtistRosterRow[];
  contactOptions: ContactOption[];
  canMutate: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[minmax(260px,1.35fr)_130px_90px_130px_170px_170px_120px] border-b border-border bg-muted/35 px-4 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
          <div>Artist</div>
          <div>Relationship</div>
          <div>PRO</div>
          <div>Audience</div>
          <div>Catalog</div>
          <div>Workflow</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="divide-y divide-border">
          {artists.map((artist) => {
            const status = statusLabel(artist);
            const relationship = relationshipLabel(artist);
            const health = completeness(artist);
            const artistForActions = artist as Artist;
            return (
              <div key={artist.id} className="grid grid-cols-[minmax(260px,1.35fr)_130px_90px_130px_170px_170px_120px] items-center gap-4 px-4 py-3 transition hover:bg-muted/25">
                <a href={`/artists/${artist.id}`} className="flex min-w-0 items-center gap-3">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-neutral-950">
                    <ArtistCoverArt artist={artist} size="thumb" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-foreground">{artist.name}</h2>
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {artist.bio || linkedReleaseTitle(artist)}
                    </p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      Contact: {artist.contact_name ?? "No artist contact"} · {relationshipEvidence(artist)}
                    </p>
                  </div>
                </a>

                <div>
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${relationship.className}`}>{relationship.label}</span>
                </div>

                <div className="text-sm text-foreground">{artist.pro || "-"}</div>

                <div>
                  <div className="text-sm font-medium text-foreground">{formatNumber(artist.spotify_followers)}</div>
                  <div className="text-xs text-muted-foreground">Popularity {artist.spotify_popularity ?? "-"}</div>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="inline-flex items-center gap-1.5 text-foreground">
                    <Disc3 className="h-4 w-4 text-muted-foreground" />
                    {artist.release_count} release{artist.release_count === 1 ? "" : "s"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {linkedReleaseHref(artist) ? (
                      <a href={linkedReleaseHref(artist)!} className="hover:underline">{linkedReleaseTitle(artist)}</a>
                    ) : (
                      "No release linked"
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="inline-flex items-center gap-1.5 text-foreground">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {formatDate(artist.next_release_date)}
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                  {artist.campaign_count ? <span>{artist.campaign_count} campaign{artist.campaign_count === 1 ? "" : "s"}</span> : null}
                  {artist.open_task_count ? <span>{artist.open_task_count} task{artist.open_task_count === 1 ? "" : "s"}</span> : null}
                  {!artist.campaign_count && !artist.open_task_count ? <span>No open workflow</span> : null}
                  </div>
                  {missingProfileItems(artist).length ? (
                    <div className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {missingProfileItems(artist).slice(0, 2).join(", ")}
                      {missingProfileItems(artist).length > 2 ? ` +${missingProfileItems(artist).length - 2}` : ""}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700">{health}% complete</div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  {canMutate && <ArtistEditButton artist={artistForActions} contactOptions={contactOptions} />}
                  {canMutate && <ArtistDeleteButton artist={artistForActions} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ArtistCoverArt({
  artist,
  size,
}: {
  artist: ArtistRosterRow;
  size: "hero" | "thumb";
}) {
  const artLink = coverArtLink(artist);
  const [src, setSrc] = useState<string | null>(/^https?:\/\//i.test(artLink || "") ? artLink : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (!artLink) {
      setSrc(null);
      return;
    }

    if (/^https?:\/\//i.test(artLink)) {
      setSrc(artLink);
      return;
    }

    setSrc(null);

    resolveFileUrl(artLink, size === "hero" ? 800 : 320)
      .then((resolved) => {
        if (!cancelled) setSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artLink]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`${artist.name} cover art`}
        width={size === "hero" ? 800 : 320}
        height={size === "hero" ? 800 : 320}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        loading={size === "hero" ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={size === "hero" ? "high" : "auto"}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-end bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_36%),linear-gradient(145deg,#262626_0%,#111111_45%,#050505_100%)] p-4">
      <div>
        <div className={`inline-flex items-center rounded-md border border-white/15 bg-white/8 px-2 py-0.5 font-semibold text-white/78 backdrop-blur-sm ${size === "hero" ? "text-xs" : "text-[11px]"}`}>
          {artist.release_count ? `${artist.release_count} release${artist.release_count === 1 ? "" : "s"}` : "Artist profile"}
        </div>
        <div className={`mt-3 font-semibold tracking-tight text-white ${size === "hero" ? "text-4xl" : "text-lg"}`}>
          {initials(artist.name)}
        </div>
      </div>
    </div>
  );
}

function MetaPill({
  icon,
  label,
}: {
  icon?: ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

function RosterStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
