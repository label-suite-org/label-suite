import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Disc3, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveFileUrl } from "@/lib/storage-client";
import type { listCatalogTracks } from "../../server/catalog";
import type { listReleases } from "../../server/releases";

type Artist = { id: string; name: string; image_url: string | null };
type Release = Awaited<ReturnType<typeof listReleases>>[number];
type Track = Awaited<ReturnType<typeof listCatalogTracks>>[number];
type Props = {
  artists: Artist[]; releases: Release[]; tracks: Track[]; canMutate: boolean;
  selectedArtistId?: string | null; selectedReleaseId?: string | null; selectedTrackId?: string | null;
};

function href(kind: "artist" | "release" | "track", id: string) {
  return `/catalog?${kind}=${encodeURIComponent(id)}`;
}

export function CatalogBrowser({ artists, releases, tracks, canMutate, selectedArtistId, selectedReleaseId, selectedTrackId }: Props) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [showDesktopBrowser, setShowDesktopBrowser] = useState(true);
  const [showArtists, setShowArtists] = useState(false);
  const requested = Boolean(selectedArtistId || selectedReleaseId || selectedTrackId);
  const track = tracks.find(item => item.id === selectedTrackId);
  const release = releases.find(item => item.id === (track?.release_id ?? selectedReleaseId));
  const artist = artists.find(item => item.id === (release?.artist_id ?? selectedArtistId)) ?? (!requested ? artists[0] : undefined);
  const releaseTracks = tracks.filter(item => item.release_id === release?.id);
  const title = track?.title ?? release?.title ?? artist?.name;
  const artwork = release?.cover_art_url ?? artist?.image_url;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (values: Array<string | null | undefined>) => values.some(value => value?.toLocaleLowerCase().includes(needle));
  const artistReleases = (id: string) => releases.filter(item => item.artist_id === id);
  const artistReleaseCount = artist ? artistReleases(artist.id).length : 0;
  const unlinkedReleases = releases.filter(item => !artists.some(parent => parent.id === item.artist_id));
  const unlinkedTracks = tracks.filter(item => !releases.some(parent => parent.id === item.release_id));
  const trackEditor = release && `/releases/${encodeURIComponent(release.id)}/tracks${track ? `?track=${encodeURIComponent(track.id)}` : ""}`;
  const recordUrl = track ? trackEditor : release ? `/releases/${encodeURIComponent(release.id)}` : artist ? `/artists/${encodeURIComponent(artist.id)}` : null;
  const linkClass = "block min-h-11 rounded-md px-3 py-2.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring break-words";
  const selectedClass = "bg-accent text-accent-foreground font-medium";

  function releaseLink(item: Release) {
    const open = item.id === release?.id;
    return <li key={item.id}>
      <a href={href("release", item.id)} aria-current={open && !track ? "page" : undefined} className={`${linkClass} flex items-center gap-2 ${open && !track ? selectedClass : ""}`}>
        {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
        <Artwork source={item.cover_art_url} small /><span>{item.title}</span>
      </a>
      {open && <ul className="ml-5 border-l border-border pl-2" aria-label={`Tracks on ${item.title}`}>
        {releaseTracks.map(item => <li key={item.id}><a href={href("track", item.id)} aria-current={item.id === track?.id ? "page" : undefined} className={`${linkClass} ${item.id === track?.id ? selectedClass : ""}`}>
          <span className="mr-3 text-muted-foreground tabular-nums">{item.position ?? "—"}</span>{item.title}
        </a></li>)}
        {!releaseTracks.length && <li className="px-3 py-3 text-sm text-muted-foreground">No tracks yet.</li>}
      </ul>}
    </li>;
  }

  const searchInput = <div className="relative min-w-0 flex-1 basis-64">
    <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
    <Input aria-label="Search artists, releases and tracks" placeholder="Search artists, releases or tracks" value={query} onChange={event => { setQuery(event.target.value); setShowDesktopBrowser(true); }} className="h-10 pl-9" />
  </div>;
  const browserContent = <>        {needle ? <SearchResults artists={artists.filter(item => matches([item.name]))} releases={releases.filter(item => matches([item.title, item.artist_name, item.upc_ean]))} tracks={tracks.filter(item => matches([item.title, item.isrc, item.version]))} /> : <>
          {artists.length > 1 && <Button variant="ghost" size="sm" aria-expanded={showArtists} aria-controls="catalog-artist-list" onClick={() => setShowArtists(!showArtists)} className="mb-4 w-full justify-between text-muted-foreground">{showArtists ? "Hide other artists" : "Browse artists"}<ChevronDown className={`size-4 transition-transform ${showArtists ? "rotate-180" : ""}`} aria-hidden /></Button>}
          <ul id="catalog-artist-list" className="space-y-2">
            {artists.filter(item => showArtists || item.id === artist?.id).map(item => <li key={item.id}>
              <a href={href("artist", item.id)} aria-current={item.id === artist?.id && !release ? "page" : undefined} className={`${linkClass} flex items-center gap-2 ${item.id === artist?.id && !release ? selectedClass : ""}`}>
                {item.id === artist?.id ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}<Artwork source={item.image_url} small /><span>{item.name}</span>
              </a>
              {item.id === artist?.id && release && <ul className="ml-4" aria-label={`Releases by ${item.name}`}>
                {artistReleases(item.id).map(releaseLink)}
              </ul>}
            </li>)}
          </ul>
          {unlinkedReleases.length > 0 && <details open={Boolean(release && unlinkedReleases.includes(release))} className="mt-5"><summary className="cursor-pointer py-2 text-sm">Releases without an artist</summary><ul>{unlinkedReleases.map(releaseLink)}</ul></details>}
          {unlinkedTracks.length > 0 && <details open={Boolean(track && unlinkedTracks.includes(track))} className="mt-5"><summary className="cursor-pointer py-2 text-sm">Tracks without a release</summary><ul>{unlinkedTracks.map(item => <li key={item.id}><a className={linkClass} href={href("track", item.id)}>{item.title}</a></li>)}</ul></details>}
        </>}</>;

  return <div className="min-w-0">
    <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-border pb-5">
      <div className="hidden min-w-0 flex-1 md:block">{searchInput}</div>
      <Button variant="ghost" size="sm" className="hidden md:inline-flex" aria-expanded={showDesktopBrowser} aria-controls="catalog-objects" onClick={() => setShowDesktopBrowser(!showDesktopBrowser)}>{showDesktopBrowser ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}{showDesktopBrowser ? "Hide browser" : "Show browser"}</Button>
      <Sheet open={showBrowser && isMobile} onOpenChange={setShowBrowser}>
        <SheetTrigger render={<Button variant="outline" className="md:hidden" />}>Browse records</SheetTrigger>
        <SheetContent side="left" className="w-[min(90vw,24rem)] overflow-y-auto duration-300 motion-reduce:transition-none">
          <SheetHeader><SheetTitle>Browse records</SheetTitle><SheetDescription>Find an artist, release or track.</SheetDescription></SheetHeader>
          {isMobile && <div className="space-y-5 px-4 pb-6">{searchInput}<nav aria-label="Artists, releases and tracks">{browserContent}</nav></div>}
        </SheetContent>
      </Sheet>
    </div>
    <div className={`grid min-w-0 gap-7 transition-[grid-template-columns] duration-300 motion-reduce:transition-none ${showDesktopBrowser ? "md:grid-cols-[minmax(12rem,17rem)_minmax(0,1fr)]" : "md:grid-cols-[0_minmax(0,1fr)]"} lg:gap-10`}>
      {!isMobile && <nav id="catalog-objects" aria-label="Artists, releases and tracks" className={`hidden min-w-0 overflow-hidden md:block md:pr-5 ${showDesktopBrowser ? "md:visible md:border-r md:border-border" : "md:invisible md:pointer-events-none"}`}>
        {browserContent}
      </nav>}

      <section className="min-w-0" aria-label="Selected record">
        {title ? <>
          <nav aria-label="Record path" className="mb-7 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {artist && <a href={href("artist", artist.id)} className="hover:underline">{artist.name}</a>}
            {release && <><ChevronRight className="size-3" aria-hidden /><a href={href("release", release.id)} className="hover:underline">{release.title}</a></>}
            {track && <><ChevronRight className="size-3" aria-hidden /><span className="text-foreground">{track.title}</span></>}
          </nav>
          <div className="mb-8 flex flex-wrap items-start gap-4 sm:gap-6 lg:items-center">
            <Artwork key={artwork} source={artwork} />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-semibold tracking-tight md:text-3xl lg:text-4xl">{title}</h1>
              <p className="mt-3 text-muted-foreground">{track ? [artist?.name, release?.title, track.version].filter(Boolean).join(" · ") : release ? artist?.name ?? "Artist not linked" : `${artistReleaseCount} ${artistReleaseCount === 1 ? "release" : "releases"}`}</p>
              {track && <p className="mt-3 text-sm text-muted-foreground">{track.position ? `Track ${track.position} · ` : ""}{track.duration == null ? "Duration not entered" : `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, "0")}`} · {track.isrc ?? "ISRC not entered"}</p>}
              {recordUrl && <a href={recordUrl} className={`${buttonVariants({ variant: "outline" })} mt-5`}>{canMutate ? track ? "Edit track" : release ? "Open release" : "Open artist" : "View record"}</a>}
            </div>
          </div>
          {track?.audio_url && <div className="mb-8 max-w-xl"><Audio key={track.id} source={track.audio_url} title={track.title} /></div>}
          <Tabs defaultValue="overview" key={track?.id ?? release?.id ?? artist?.id}>
            <TabsList variant="line" aria-label="Record details" className="mb-6 max-w-full border-b border-border">
              <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="rights">Rights</TabsTrigger><TabsTrigger value="files">Files</TabsTrigger><TabsTrigger value="more">More</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-5">
              {track ? <><h2 className="sr-only">Track overview</h2><dl className="grid gap-5 sm:grid-cols-2"><Detail label="Readiness" value={track.track_ready == null ? "Not checked" : track.track_ready ? "Ready" : "Needs attention"} /><Detail label="Linked work" value={track.work_title ?? "No work linked"} />{track.track_missing && <Detail label="Missing information" value={track.track_missing} />}</dl></> : release ? <><h2 className="sr-only">Release overview</h2><dl className="grid gap-5 sm:grid-cols-2"><Detail label="Release date" value={release.release_date ?? "Not scheduled"} /><Detail label="Status" value={release.status ?? "Not entered"} /></dl>{!releaseTracks.length && canMutate && <a href={trackEditor!} className={`${buttonVariants({ variant: "outline" })} mt-7`}>Add tracks</a>}</> : <><h2 className="text-lg font-medium">Releases</h2><ul className="divide-y divide-border">{artistReleases(artist!.id).map(item => <li key={item.id}><a href={href("release", item.id)} className="flex flex-wrap justify-between gap-2 py-4 hover:underline"><span>{item.title}</span><span className="text-muted-foreground">{item.release_date ?? "Not scheduled"}</span></a></li>)}</ul></>}
            </TabsContent>
            <TabsContent value="rights" className="space-y-4"><h2 className="text-lg font-medium">Works & rights</h2><p className="text-muted-foreground">{track?.work_title ? `Linked work: ${track.work_title}` : "Review credits and ownership on the linked work or release."}</p>{track?.work_id ? <a className="underline underline-offset-4" href={`/works/${encodeURIComponent(track.work_id)}`}>Open work & rights</a> : release ? <a className="underline underline-offset-4" href={`/releases/${encodeURIComponent(release.id)}?section=tracks`}>Review release rights</a> : <p className="text-muted-foreground">Select a release or track to review its rights.</p>}</TabsContent>
            <TabsContent value="files" className="space-y-4"><h2 className="text-lg font-medium">Audio & files</h2><p className="text-muted-foreground">{track?.audio_url ? "Audio is linked to this track." : track ? "No audio linked yet." : "Open the record to review its artwork, documents and audio."}</p>{release ? <a className="underline underline-offset-4" href={`/releases/${encodeURIComponent(release.id)}?section=assets`}>Open release files</a> : artist && <a className="underline underline-offset-4" href={`/artists/${encodeURIComponent(artist.id)}`}>Open artist files</a>}</TabsContent>
            <TabsContent value="more" className="space-y-4"><h2 className="text-lg font-medium">Record tools</h2>{release && <dl className="mb-6 grid gap-5 sm:grid-cols-2"><Detail label="Format" value={release.format ?? "Not entered"} /><Detail label="UPC / EAN" value={release.upc_ean ?? "Not entered"} /></dl>}{release && <a className="block underline underline-offset-4" href={`/releases/${encodeURIComponent(release.id)}?section=timeline`}>Open release schedule</a>}{trackEditor && <a className="block underline underline-offset-4" href={trackEditor}>Open track editor</a>}<a className="block underline underline-offset-4" href="/catalog?view=numbering">Manage catalog numbers & editions</a>{track && !release && <a className="block underline underline-offset-4" href="/data-quality">Review the missing release link</a>}</TabsContent>
          </Tabs>
        </> : <div className="py-12"><h1 className="text-2xl font-semibold">{requested ? "Record unavailable" : "Start with an artist"}</h1><p className="mt-3 max-w-lg text-muted-foreground">{requested ? "Choose a record from your workspace to continue." : "Your artists, releases and tracks will appear together here."}</p>{canMutate && !requested && <a href="/artists" className={`${buttonVariants()} mt-5`}>Add your first artist</a>}</div>}
      </section>
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="mb-1 text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>;
}

