"use client";

import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Disc3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ListChecks,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { isImageAsset, resolveFileUrl, uploadFileToStorage } from "../../lib/storage-client";
import { ArtistDeleteButton, ArtistEditButton, ArtistEditDialog } from "./ArtistActionButtons";
import { buildArtistProfileReadiness, type ArtistReadinessState, type ReadinessDestination } from "./artist-readiness";
import type { Artist, ArtistFocusField, ContactOption } from "./ArtistForm";
import { normalizeReviewedRichText } from "../../lib/reviewed-rich-text";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
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
  "overview:spotify_followers": { tab: "overview", targetId: null },
  "overview:spotify_popularity": { tab: "overview", targetId: null },
  "overview:instagram": { tab: "overview", targetId: null },
  "overview:tiktok": { tab: "overview", targetId: null },
  "tab:visuals": { tab: "visuals", targetId: "artist-image-uploader" },
  "tab:documents": { tab: "rights", targetId: "artist-documents-panel" },
  "tab:rights": { tab: "rights", targetId: "artist-rights-panel" },
};

export function readinessDestinationTarget(destination: ReadinessDestination): ReadinessDestinationTarget {
  return READINESS_DESTINATION_TARGETS[destination];
}

const TABS: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
  { key: "overview", label: "Overview", icon: <ListChecks className="h-4 w-4" /> },
  { key: "visuals", label: "Images", icon: <ImageIcon className="h-4 w-4" /> },
  { key: "releases", label: "Releases", icon: <Disc3 className="h-4 w-4" /> },
  { key: "team", label: "Team", icon: <Users className="h-4 w-4" /> },
  { key: "rights", label: "Rights", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "campaigns", label: "Campaigns", icon: <Briefcase className="h-4 w-4" /> },
  { key: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
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
}: {
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
  const bioDisplay = normalizeReviewedRichText(
    artist.bio_document,
    artist.bio,
    {
      reviewStatus: artist.bio_review_status === "reviewed" ? "reviewed" : "draft",
      reviewedHash: artist.bio_reviewed_hash ?? null,
    },
  );
  const upcoming = releases
    .filter((release) => release.release_date && new Date(`${release.release_date}T00:00:00`).getTime() >= startOfToday())
    .sort((a, b) => (a.release_date || "").localeCompare(b.release_date || ""))[0] ?? null;
  const approvedAssets = assets.filter((asset) => asset.approval_status === "approved").length;

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
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <section className="grid gap-5 border-b border-border pb-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border bg-neutral-950">
              <ArtistHeroImage artist={artist} imageLink={heroImageLink} />
            </div>
            {canMutate && <Button variant="ghost"
              type="button"
              onClick={jumpToImageUploader}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload className="h-4 w-4" />
              {hasPrimaryImage ? "Change artist image" : heroImageLink ? "Set roster image" : "Add artist image"}
            </Button>}
            <p className="text-xs leading-5 text-muted-foreground">
              This controls the large photo on this artist page and the image shown in the roster.
            </p>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {artist.pro ? <span className="rounded-md border border-border bg-muted/35 px-2 py-1 text-xs font-medium">{artist.pro}</span> : null}
              <span className={`rounded-md border px-2 py-1 text-xs font-medium ${relationship.className}`}>{relationship.label}</span>
              <span className="rounded-md border border-border bg-muted/35 px-2 py-1 text-xs font-medium">{health.complete}% profile</span>
              {upcoming ? <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Upcoming</span> : null}
            </div>

            <div>
              <h1 className="truncate text-4xl font-semibold tracking-tight">{artist.name}</h1>
              <p className="mt-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">{relationship.detail}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-border px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground" data-testid="artist-bio-state">
                  {bioDisplay.state}
                </span>
              </div>
              {bioDisplay.state === "missing" ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">No bio has been added yet.</p>
              ) : (
                <RichText
                  className="mt-2 min-w-0 max-w-3xl break-words text-sm leading-6 text-muted-foreground [&_a]:break-all [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                  data-testid="artist-bio-rendered"
                  html={bioDisplay.html}
                />
              )}
              {primaryContact ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Primary contact: <a href="/contacts" className="font-medium text-foreground hover:underline">{primaryContact.name}</a>
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Followers" value={formatNumber(artist.spotify_followers)} detail={`Popularity ${artist.spotify_popularity ?? "-"}`} icon={<Users className="h-4 w-4" />} />
              <Metric label="Catalog" value={String(releases.length)} detail={`${releases.filter((release) => release.release_ready).length} ready`} icon={<Disc3 className="h-4 w-4" />} />
              <Metric label="Assets" value={String(assets.length)} detail={`${approvedAssets} approved`} icon={<ImageIcon className="h-4 w-4" />} />
            </div>

            {canMutate && <div className="flex flex-wrap gap-2">
              <Button variant="outline"
                type="button"
                onClick={jumpToImageUploader}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <ImageIcon className="h-4 w-4" />
                Manage images
              </Button>
              <ArtistEditButton artist={artist} contactOptions={contactOptions} />
              <ArtistDeleteButton artist={artist} />
            </div>}
          </div>
        </div>

        <aside className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Next move</p>
              <p className="mt-1 text-lg font-semibold tracking-tight">
                {upcoming ? upcoming.title : health.missing.length ? "Complete profile" : "Build visual kit"}
              </p>
            </div>
            {health.missing.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {upcoming
              ? `${formatDate(upcoming.release_date)} - ${upcoming.format || "release"}`
              : health.missing.length
                ? `Missing ${health.missing.slice(0, 3).join(", ")}${health.missing.length > 3 ? ` +${health.missing.length - 3}` : ""}`
                : "Add a press photo, social crop, and one-sheet to round out the artist profile."}
          </p>
        </aside>
      </section>

      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Artist sections">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant="ghost"
            onClick={() => setActiveTab(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-none border-b-2 px-3 text-sm font-medium transition ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </Button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <OverviewTab
          artist={artist}
          releases={releases}
          assets={assets}
          campaigns={campaigns}
          tasks={tasks}
          canMutate={canMutate}
          onReadinessAction={openReadinessDestination}
          health={health}
        />
      )}
      {activeTab === "visuals" && (
        <ImagesTab artist={artist} releases={releases} assets={assets} canMutate={canMutate} />
      )}
      {activeTab === "releases" && <ReleaseSection releases={releases} />}
      {activeTab === "team" && <TeamTab primaryContact={primaryContact} rights={rights} />}
      {activeTab === "rights" && <RightsTab rights={rights} documents={documents} />}
      {activeTab === "campaigns" && <CampaignsTab campaigns={campaigns} tasks={tasks} />}
      {activeTab === "analytics" && <AnalyticsTab artist={artist} releases={releases} campaigns={campaigns} />}
    </div>
  );
}

