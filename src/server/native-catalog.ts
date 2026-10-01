export const NATIVE_CATALOG_LIMIT = 100;

export type NativeCatalogSource = {
  id: string;
  catalog_number: string | null;
  entry_type: string;
  title: string;
  release_date: string | null;
  status: string;
  notes: string | null;
  release_id: string | null;
  release_title: string | null;
  release_count?: number;
  release_cover_art_url?: string | null;
};

export type NativeCatalogRelationshipState = "linked" | "missing" | "invalid" | "duplicate";

export type NativeCatalogItem = Omit<NativeCatalogSource, "release_id" | "release_title" | "release_cover_art_url"> & {
  release: { id: string; title: string; cover_art_url?: string | null } | null;
  relationship_state: NativeCatalogRelationshipState;
};

export function projectNativeCatalog(rows: NativeCatalogSource[]): NativeCatalogItem[] {
  const releaseCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.release_id && row.release_title) releaseCounts.set(row.release_id, row.release_count ?? (releaseCounts.get(row.release_id) ?? 0) + 1);
  }

  return rows.map((row) => {
    const release = row.release_id && row.release_title ? { id: row.release_id, title: row.release_title, ...(row.release_cover_art_url !== undefined ? { cover_art_url: row.release_cover_art_url } : {}) } : null;
    const relationship_state: NativeCatalogRelationshipState = !row.release_id
      ? "missing"
      : !row.release_title
        ? "invalid"
        : (releaseCounts.get(row.release_id) ?? 0) > 1 ? "duplicate" : "linked";
    return { id: row.id, catalog_number: row.catalog_number, entry_type: row.entry_type, title: row.title, release_date: row.release_date, status: row.status, notes: row.notes, release, relationship_state };
  });
}
