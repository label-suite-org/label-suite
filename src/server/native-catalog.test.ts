import { describe, expect, it } from "vitest";
import { projectNativeCatalog } from "./native-catalog";

describe("native catalog projection", () => {
  it("retains duplicate warnings when the other relationship is outside the current page", () => {
    const [item] = projectNativeCatalog([{ id: "catalog-a", catalog_number: "TN-001", entry_type: "release", title: "Entry", release_date: null, status: "planned", notes: null, release_id: "release-a", release_title: "Canonical", release_count: 2 }]);
    expect(item.relationship_state).toBe("duplicate");
    expect(item.release?.id).toBe("release-a");
  });
  it("keeps catalog identity separate from its linked canonical release and preserves chronological source order", () => {
    expect(projectNativeCatalog([
      { id: "catalog-early", catalog_number: "TN-001", entry_type: "release", title: "Catalog title", release_date: "2026-01-01", status: "published", notes: "First pressing", release_id: "release-a", release_title: "Canonical Release A" },
      { id: "catalog-later", catalog_number: "TN-002", entry_type: "lp", title: "Vinyl metadata", release_date: "2026-02-01", status: "planned", notes: null, release_id: "release-b", release_title: "Canonical Release B" },
    ])).toEqual([
      { id: "catalog-early", catalog_number: "TN-001", entry_type: "release", title: "Catalog title", release_date: "2026-01-01", status: "published", notes: "First pressing", release: { id: "release-a", title: "Canonical Release A" }, relationship_state: "linked" },
      { id: "catalog-later", catalog_number: "TN-002", entry_type: "lp", title: "Vinyl metadata", release_date: "2026-02-01", status: "planned", notes: null, release: { id: "release-b", title: "Canonical Release B" }, relationship_state: "linked" },
    ]);
  });

  it("does not repair missing links and marks duplicate release relationships without changing either record", () => {
    const items = projectNativeCatalog([
      { id: "catalog-a", catalog_number: "TN-010", entry_type: "release", title: "A", release_date: null, status: "planned", notes: null, release_id: "release-a", release_title: "Release A" },
      { id: "catalog-b", catalog_number: "TN-011", entry_type: "lp", title: "B", release_date: null, status: "planned", notes: null, release_id: "release-a", release_title: "Release A" },
      { id: "catalog-missing", catalog_number: null, entry_type: "video", title: "Unlinked", release_date: null, status: "archived", notes: null, release_id: null, release_title: null },
      { id: "catalog-invalid", catalog_number: "TN-012", entry_type: "cd", title: "Broken", release_date: null, status: "planned", notes: null, release_id: "release-gone", release_title: null },
    ]);

    expect(items.map((item) => [item.id, item.relationship_state, item.release?.id ?? null])).toEqual([
      ["catalog-a", "duplicate", "release-a"],
      ["catalog-b", "duplicate", "release-a"],
      ["catalog-missing", "missing", null],
      ["catalog-invalid", "invalid", null],
    ]);
  });
});
