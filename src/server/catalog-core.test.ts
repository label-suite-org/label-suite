import { describe, expect, it } from "vitest";
import {
  buildCatalogNumberPlan,
  compareCatalogEntries,
  formatCatalogNumber,
  type CatalogOrderingEntry,
} from "./catalog-core";

function entry(overrides: Partial<CatalogOrderingEntry> = {}): CatalogOrderingEntry {
  return {
    id: "entry",
    entry_type: "release",
    release_date: "2026-10-01",
    sort_position: 0,
    created_at: "2026-07-20T12:00:00.000Z",
    catalog_number: null,
    catalog_number_locked: false,
    ...overrides,
  };
}

describe("chronological catalog core", () => {
  it("sorts by release date before upload time across catalog types", () => {
    const entries = [
      entry({ id: "album", entry_type: "release", release_date: "2026-10-01", created_at: "2026-07-20T12:00:00.000Z" }),
      entry({ id: "video", entry_type: "video", release_date: "2026-09-15", created_at: "2026-07-21T12:00:00.000Z" }),
    ];

    expect([...entries].sort(compareCatalogEntries).map((item) => item.id)).toEqual(["video", "album"]);
  });

  it("uses sort position and deterministic fallbacks for equal or missing dates", () => {
    const entries = [
      entry({ id: "second", release_date: "2026-10-01", sort_position: 2 }),
      entry({ id: "first", release_date: "2026-10-01", sort_position: 1 }),
      entry({ id: "undated", release_date: null }),
    ];

    expect([...entries].sort(compareCatalogEntries).map((item) => item.id)).toEqual(["first", "second", "undated"]);
  });

  it("formats padded catalog numbers and suffixes", () => {
    expect(formatCatalogNumber({ prefix: "TN", width: 3 }, 7)).toBe("TN007");
    expect(formatCatalogNumber({ prefix: "TN", width: 3 }, 7, "A")).toBe("TN007A");
  });

  it("assigns a shared chronological sequence regardless of object type", () => {
    const entries = [
      entry({ id: "lp", entry_type: "lp", release_date: "2026-11-01" }),
      entry({ id: "album", entry_type: "release", release_date: "2026-09-01" }),
      entry({ id: "video", entry_type: "video", release_date: "2026-10-01" }),
    ];

    expect(Object.fromEntries(buildCatalogNumberPlan(entries, { prefix: "TN", width: 3 }))).toEqual({
      album: "TN001",
      video: "TN002",
      lp: "TN003",
    });
  });

  it("keeps locked values and inserts a suffix when their chronological slot is occupied", () => {
    const entries = [
      entry({ id: "first", release_date: "2026-01-01", catalog_number: "TN001", catalog_number_locked: true }),
      entry({ id: "new", release_date: "2026-02-01" }),
      entry({ id: "published-later", release_date: "2026-03-01", catalog_number: "TN002", catalog_number_locked: true }),
    ];

    expect(Object.fromEntries(buildCatalogNumberPlan(entries, { prefix: "TN", width: 3 }))).toEqual({
      first: "TN001",
      new: "TN002A",
      "published-later": "TN002",
    });
  });
});
