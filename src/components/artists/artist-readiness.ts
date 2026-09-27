import type { ArtistFocusField } from "./ArtistForm";

export type ArtistReadinessTarget = ArtistFocusField;

export type ReadinessDestination =
  | "overview:bio"
  | "overview:pro"
  | "overview:ipi"
  | "overview:spotify_id"
  | "overview:spotify_followers"
  | "overview:spotify_popularity"
  | "overview:instagram"
  | "overview:tiktok"
  | "tab:visuals"
  | "tab:documents"
  | "tab:rights";

export type ReadinessAction =
  | { kind: "edit"; focusField: ArtistReadinessTarget; destination: ReadinessDestination }
  | { kind: "open_tab"; tab: "visuals" | "rights"; destination: ReadinessDestination };

type ReadinessTargetConfig = {
  label: string;
  test: (artist: ArtistReadinessSource) => boolean;
  action?: ReadinessAction;
};

export interface ArtistReadinessRow {
  label: string;
  ok: boolean;
  action?: ReadinessAction;
}

export interface ArtistReadinessState {
  complete: number;
  rows: ArtistReadinessRow[];
  missing: string[];
}

export interface ArtistReadinessSource {
  image_url?: string | null;
  hasPrimaryImage?: boolean;
  imageAssetCount?: number | null;
  documentsCount?: number | null;
  rightsCount?: number | null;
  bio?: string | null;
  spotify_id?: string | null;
  spotify_followers?: number | null;
  spotify_popularity?: number | null;
  pro?: string | null;
  ipi?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
}

const TARGET_KEYS: ReadinessTargetConfig[] = [
  {
    label: "Image",
    test: (artist) => Boolean(artist.hasPrimaryImage ?? artist.image_url),
    action: { kind: "open_tab", tab: "visuals", destination: "tab:visuals" },
  },
  {
    label: "Bio",
    test: (artist) => Boolean(artist.bio),
    action: { kind: "edit", focusField: "bio", destination: "overview:bio" },
  },
  {
    label: "PRO",
    test: (artist) => Boolean(artist.pro),
    action: { kind: "edit", focusField: "pro", destination: "overview:pro" },
  },
  {
    label: "IPI",
    test: (artist) => Boolean(artist.ipi),
    action: { kind: "edit", focusField: "ipi", destination: "overview:ipi" },
  },
  {
    label: "Spotify ID",
    test: (artist) => Boolean(artist.spotify_id),
    action: { kind: "edit", focusField: "spotify_id", destination: "overview:spotify_id" },
  },
  {
    label: "Followers",
    test: (artist) => artist.spotify_followers != null,
    action: { kind: "edit", focusField: "spotify_followers", destination: "overview:spotify_followers" },
  },
  {
    label: "Popularity",
    test: (artist) => artist.spotify_popularity != null,
    action: { kind: "edit", focusField: "spotify_popularity", destination: "overview:spotify_popularity" },
  },
  {
    label: "Instagram",
    test: (artist) => Boolean(artist.instagram),
    action: { kind: "edit", focusField: "instagram", destination: "overview:instagram" },
  },
  {
    label: "TikTok",
    test: (artist) => Boolean(artist.tiktok),
    action: { kind: "edit", focusField: "tiktok", destination: "overview:tiktok" },
  },
];

export function buildArtistProfileReadiness(artist: ArtistReadinessSource): ArtistReadinessState {
  const baseRows: ArtistReadinessRow[] = TARGET_KEYS.map((item) => ({
    label: item.label,
    ok: item.test(artist),
    action: item.action,
  }));
  const workspaceRows: ArtistReadinessRow[] = [];

  if (artist.imageAssetCount != null) {
    workspaceRows.push({
      label: "Images",
      ok: artist.imageAssetCount > 0,
      action: { kind: "open_tab", tab: "visuals", destination: "tab:visuals" },
    });
  }

  if (artist.documentsCount != null) {
    workspaceRows.push({
      label: "Documents",
      ok: artist.documentsCount > 0,
      action: { kind: "open_tab", tab: "rights", destination: "tab:documents" },
    });
  }

  if (artist.rightsCount != null) {
    workspaceRows.push({
      label: "Rights rows",
      ok: artist.rightsCount > 0,
      action: { kind: "open_tab", tab: "rights", destination: "tab:rights" },
    });
  }

  const rows = [...baseRows, ...workspaceRows];
  const missing = rows.filter((row) => !row.ok).map((row) => row.label);
  return {
    rows,
    missing,
    complete: Math.round(((rows.length - missing.length) / rows.length) * 100),
  };
}

export function firstIncompleteArtistReadinessAction(artist: ArtistReadinessSource): ReadinessAction | null {
  return buildArtistProfileReadiness(artist).rows.find((row) => !row.ok && row.action)?.action ?? null;
}
