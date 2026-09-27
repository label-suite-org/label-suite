export interface CanonicalArtistAuxRow {
  dimensions: Record<string, string | number | null>;
  metrics: Record<string, string | number | null>;
}

export interface ArtistPlaylistAuxRow {
  name: string;
  ownerId: string | null;
  streams: number;
  latestPosition: number | null;
}

export interface ArtistShazamAuxRow {
  city: string;
  country: string | null;
  shazams: number;
}

function numeric(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function mapCanonicalArtistPlaylistRows(rows: readonly CanonicalArtistAuxRow[]): ArtistPlaylistAuxRow[] {
  return rows.map((row) => ({
    name: stringValue(row.dimensions.playlist__name ?? row.dimensions.playlist_name) ?? "Unknown playlist",
    ownerId: stringValue(row.dimensions.playlist__owner_id ?? row.dimensions.playlist_owner_id),
    streams: numeric(row.metrics.streams),
    latestPosition: row.metrics.latest_position == null ? null : numeric(row.metrics.latest_position),
  }));
}

export function mapCanonicalArtistShazamRows(rows: readonly CanonicalArtistAuxRow[]): ArtistShazamAuxRow[] {
  return rows.map((row) => ({
    city: stringValue(row.dimensions.city) ?? "Unknown",
    country: stringValue(row.dimensions.country),
    shazams: numeric(row.metrics.shazams),
  }));
}

function stringValue(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value);
}
