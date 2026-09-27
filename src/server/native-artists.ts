import { getArtistDetail } from "./artists";

const RELATIONSHIP_LIMIT = 8;

export type NativeArtistDetailSource = Awaited<ReturnType<typeof getArtistDetail>>;

export interface NativeArtistDetailProjection {
  artist: {
    id: string;
    name: string;
    contact_id?: string | null;
    updated_at?: string | null;
    image_url: string | null;
    image_state: "available" | "missing";
    bio: string | null;
    relationship: string | null;
    spotify_id: string | null;
    spotify_followers: number | null;
    spotify_popularity: number | null;
    pro: string | null;
    ipi: string | null;
    instagram: string | null;
    tiktok: string | null;
  };
  readiness: { complete: number; total: number; missing: string[] };
  relationships: {
    releases: Array<{ id: string; title: string; release_date: string | null; status: string | null; cover_art_url: string | null }>;
    campaigns: Array<{ id: string; name: string; type: string | null; status: string | null; release_id: string | null; release_title: string | null; owner: string | null }>;
    tasks: Array<{ id: string; name: string; status: string | null; priority: string | null; due_date: string | null; next_action: string | null }>;
    primary_contact: { id: string; name: string } | null;
    counts: { releases: number; campaigns: number; works: number; rights: number; tasks: number; assets: number; documents: number };
  };
}

export function projectNativeArtistDetail(detail: NativeArtistDetailSource): NativeArtistDetailProjection | null {
  if (!detail.artist) return null;
  const artist = detail.artist;
  const readinessChecks: Array<[string, boolean]> = [
    ["Image", Boolean(artist.image_url)],
    ["Bio", Boolean(artist.bio)],
    ["PRO", Boolean(artist.pro)],
    ["IPI", Boolean(artist.ipi)],
    ["Spotify ID", Boolean(artist.spotify_id)],
    ["Followers", artist.spotify_followers != null],
    ["Popularity", artist.spotify_popularity != null],
    ["Instagram", Boolean(artist.instagram)],
    ["TikTok", Boolean(artist.tiktok)],
  ];
  const missing = readinessChecks.filter(([, complete]) => !complete).map(([label]) => label);
  const releases = detail.releases.slice(0, RELATIONSHIP_LIMIT).map((release) => ({
    id: release.id,
    title: release.title,
    release_date: release.release_date ?? null,
    status: release.status ?? null,
    cover_art_url: release.cover_art_url ?? null,
  }));
  const campaigns = detail.campaigns.slice(0, RELATIONSHIP_LIMIT).map((campaign) => ({
    id: campaign.id,
    name: campaign.campaign_name,
    type: campaign.campaign_type ?? null,
    status: campaign.status ?? null,
    release_id: campaign.linked_release_id ?? null,
    release_title: campaign.release_title ?? null,
    owner: campaign.owner ?? null,
  }));
  const tasks = detail.tasks.slice(0, RELATIONSHIP_LIMIT).map((task) => ({
    id: task.id,
    name: task.task_name,
    status: task.status ?? null,
    priority: task.priority ?? null,
    due_date: task.due_date ?? null,
    next_action: task.next_action ?? null,
  }));
  const workIDs = new Set(detail.rights.map((right) => right.work_id).filter((id): id is string => Boolean(id)));

  const projectedArtist: NativeArtistDetailProjection["artist"] = {
      id: artist.id,
      name: artist.name,
      image_url: artist.image_url ?? null,
      image_state: artist.image_url ? "available" : "missing",
      bio: artist.bio ?? null,
      relationship: artist.relationship ?? null,
      spotify_id: artist.spotify_id ?? null,
      spotify_followers: artist.spotify_followers ?? null,
      spotify_popularity: artist.spotify_popularity ?? null,
      pro: artist.pro ?? null,
      ipi: artist.ipi ?? null,
      instagram: artist.instagram ?? null,
      tiktok: artist.tiktok ?? null,
      ...(Object.prototype.hasOwnProperty.call(artist, "contact_id") ? { contact_id: artist.contact_id ?? null } : {}),
      ...(artist.updated_at ? { updated_at: artist.updated_at instanceof Date ? artist.updated_at.toISOString() : artist.updated_at } : {}),
    };

  return {
    artist: projectedArtist,
    readiness: { complete: readinessChecks.length - missing.length, total: readinessChecks.length, missing },
    relationships: {
      releases,
      campaigns,
      tasks,
      primary_contact: detail.primaryContact ? { id: detail.primaryContact.id, name: detail.primaryContact.name } : null,
      counts: {
        releases: detail.releases.length,
        campaigns: detail.campaigns.length,
        works: workIDs.size,
        rights: detail.rights.length,
        tasks: detail.tasks.length,
        assets: detail.mediaAssets.length,
        documents: detail.documents.length,
      },
    },
  };
}