function startOfToday(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function OverviewTab({
  artist,
  releases,
  assets,
  campaigns,
  tasks,
  canMutate,
  onReadinessAction,
  health,
}: {
  artist: ArtistDetail;
  releases: ArtistRelease[];
  assets: ArtistAsset[];
  campaigns: ArtistCampaign[];
  tasks: ArtistTask[];
  canMutate: boolean;
  onReadinessAction: (destination: ReadinessDestination) => void;
  health: ArtistReadinessState;
}) {
  const openTasks = tasks.filter((task) => !["done", "complete", "completed", "cancelled"].includes((task.status || "").toLowerCase()));
  const activeCampaigns = campaigns.filter((campaign) => !["done", "complete", "completed", "archived"].includes((campaign.status || "").toLowerCase()));
  const imageCount = assets.filter(isImageLike).length;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-5" aria-label="Artist workspace overview">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Profile" value={`${health.complete}%`} detail={health.missing.length ? `${health.missing.length} gaps` : "complete"} icon={<ListChecks className="h-4 w-4" />} />
          <Metric label="Images" value={String(imageCount)} detail={`${assets.length} total assets`} icon={<ImageIcon className="h-4 w-4" />} />
          <Metric label="Campaigns" value={String(activeCampaigns.length)} detail={`${campaigns.length} logged`} icon={<Briefcase className="h-4 w-4" />} />
          <Metric label="Open tasks" value={String(openTasks.length)} detail={openTasks[0]?.priority || "no priority"} icon={<AlertTriangle className="h-4 w-4" />} />
        </section>

        <ReleaseSection releases={releases} />
      </section>

      <aside className="space-y-5">
        <ReadinessCard artist={artist} canMutate={canMutate} health={health} onReadinessAction={onReadinessAction} />
        <TaskList tasks={openTasks.slice(0, 5)} />
      </aside>
    </div>
  );
}

function ImagesTab({ artist, releases, assets, canMutate }: { artist: ArtistDetail; releases: ArtistRelease[]; assets: ArtistAsset[]; canMutate: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      {canMutate ? <ArtistAssetUploader artist={artist} releases={releases} /> : <p className="text-sm text-muted-foreground">Image uploads are read-only.</p>}
      <fieldset disabled={!canMutate}><ArtistAssetGallery artist={artist} assets={assets} /></fieldset>
    </div>
  );
}

