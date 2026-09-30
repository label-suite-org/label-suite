"use client";

import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Upload,
  Users,
} from "lucide-react";
import { isImageAsset, resolveFileUrl, uploadFileToStorage } from "../../lib/storage-client";
import { ArtistDeleteButton, ArtistEditButton, ArtistEditDialog } from "./ArtistActionButtons";
import { buildArtistProfileReadiness, type ArtistReadinessState, type ReadinessDestination } from "./artist-readiness";
import type { Artist, ArtistFocusField, ContactOption } from "./ArtistForm";
import { normalizeReviewedRichText } from "../../lib/reviewed-rich-text";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { openExternalUrl } from "@/lib/external-url";
import { RichText } from "@/components/ui/rich-text";
interface ArtistDetail extends Artist {
  image_url?: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

interface ArtistRelease {
  id: string;
  title: string;
  release_date?: string | null;
  format?: string | null;
  status?: string | null;
  cover_art_url?: string | null;
  release_ready?: boolean | null;
}

interface ArtistAsset {
  id: string;
  asset_name: string;
  asset_type?: string | null;
  linked_artist_id?: string | null;
  linked_release_id?: string | null;
  version?: string | null;
  approval_status?: string | null;
  delivery_status?: string | null;
  file_link?: string | null;
  notes?: string | null;
  date_uploaded?: string | null;
  release_title?: string | null;
}

interface ArtistCampaign {
  id: string;
  campaign_name: string;
  campaign_type?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  owner?: string | null;
  goal?: string | null;
  budget_planned?: number | null;
  budget_actual?: number | null;
  linked_release_id?: string | null;
  release_title?: string | null;
}

interface ArtistDocument {
  id: string;
  name: string;
  doc_type?: string | null;
  status?: string | null;
  file_link?: string | null;
  notes?: string | null;
  release_id?: string | null;
  release_title?: string | null;
}

interface ArtistRight {
  id: string;
  role?: string | null;
  ownership_type?: string | null;
  scope?: string | null;
  percent_share?: number | null;
  clearance_status?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  work_id?: string | null;
  work_title?: string | null;
}

interface ArtistTask {
  id: string;
  task_name: string;
  status?: string | null;
  priority?: string | null;
  owner?: string | null;
  due_date?: string | null;
  next_action?: string | null;
  linked_release_id?: string | null;
  release_title?: string | null;
}

interface ArtistContact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  image_url?: string | null;
  role?: string | null;
  company?: string | null;
}

const ASSET_TYPES = [
  "press_photo",
  "cover_art",
  "social_asset",
  "video",
  "canvas",
  "logo",
  "one_sheet",
  "other",
];

type TabKey = "overview" | "visuals" | "releases" | "team" | "rights" | "campaigns" | "analytics";

type ReadinessDestinationTarget = {
  tab: TabKey;
  targetId: string | null;
};

const READINESS_DESTINATION_TARGETS: Record<ReadinessDestination, ReadinessDestinationTarget> = {
  "overview:bio": { tab: "overview", targetId: null },
  "overview:pro": { tab: "overview", targetId: null },
  "overview:ipi": { tab: "overview", targetId: null },
  "overview:spotify_id": { tab: "overview", targetId: null },
  "overview:instagram": { tab: "overview", targetId: null },
  "overview:tiktok": { tab: "overview", targetId: null },
  "tab:visuals": { tab: "visuals", targetId: "artist-image-uploader" },
  "tab:documents": { tab: "rights", targetId: "artist-documents-panel" },
  "tab:rights": { tab: "rights", targetId: "artist-rights-panel" },
};

export function readinessDestinationTarget(destination: ReadinessDestination): ReadinessDestinationTarget {
  return READINESS_DESTINATION_TARGETS[destination];
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "releases", label: "Releases" },
  { key: "team", label: "Team" },
  { key: "rights", label: "Rights" },
  { key: "campaigns", label: "Campaigns" },
  { key: "analytics", label: "Analytics" },
  { key: "visuals", label: "Images" },
];

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("en-US");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalizeStatus(value?: string | null): string {
  return (value || "draft").replace(/_/g, " ");
}

