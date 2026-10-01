"use client";

import { useEffect, useMemo, useState } from "react";
import {
  List,
  Search,
} from "lucide-react";
import { resolveFileUrl } from "../../lib/storage-client";
import type { ArtistRosterRow } from "../../server/artists";
import { buildArtistProfileReadiness, firstIncompleteArtistReadinessAction } from "./artist-readiness";
import { ArtistDeleteButton, ArtistEditButton } from "./ArtistActionButtons";
import { ArtistCreateDialog } from "./ArtistCreateDialog";
import type { Artist, ContactOption } from "./ArtistForm";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription } from "@/components/ui/item";
import { Button } from "@/components/ui/button";
type FilterMode = "all" | "active" | "attention" | "quiet";
type RelationshipMode = "all" | "roster" | "collaborator" | "unclassified";
type SortMode = "name" | "followers" | "releases" | "attention";
type ViewMode = "browse" | "ops";

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

function statusLabel(row: ArtistRosterRow): { label: string; variant: React.ComponentProps<typeof Badge>["variant"] } {
  if (row.next_release_id) {
    return { label: "Upcoming", variant: "secondary" };
  }
  if (row.campaign_count || row.open_task_count) {
    return { label: "Active", variant: "secondary" };
  }
  if (row.release_count) {
    return { label: "Catalog", variant: "secondary" };
  }
  return { label: "Needs setup", variant: "warning" };
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

function readinessSummary(row: ArtistRosterRow): string {
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

function relationshipLabel(row: ArtistRosterRow): { label: string; variant: React.ComponentProps<typeof Badge>["variant"]; detail: string } {
  if (artistRelationship(row) === "roster") {
    return {
      label: "Roster",
      variant: "secondary",
      detail: "Signed to the label",
    };
  }

  if (artistRelationship(row) === "collaborator") {
    return {
      label: "Collaborator",
      variant: "secondary",
      detail: "Project collaborator",
    };
  }

  return {
    label: "Unclassified",
    variant: "warning",
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
  const [view, setView] = useState<ViewMode>("browse");

  const stats = useMemo(() => {
    const roster = artists.filter((artist) => artistRelationship(artist) === "roster").length;
    const collaborators = artists.filter((artist) => artistRelationship(artist) === "collaborator").length;
    const unclassified = artists.filter((artist) => artistRelationship(artist) === "unclassified").length;
    const releases = artists.reduce((sum, artist) => sum + artist.release_count, 0);
    const avgCompleteness = artists.length
      ? Math.round(artists.reduce((sum, artist) => sum + completeness(artist), 0) / artists.length)
      : 0;
    return { collaborators, roster, unclassified, releases, avgCompleteness };
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
      {!canMutate && <p className="text-sm text-muted-foreground">Read-only for your role</p>}
      <Accordion>
        <AccordionItem value="summary">
          <AccordionTrigger headingLevel={2}>{visible.length} of {artists.length} profiles · workspace summary</AccordionTrigger>
          <AccordionContent>
            <dl className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
              <RosterStat label="Roster" value={stats.roster.toString()} detail="signed to the label" />
              <RosterStat label="Collaborators" value={stats.collaborators.toString()} detail="project contributors" />
              <RosterStat label="Unclassified" value={stats.unclassified.toString()} detail="relationship to confirm" />
              <RosterStat label="Linked releases" value={stats.releases.toString()} detail="across this workspace" />
              <RosterStat label="Profile readiness" value={`${stats.avgCompleteness}%`} detail="workspace average" />
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex flex-col gap-3 border-y border-border py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search artists"
              placeholder="Search roster, PRO, release..."
              className="w-full pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={relationship} onValueChange={value => setRelationship((value ?? "all") as RelationshipMode)} aria-label="Filter artists by relationship" className="max-sm:w-full" options={[{ value: "all", label: "All relationships" }, { value: "roster", label: "Roster artists" }, { value: "collaborator", label: "Collaborators" }, { value: "unclassified", label: "Unclassified" }]} />
            <Select value={filter} onValueChange={value => setFilter((value ?? "all") as FilterMode)} aria-label="Filter artists by activity state" className="max-sm:w-full" options={[{ value: "all", label: "All artists" }, { value: "active", label: "Active work" }, { value: "attention", label: "Needs attention" }, { value: "quiet", label: "Quiet roster" }]} />
            <Select value={sort} onValueChange={value => setSort((value ?? "name") as SortMode)} aria-label="Sort artists" className="max-sm:w-full" options={[{ value: "name", label: "Name" }, { value: "followers", label: "Followers" }, { value: "releases", label: "Releases" }, { value: "attention", label: "Attention" }]} />
            {canMutate && <ArtistCreateDialog contactOptions={contactOptions} />}
          </div>
        </div>

        <div className="flex justify-end">
          <div className="inline-flex gap-2" role="group" aria-label="Artist roster view">
            <Button
              type="button"
              variant={view === "browse" ? "secondary" : "ghost"}
              onClick={() => setView("browse")}
              aria-pressed={view === "browse"}
            >
              <List className="h-4 w-4" />
              Browse
            </Button>
            <Button
              type="button"
              variant={view === "ops" ? "secondary" : "ghost"}
              onClick={() => setView("ops")}
              aria-pressed={view === "ops"}
            >
              <List className="h-4 w-4" />
              Compare
            </Button>
          </div>
        </div>
      </div>

      {visible.length ? view === "browse" ? (
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
        <div className="py-12 text-center">
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
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="sr-only">{detail}</p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">{artists.length}</span>
      </div>
      <div className="divide-y divide-border">
        {artists.map((artist) => (
          <ArtistRosterLine key={artist.id} artist={artist} />
        ))}
      </div>
    </section>
  );
}

function ArtistRosterLine({
  artist,
}: {
  artist: ArtistRosterRow;
}) {
  const status = statusLabel(artist);
  const relationship = relationshipLabel(artist);
  const health = completeness(artist);
  const releaseHref = linkedReleaseHref(artist);
  const openArtistHref = `/artists/${artist.id}`;
  const readinessHref = primaryReadinessHref(artist);

  return (
    <article className="py-3">
      <Item className="px-0 py-0">
        <ItemMedia>
          <a href={openArtistHref} className="size-12 overflow-hidden rounded-lg" aria-label={`Open ${artist.name} artist workspace`}>
            <ArtistCoverArt artist={artist} size="thumb" />
          </a>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle><a href={openArtistHref} className="hover:underline">{artist.name}</a></ItemTitle>
          <ItemDescription>
            {releaseHref ? <a href={releaseHref}>{linkedReleaseTitle(artist)}</a> : "No release linked"}
          </ItemDescription>
        </ItemContent>
        <Badge variant={status.variant}>{status.label}</Badge>
      </Item>
      <div className="mt-2 pl-[58px]">
        <a href={readinessHref} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          {missingProfileItems(artist).length ? readinessSummary({ ...artist, bio: null }) : `${health}% ready`}
          {artist.release_count === 0 ? " · No catalog yet" : ""}
        </a>
        <Accordion>
          <AccordionItem value="details">
            <AccordionTrigger className="py-1.5">Details <span className="sr-only">for {artist.name}</span></AccordionTrigger>
            <AccordionContent className="space-y-3">
              <Badge variant={relationship.variant}>{relationship.label}</Badge>
              <p className="text-xs text-muted-foreground">Evidence: {relationshipEvidence(artist)}</p>
              {artist.bio ? <p className="text-sm text-muted-foreground">{artist.bio}</p> : null}
              <dl className="grid gap-3 sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Spotify followers</dt><dd>{formatNumber(artist.spotify_followers)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Catalog</dt><dd>{artist.release_count} releases</dd></div>
                <div><dt className="text-xs text-muted-foreground">Next release</dt><dd>{formatDate(artist.next_release_date)}</dd></div>
              </dl>
              {artist.pro ? <p className="text-xs text-muted-foreground">PRO · {artist.pro}</p> : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
    <Table className="min-w-[980px]">
      <TableHeader>
        <TableRow>
          <TableHead>Artist</TableHead><TableHead>Relationship</TableHead><TableHead>PRO</TableHead>
          <TableHead>Audience</TableHead><TableHead>Catalog</TableHead><TableHead>Workflow</TableHead><TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {artists.map(artist => {
          const status = statusLabel(artist);
          const relationship = relationshipLabel(artist);
          const missing = missingProfileItems(artist);
          return (
            <TableRow key={artist.id}>
              <TableCell className="max-w-80">
                <a href={`/artists/${artist.id}`} className="flex items-center gap-3">
                  <div className="size-11 shrink-0 overflow-hidden rounded-lg"><ArtistCoverArt artist={artist} size="thumb" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{artist.name}</span><Badge variant={status.variant}>{status.label}</Badge></div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{artist.bio || linkedReleaseTitle(artist)}</p>
                  </div>
                </a>
                <p className="mt-2 whitespace-normal text-xs text-muted-foreground">Contact: {artist.contact_name ?? "No artist contact"} · {relationshipEvidence(artist)}</p>
              </TableCell>
              <TableCell><Badge variant={relationship.variant}>{relationship.label}</Badge></TableCell>
              <TableCell>{artist.pro || "–"}</TableCell>
              <TableCell><p>{formatNumber(artist.spotify_followers)}</p><p className="text-xs text-muted-foreground">Popularity {artist.spotify_popularity ?? "–"}</p></TableCell>
              <TableCell>
                <p>{artist.release_count} release{artist.release_count === 1 ? "" : "s"}</p>
                {linkedReleaseHref(artist) ? <a href={linkedReleaseHref(artist)!} className="text-xs text-muted-foreground hover:underline">{linkedReleaseTitle(artist)}</a> : <p className="text-xs text-muted-foreground">No release linked</p>}
              </TableCell>
              <TableCell className="space-y-1">
                <p>{formatDate(artist.next_release_date)}</p>
                <p className="text-xs text-muted-foreground">{artist.campaign_count} campaigns · {artist.open_task_count} tasks</p>
                <a href={primaryReadinessHref(artist)} className="text-xs text-muted-foreground hover:underline">{missing.length ? `Missing ${missing.slice(0, 2).join(", ")}${missing.length > 2 ? ` +${missing.length - 2}` : ""}` : `${completeness(artist)}% complete`}</a>
              </TableCell>
              <TableCell>
                {canMutate && <div className="flex justify-end gap-2"><ArtistEditButton artist={artist as Artist} contactOptions={contactOptions} /><ArtistDeleteButton artist={artist as Artist} /></div>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
    <div className="grid h-full w-full place-items-center bg-muted text-sm font-medium text-muted-foreground">
      {initials(artist.name)}
    </div>
  );
}

function RosterStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-medium">{value}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