function SearchResults({ artists, releases, tracks }: Pick<Props, "artists" | "releases" | "tracks">) {
  const groups = [{ label: "Artists", kind: "artist" as const, items: artists.map(item => ({ id: item.id, title: item.name })) }, { label: "Releases", kind: "release" as const, items: releases }, { label: "Tracks", kind: "track" as const, items: tracks }];
  return <div className="space-y-5" aria-live="polite">{!groups.some(group => group.items.length) && <p className="text-sm text-muted-foreground">No matching records. Try a name or identifier.</p>}{groups.filter(group => group.items.length).map(group => <section key={group.kind}><h2 className="mb-2 text-sm font-medium">{group.label}</h2><ul>{group.items.map(item => <li key={item.id}><a className="block min-h-11 rounded-md px-3 py-2.5 text-sm hover:bg-muted" href={href(group.kind, item.id)}>{item.title}</a></li>)}</ul></section>)}</div>;
}

function Artwork({ source, small = false }: { source?: string | null; small?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let active = true; if (source) resolveFileUrl(source, 320).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setUrl(null); }); return () => { active = false; }; }, [source]);
  return <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${small ? "size-8" : "size-20 sm:size-36 lg:size-48"}`}>{url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setUrl(null)} /> : <span className="flex flex-col items-center gap-2 text-xs text-foreground"><Disc3 className={small ? "size-4" : "size-9"} aria-hidden />{!small && (source ? "Artwork unavailable" : "No artwork yet")}</span>}</div>;
}

function Audio({ source, title }: { source: string | null; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; if (source) resolveFileUrl(source).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [source]);
  return <div className="w-full">{url && !failed ? <audio controls preload="none" aria-label={`Play ${title}`} src={url} className="w-full" onError={() => setFailed(true)} /> : <p className="text-sm text-muted-foreground">{!source ? "No audio linked yet." : failed ? "Audio preview unavailable. Open the track to review its audio link." : "Loading audio…"}</p>}</div>;
}