function ReleaseSection({ releases }: { releases: ArtistRelease[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Releases</h2>
        <span className="text-sm text-muted-foreground">{releases.length}</span>
      </div>
      <ReleaseGrid releases={releases} />
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
      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-sm font-semibold tracking-tight">Primary contact</h2>
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
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section id="artist-rights-panel" tabIndex={-1} className="space-y-3 scroll-mt-24">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Rights and credits</h2>
          <span className="text-sm text-muted-foreground">{rights.length}</span>
        </div>
        <SimpleList
          emptyTitle="No rights rows found for this artist catalog."
          rows={rights.map((right) => ({
            id: right.id,
            title: right.work_title || "Untitled work",
            meta: [right.role, right.ownership_type, right.scope].filter(Boolean).join(" - ") || "Rights row",
            detail: `${right.contact_name || "No contact"}${right.percent_share == null ? "" : ` - ${right.percent_share}%`}${right.clearance_status ? ` - ${right.clearance_status}` : ""}`,
          }))}
        />
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
    <div className="grid gap-3 md:grid-cols-3">
      <Metric label="Spotify followers" value={formatNumber(artist.spotify_followers)} detail={`Popularity ${artist.spotify_popularity ?? "-"}`} icon={<Users className="h-4 w-4" />} />
      <Metric label="Release readiness" value={`${readyReleases}/${releases.length}`} detail="ready releases" icon={<CheckCircle2 className="h-4 w-4" />} />
      <Metric label="Active campaigns" value={String(activeCampaigns)} detail="marketing context" icon={<Briefcase className="h-4 w-4" />} />
    </div>
  );
}

function ArtistHeroImage({ artist, imageLink }: { artist: ArtistDetail; imageLink: string | null }) {
  const [url, setUrl] = useResolvedImage(imageLink, 800);

  if (url) {
    return <img src={url} alt={`${artist.name} press image`} width={800} height={800} loading="eager" decoding="async" fetchPriority="high" className="aspect-square h-full w-full object-cover" onError={() => setUrl(null)} />;
  }

  return (
    <div className="flex aspect-square h-full w-full items-end bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_38%),linear-gradient(145deg,#27272a_0%,#111113_52%,#050505_100%)] p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-normal text-white/60">Artist image</p>
        <p className="mt-2 text-5xl font-semibold tracking-tight text-white">{initials(artist.name)}</p>
      </div>
    </div>
  );
}

function ReleaseGrid({ releases }: { releases: ArtistRelease[] }) {
  if (!releases.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium text-foreground">No releases linked yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">Create or link a release to start building the catalog view.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {releases.map((release) => (
        <a key={release.id} href={`/releases/${release.id}`} className="group rounded-lg border border-border bg-background p-3 transition hover:bg-muted/25">
          <div className="flex items-start gap-3">
            <ReleaseCover release={release} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{release.title}</h3>
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
    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-neutral-900 text-xs font-semibold text-white">
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
    <section id="artist-image-uploader" tabIndex={-1} className="scroll-mt-24 rounded-lg border border-border bg-background p-4">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Change artist image</h2>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          Upload a press photo or paste an image link. Leave "Use as primary artist image" checked to update the large artist photo immediately.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            placeholder={`${artist.name} press photo`}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Type</span>
            <NativeSelect
              value={assetType}
              onChange={(event) => setAssetType(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {ASSET_TYPES.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Release</span>
            <NativeSelect
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Artist profile only</option>
              {releases.map((release) => (
                <option key={release.id} value={release.id}>{release.title}</option>
              ))}
            </NativeSelect>
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
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
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
        <Button variant="ghost"
          type="submit"
          disabled={loading}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
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
      <section className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex gap-3">
        <AssetThumb asset={asset} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{asset.asset_name}</p>
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
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Profile readiness</h2>
        <span className="text-sm font-medium">{health.complete}%</span>
      </div>
      <div className="mt-3 space-y-2">
        {health.rows.map((row) => {
          if (row.ok) {
            return (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 text-sm">
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
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 text-sm">
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
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 text-sm">
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
            <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <Button
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
      <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
        {emptyTitle}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const content = (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 transition hover:bg-muted/20">
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              {row.icon || <ListChecks className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
              {row.meta ? <p className="mt-1 text-xs text-muted-foreground">{row.meta}</p> : null}
              {row.detail ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.detail}</p> : null}
            </div>
          </div>
        );
        return row.href ? <a key={row.id} href={row.href}>{content}</a> : <div key={row.id}>{content}</div>;
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
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function useResolvedImage(fileLink: string | null, imageWidth: 96 | 320 | 800): [string | null, (value: string | null) => void] {
  const [url, setUrl] = useState<string | null>(/^https?:\/\//i.test(fileLink || "") ? fileLink : null);

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