function relationshipMeta(relationship?: Artist["relationship"]): { label: string; className: string; detail: string } {
  if (relationship === "roster") {
    return {
      label: "Roster",
      className: "border-cyan-200 bg-cyan-50 text-cyan-800",
      detail: "Signed to the label",
    };
  }

  if (relationship === "collaborator") {
    return {
      label: "Collaborator",
      className: "border-stone-200 bg-stone-50 text-stone-700",
      detail: "Project collaborator",
    };
  }

  return {
    label: "Unclassified",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    detail: "Relationship not set",
  };
}

function isImageLike(asset: ArtistAsset): boolean {
  return isImageAsset(asset.asset_type, asset.file_link);
}

function bestHeroAsset(assets: ArtistAsset[]): ArtistAsset | null {
  return assets.find((asset) => asset.asset_type === "press_photo" && isImageLike(asset))
    || assets.find((asset) => isImageLike(asset))
    || null;
}

function primaryVisualLink(artist: ArtistDetail, assets: ArtistAsset[]): string | null {
  return artist.image_url || bestHeroAsset(assets)?.file_link || null;
}

async function setPrimaryArtistImage(artistId: string, imageUrl: string) {
  const res = await fetch("/api/artists", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: artistId, image_url: imageUrl }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not set primary artist image");
  }
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ArtistWorkspace({
  artist,
  releases,
  assets,
  campaigns,
  documents,
  rights,
  tasks,
  primaryContact,
  contactOptions = [],
  canMutate = true,
  initialTab,
  initialFocusField,
  initialReadinessDestination,
  children,
}: {
  children?: ReactNode;
  artist: ArtistDetail;
  releases: ArtistRelease[];
  assets: ArtistAsset[];
  campaigns: ArtistCampaign[];
  documents: ArtistDocument[];
  rights: ArtistRight[];
  tasks: ArtistTask[];
  primaryContact: ArtistContact | null;
  contactOptions?: ContactOption[];
  canMutate?: boolean;
  initialTab?: TabKey;
  initialFocusField?: ArtistFocusField | null;
  initialReadinessDestination?: ReadinessDestination | null;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => (
    initialTab
    || (initialReadinessDestination ? readinessDestinationTarget(initialReadinessDestination).tab : "overview")
  ));
  const [pendingDestination, setPendingDestination] = useState<ReadinessDestination | null>(initialReadinessDestination ?? null);
  const [routeEditOpen, setRouteEditOpen] = useState(Boolean(canMutate && initialFocusField));
  const heroImageLink = primaryVisualLink(artist, assets);
  const hasPrimaryImage = Boolean(artist.image_url);
  const health = buildArtistProfileReadiness({
    bio: artist.bio,
    hasPrimaryImage: hasPrimaryImage,
    image_url: artist.image_url,
    imageAssetCount: assets.filter(isImageLike).length,
    documentsCount: documents.length,
    rightsCount: rights.length,
    pro: artist.pro,
    ipi: artist.ipi,
    spotify_id: artist.spotify_id,
    spotify_followers: artist.spotify_followers,
    spotify_popularity: artist.spotify_popularity,
    instagram: artist.instagram,
    tiktok: artist.tiktok,
  });
  const relationship = relationshipMeta(artist.relationship);

  useEffect(() => {
    if (!pendingDestination) return;
    const target = readinessDestinationTarget(pendingDestination);
    if (activeTab !== target.tab) return;

    const timeout = window.setTimeout(() => {
      if (!target.targetId) {
        setPendingDestination(null);
        return;
      }

      const element = document.getElementById(target.targetId);
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        element.focus();
      }
      setPendingDestination(null);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeTab, pendingDestination]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!initialFocusField && !initialReadinessDestination) return;

    // SAFETY: a malformed location must not break the readiness-route cleanup.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      url.searchParams.delete("destination");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore — nothing to clean up when the location cannot be parsed */
    }
  }, [initialFocusField, initialReadinessDestination]);

  function jumpToImageUploader() {
    openReadinessDestination("tab:visuals");
  }

  function openReadinessDestination(destination: ReadinessDestination) {
    const target = readinessDestinationTarget(destination);
    setPendingDestination(destination);
    setActiveTab(target.tab);
  }

  return (
    <div className="space-y-6">
      {canMutate && initialFocusField ? (
        <ArtistEditDialog
          artist={artist}
          focusField={initialFocusField}
          contactOptions={contactOptions}
          open={routeEditOpen}
          onOpenChange={setRouteEditOpen}
        />
      ) : null}
      {!canMutate && <p className="text-sm text-muted-foreground">Read-only for your role</p>}
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-5">
        <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-24">
          <ArtistHeroImage artist={artist} imageLink={heroImageLink} />
        </div>
        <div className="min-w-0 flex-1 basis-44">
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{artist.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{relationship.detail}</p>
          <p className="mt-1 text-sm text-muted-foreground">{releases.length} {releases.length === 1 ? "release" : "releases"} · {health.complete}% profile complete</p>
        </div>
        {canMutate && <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={jumpToImageUploader}><ImageIcon aria-hidden />{hasPrimaryImage ? "Manage images" : "Add artist image"}</Button>
          <ArtistEditButton artist={artist} contactOptions={contactOptions} />
          <a href={`/artists/${encodeURIComponent(artist.id)}/portal`} className={buttonVariants({ variant: "ghost" })}>Artist archive & form</a>
          <ArtistDeleteButton artist={artist} />
        </div>}
      </header>
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as TabKey)} className="gap-5 min-w-0">
        <div className="overflow-x-auto border-b border-border">
          <TabsList variant="line" aria-label="Artist sections" className="h-11">
            {TABS.map(tab => <TabsTrigger key={tab.key} value={tab.key} className="px-3">{tab.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value={activeTab}>
          {activeTab === "overview" && (
            <OverviewTab
              artist={artist}
              releases={releases}
              tasks={tasks}
              canMutate={canMutate}
              onReadinessAction={openReadinessDestination}
              health={health}
              onShowReleases={() => setActiveTab("releases")}
            />
          )}
          {activeTab === "visuals" && (
            <ImagesTab artist={artist} releases={releases} assets={assets} canMutate={canMutate} />
          )}
          {activeTab === "releases" && <ReleaseSection releases={releases} />}
          {activeTab === "team" && <TeamTab primaryContact={primaryContact} rights={rights} />}
          {activeTab === "rights" && <RightsTab rights={rights} documents={documents} />}
          {activeTab === "campaigns" && <CampaignsTab campaigns={campaigns} tasks={tasks} />}
          {activeTab === "analytics" && <><AnalyticsTab artist={artist} releases={releases} campaigns={campaigns} />{children}</>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ artist, releases, tasks, canMutate, onReadinessAction, health, onShowReleases }: {
  artist: ArtistDetail;
  releases: ArtistRelease[];
  tasks: ArtistTask[];
  canMutate: boolean;
  onReadinessAction: (destination: ReadinessDestination) => void;
  health: ArtistReadinessState;
  onShowReleases: () => void;
}) {
  const openTasks = tasks.filter(task => !["done", "complete", "completed", "cancelled"].includes((task.status || "").toLowerCase()));
  const bioDisplay = normalizeReviewedRichText(artist.bio_document, artist.bio, {
    reviewStatus: artist.bio_review_status === "reviewed" ? "reviewed" : "draft",
    reviewedHash: artist.bio_reviewed_hash ?? null,
  });
  return <div className="space-y-7">
    <ReleaseSection releases={releases} onShowAll={onShowReleases} />
    {openTasks.length > 0 && <TaskList tasks={openTasks} />}
    <Accordion>
      <AccordionItem value="profile" className="border-y border-border">
        <AccordionTrigger>Profile details and checks <span className="ml-auto mr-3 text-muted-foreground">{health.missing.length ? `${health.missing.length} missing` : "Complete"}</span></AccordionTrigger>
        <AccordionContent className="space-y-5 pt-3">
          <section className="max-w-prose">
            <h2 className="mb-2 font-medium">Biography <span className="ml-2 text-xs text-muted-foreground" data-testid="artist-bio-state">{bioDisplay.state}</span></h2>
            {bioDisplay.state === "missing" ? <p className="text-muted-foreground">No bio has been added yet.</p> : <RichText data-testid="artist-bio-rendered" html={bioDisplay.html} className="min-w-0 break-words text-sm leading-6 text-muted-foreground [&_a]:break-all [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" />}
          </section>
          <ReadinessCard artist={artist} canMutate={canMutate} health={health} onReadinessAction={onReadinessAction} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>;
}

function ImagesTab({ artist, releases, assets, canMutate }: { artist: ArtistDetail; releases: ArtistRelease[]; assets: ArtistAsset[]; canMutate: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <fieldset disabled={!canMutate}><ArtistAssetGallery artist={artist} assets={assets} /></fieldset>
      {canMutate ? <ArtistAssetUploader artist={artist} releases={releases} /> : <p className="text-sm text-muted-foreground">Image uploads are read-only.</p>}
    </div>
  );
}

function ReleaseSection({ releases, onShowAll }: { releases: ArtistRelease[]; onShowAll?: () => void }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Releases</h2>
        {onShowAll && releases.length > 4 ? <Button variant="ghost" onClick={onShowAll}>View all {releases.length} releases</Button> : <span className="text-sm text-muted-foreground">{releases.length}</span>}
      </div>
      <ReleaseGrid releases={onShowAll ? releases.slice(0, 4) : releases} />
    </section>
  );
}

function TeamTab({ primaryContact, rights }: { primaryContact: ArtistContact | null; rights: ArtistRight[] }) {
  const contributors = uniqueBy(
    rights
      .filter((right) => right.contact_id && right.contact_name)
      .map((right) => ({
        id: right.contact_id!,
        name: right.contact_name!,
        role: right.role || right.ownership_type || "Contributor",
        detail: [right.scope, right.work_title].filter(Boolean).join(" - "),
      })),
    (item) => item.id,
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Primary contact</h2>
        <p className="text-sm text-muted-foreground">Who to contact about the artist. Collaborators below come from linked work credits.</p>
        {primaryContact ? (
          <div className="mt-3 space-y-2">
            <p className="font-medium">{primaryContact.name}</p>
            <p className="text-sm text-muted-foreground">{[primaryContact.role, primaryContact.company].filter(Boolean).join(" - ") || "No role set"}</p>
            {primaryContact.email ? <a className="block text-sm text-muted-foreground hover:text-foreground hover:underline" href={`mailto:${primaryContact.email}`}>{primaryContact.email}</a> : null}
            {primaryContact.phone ? <p className="text-sm text-muted-foreground">{primaryContact.phone}</p> : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No primary contact linked to this artist yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Contributors</h2>
          <span className="text-sm text-muted-foreground">{contributors.length}</span>
        </div>
        <SimpleList
          emptyTitle="No contributors linked yet."
          rows={contributors.map((item) => ({
            id: item.id,
            title: item.name,
            meta: item.role,
            detail: item.detail || "No work scope linked",
          }))}
        />
      </section>
    </div>
  );
}

function RightsTab({ rights, documents }: { rights: ArtistRight[]; documents: ArtistDocument[] }) {
  const works = new Map<string, ArtistRight[]>();
  for (const right of rights) {
    const key = right.work_id || right.work_title || "unlinked";
    const rows = works.get(key) ?? [];
    rows.push(right);
    works.set(key, rows);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section id="artist-rights-panel" tabIndex={-1} className="space-y-3 scroll-mt-24">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Rights and credits</h2>
          <span className="text-sm text-muted-foreground">{rights.length}</span>
        </div>
        {!rights.length ? <p className="py-4 text-sm text-muted-foreground">No rights rows found for this artist catalog.</p> : (
          <Accordion>
            {Array.from(works, ([key, rows]) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>
                  {rows[0].work_title || "Untitled work"}
                  <span className="ml-auto mr-3 text-muted-foreground">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
                </AccordionTrigger>
                <AccordionContent>
                  {rows[0].work_id ? <a href={`/works/${encodeURIComponent(rows[0].work_id)}`} className="text-primary">Open work and edit rights</a> : null}
                  <SimpleList emptyTitle="No rights entries." rows={rows.map(right => ({
                    id: right.id,
                    title: right.contact_name || "No contact",
                    meta: [right.role, right.ownership_type, right.scope].filter(Boolean).join(" - ") || "Rights row",
                    detail: `${right.percent_share == null ? "Share not recorded" : `${right.percent_share}%`}${right.clearance_status ? ` - ${right.clearance_status}` : ""}`,
                  }))} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </section>

      <DocumentList documents={documents} />
    </div>
  );
}

function CampaignsTab({ campaigns, tasks }: { campaigns: ArtistCampaign[]; tasks: ArtistTask[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Campaigns</h2>
          <span className="text-sm text-muted-foreground">{campaigns.length}</span>
        </div>
        <SimpleList
          emptyTitle="No campaigns linked yet."
          rows={campaigns.map((campaign) => ({
            id: campaign.id,
            title: campaign.campaign_name,
            href: campaign.linked_release_id ? `/campaigns/${campaign.id}` : `/campaigns/${campaign.id}`,
            meta: [campaign.campaign_type, campaign.status].filter(Boolean).join(" - ") || "Campaign",
            detail: [campaign.release_title, campaign.owner, campaign.goal].filter(Boolean).join(" - ") || "No campaign detail",
          }))}
        />
      </section>

      <TaskList tasks={tasks} />
    </div>
  );
}

function AnalyticsTab({ artist, releases, campaigns }: { artist: ArtistDetail; releases: ArtistRelease[]; campaigns: ArtistCampaign[] }) {
  const readyReleases = releases.filter((release) => release.release_ready).length;
  const activeCampaigns = campaigns.filter((campaign) => !["done", "complete", "completed", "archived"].includes((campaign.status || "").toLowerCase())).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Spotify followers" value={formatNumber(artist.spotify_followers)} detail={`Popularity ${artist.spotify_popularity ?? "Not available"}`} icon={<Users className="h-4 w-4" />} />
        <Metric label="Release readiness" value={`${readyReleases}/${releases.length}`} detail="ready releases" icon={<CheckCircle2 className="h-4 w-4" />} />
        <Metric label="Active campaigns" value={String(activeCampaigns)} detail="marketing context" icon={<Briefcase className="h-4 w-4" />} />
      </div>
      <p className="text-sm text-muted-foreground">Spotify metrics are read-only stored values. They do not affect profile completion. <a href="/integrations" className="text-primary underline underline-offset-4">Review data connections</a> for provider updates.</p>
    </div>
  );
}

function ArtistHeroImage({ artist, imageLink }: { artist: ArtistDetail; imageLink: string | null }) {
  const [url, setUrl] = useResolvedImage(imageLink, 800);

  if (url) {
    return <img src={url} alt={`${artist.name} press image`} width={800} height={800} loading="eager" decoding="async" fetchPriority="high" className="aspect-square h-full w-full object-cover" onError={() => setUrl(null)} />;
  }

  return (
    <div className="grid aspect-square h-full w-full place-items-center bg-muted text-2xl font-medium text-muted-foreground" aria-label="No artist image">
      {initials(artist.name)}
    </div>
  );
}

function ReleaseGrid({ releases }: { releases: ArtistRelease[] }) {
  if (!releases.length) {
    return (
      <div className="py-6">
        <p className="text-sm font-medium text-foreground">No releases linked yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">Create or link a release to start building the catalog view.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {releases.map((release) => (
        <a key={release.id} href={`/releases/${release.id}`} className="group block rounded-md py-4 transition hover:bg-muted/25">
          <div className="flex items-start gap-3">
            <ReleaseCover release={release} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="break-words text-sm font-semibold text-foreground">{release.title}</h3>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${release.release_ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                  {release.release_ready ? "Ready" : "Needs work"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{release.format || "No format"} - {formatDate(release.release_date)}</p>
              <p className="mt-2 text-xs capitalize text-muted-foreground">{normalizeStatus(release.status)}</p>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function ReleaseCover({ release }: { release: ArtistRelease }) {
  const [url, setUrl] = useResolvedImage(release.cover_art_url || null, 96);

  if (url) {
    return <img src={url} alt={`${release.title} cover art`} width={96} height={96} loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-md object-cover" onError={() => setUrl(null)} />;
  }

  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
      {initials(release.title)}
    </div>
  );
}

function ArtistAssetUploader({ artist, releases }: { artist: ArtistDetail; releases: ArtistRelease[] }) {
  const [assetName, setAssetName] = useState("");
  const [assetType, setAssetType] = useState("press_photo");
  const [releaseId, setReleaseId] = useState("");
  const [manualLink, setManualLink] = useState("");
  const [useAsPrimary, setUseAsPrimary] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      let fileLink = manualLink.trim() || null;
      if (file) {
        const uploaded = await uploadFileToStorage(file, `artists/${artist.id}/assets`);
        fileLink = uploaded.key;
      }
      if (!fileLink) {
        throw new Error("Choose an image file or paste an image URL/storage key first.");
      }

      const res = await fetch("/api/media-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_name: assetName.trim() || file?.name || `${artist.name} ${assetType.replace(/_/g, " ")}`,
          asset_type: assetType,
          linked_artist_id: artist.id,
          linked_release_id: releaseId || null,
          approval_status: "pending",
          delivery_status: "not_sent",
          file_link: fileLink,
          date_uploaded: new Date().toISOString().slice(0, 10),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not add artist asset");
      }

      if (useAsPrimary && fileLink) {
        await setPrimaryArtistImage(artist.id, fileLink);
      }

      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Could not add artist asset");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="artist-image-uploader" tabIndex={-1} className="scroll-mt-24 min-w-0 space-y-4">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Change artist image</h2>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          Upload a press photo or paste an image link. Leave "Use as primary artist image" checked to update the artist photo.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            placeholder={`${artist.name} press photo`}
            className="w-full"
          />
        </label>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Type</span>
            <Select aria-label="Asset type" value={assetType} onValueChange={value => setAssetType(value ?? "press_photo")} className="w-full min-w-0" options={ASSET_TYPES.map(type => ({ value: type, label: type.replace(/_/g, " ") }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Release</span>
            <Select aria-label="Asset release" placeholder="Artist profile only" value={releaseId} onValueChange={value => setReleaseId(value ?? "")} className="w-full min-w-0" options={[
              { value: "", label: "Artist profile only" }, ...releases.map(release => ({ value: release.id, label: release.title })),
            ]} />
          </label>
        </div>
        <label className="flex min-h-20 cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-3 py-2 text-center text-sm text-muted-foreground transition hover:bg-muted/30">
          <Input type="file" accept="image/*,video/*,.pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          {file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : "Click to upload the artist image"}
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Or paste image URL/storage key</span>
          <Input
            value={manualLink}
            onChange={(event) => setManualLink(event.target.value)}
            placeholder="https://... or artists/.../photo.jpg"
            className="w-full"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Input
            type="checkbox"
            checked={useAsPrimary}
            onChange={(event) => setUseAsPrimary(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Use as primary artist image
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button
          type="submit"
          disabled={loading}
          className="w-full"
        >
          {loading ? "Saving image..." : useAsPrimary ? "Save artist image" : "Add to image library"}
        </Button>
      </form>
    </section>
  );
}

function ArtistAssetGallery({ artist, assets }: { artist: ArtistDetail; assets: ArtistAsset[] }) {
  if (!assets.length) {
    return (
      <section className="py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No artist images yet.</p>
        <p className="mt-1">Add a press photo first; it becomes the artist image on this page.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Visual kit</h2>
        <span className="text-sm text-muted-foreground">{assets.length}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {assets.map((asset) => (
          <ArtistAssetRow key={asset.id} artist={artist} asset={asset} />
        ))}
      </div>
    </section>
  );
}

function ArtistAssetRow({ artist, asset }: { artist: ArtistDetail; asset: ArtistAsset }) {
  const [settingPrimary, setSettingPrimary] = useState(false);

  async function openAsset() {
    if (!asset.file_link) return;
    const url = await resolveFileUrl(asset.file_link);
    openExternalUrl(url);
  }

  async function makePrimary() {
    if (!asset.file_link) return;
    setSettingPrimary(true);
    try {
      await setPrimaryArtistImage(artist.id, asset.file_link);
      window.location.reload();
    } catch (err: any) {
      alert(err.message || "Could not set primary image");
      setSettingPrimary(false);
    }
  }

  const isPrimary = Boolean(asset.file_link && artist.image_url === asset.file_link);

  return (
    <div className="py-4">
      <div className="flex gap-3">
        <AssetThumb asset={asset} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-foreground">{asset.asset_name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {[asset.asset_type?.replace(/_/g, " "), asset.release_title, asset.version].filter(Boolean).join(" - ") || "Artist asset"}
              </p>
            </div>
            {asset.file_link ? (
              <Button variant="outline" type="button" onClick={openAsset} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Open ${asset.asset_name}`}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusPill value={asset.approval_status || "pending"} />
            <StatusPill value={asset.delivery_status || "not_sent"} />
            {isPrimary ? <StatusPill value="primary_image" /> : null}
          </div>
          {asset.file_link && isImageLike(asset) && !isPrimary ? (
            <Button variant="outline"
              type="button"
              onClick={makePrimary}
              disabled={settingPrimary}
              className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {settingPrimary ? "Setting..." : "Set primary image"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReadinessCard({
  artist,
  canMutate,
  health,
  onReadinessAction,
}: {
  artist: ArtistDetail;
  canMutate: boolean;
  health: ArtistReadinessState;
  onReadinessAction: (destination: ReadinessDestination) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Profile readiness</h2>
        <span className="text-sm font-medium">{health.complete}%</span>
      </div>
      <div className="mt-3 space-y-2">
        {health.rows.map((row) => {
          if (row.ok) {
            return (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <span>Complete</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                </span>
              </div>
            );
          }

          if (!canMutate || !row.action) {
            return (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <span>Missing</span>
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                </span>
              </div>
            );
          }

          if (row.action.kind === "edit") {
            return (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <ArtistEditButton
                  artist={artist}
                  focusField={row.action.focusField}
                  label={`Edit ${row.label}`}
                  variant="secondary"
                />
              </div>
            );
          }

          const action = row.action;
          const actionLabel =
            action.destination === "tab:visuals"
              ? "Open images"
              : action.destination === "tab:documents"
                ? "Open documents"
                : action.destination === "tab:rights"
                  ? "Open rights"
                  : `Fix ${row.label.toLowerCase()}`;

          return (
            <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <Button
                variant="outline"
                type="button"
                onClick={() => onReadinessAction(action.destination)}
                className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {actionLabel}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskList({ tasks }: { tasks: ArtistTask[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Tasks</h2>
        <span className="text-sm text-muted-foreground">{tasks.length}</span>
      </div>
      <SimpleList
        emptyTitle="No tasks linked right now."
        rows={tasks.map((task) => ({
          id: task.id,
          title: task.task_name,
          meta: [task.priority, task.status, task.due_date ? formatDate(task.due_date) : null].filter(Boolean).join(" - "),
          detail: [task.release_title, task.next_action, task.owner].filter(Boolean).join(" - ") || "No next action",
        }))}
      />
    </section>
  );
}

function DocumentList({ documents }: { documents: ArtistDocument[] }) {
  return (
    <section id="artist-documents-panel" tabIndex={-1} className="space-y-3 scroll-mt-24">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Documents</h2>
        <span className="text-sm text-muted-foreground">{documents.length}</span>
      </div>
      <SimpleList
        emptyTitle="No artist documents linked yet."
        rows={documents.map((doc) => ({
          id: doc.id,
          title: doc.name,
          meta: [doc.doc_type, doc.status].filter(Boolean).join(" - ") || "Document",
          detail: [doc.release_title, doc.notes].filter(Boolean).join(" - ") || "No document detail",
          href: doc.file_link ? undefined : undefined,
          icon: <FileText className="h-4 w-4" />,
        }))}
      />
    </section>
  );
}

function SimpleList({
  rows,
  emptyTitle,
}: {
  rows: Array<{ id: string; title: string; meta?: string | null; detail?: string | null; href?: string; icon?: ReactNode }>;
  emptyTitle: string;
}) {
  if (!rows.length) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        {emptyTitle}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {rows.map((row) => {
        const content = (
          <div className="flex items-start gap-3 py-4 transition hover:bg-muted/20">
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              {row.icon || <ListChecks className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-foreground">{row.title}</p>
              {row.meta ? <p className="mt-1 text-xs text-muted-foreground">{row.meta}</p> : null}
              {row.detail ? <p className="mt-1 break-words text-sm text-muted-foreground">{row.detail}</p> : null}
            </div>
          </div>
        );
        return row.href ? <a key={row.id} className="block" href={row.href}>{content}</a> : <div key={row.id}>{content}</div>;
      })}
    </div>
  );
}

function AssetThumb({ asset }: { asset: ArtistAsset }) {
  const [url, setUrl] = useResolvedImage(isImageLike(asset) ? asset.file_link || null : null, 96);

  if (url) {
    return <img src={url} alt={asset.asset_name} width={96} height={96} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-md object-cover" onError={() => setUrl(null)} />;
  }

  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
      <ImageIcon className="h-5 w-5" />
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone = value === "approved" || value === "delivered"
    ? "bg-emerald-50 text-emerald-700"
    : value === "changes_requested" || value === "queued"
      ? "bg-amber-50 text-amber-800"
      : value === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-muted text-muted-foreground";

  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>{value.replace(/_/g, " ")}</span>;
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function useResolvedImage(fileLink: string | null, imageWidth: 96 | 320 | 800): [string | null, (value: string | null) => void] {
  // Mount images after hydration so load failures reach the fallback handler.
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!fileLink) {
      setUrl(null);
      return;
    }

    if (/^https?:\/\//i.test(fileLink)) {
      setUrl(fileLink);
      return;
    }

    setUrl(null);
    resolveFileUrl(fileLink, imageWidth)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileLink, imageWidth]);

  return [url, setUrl];
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
}
