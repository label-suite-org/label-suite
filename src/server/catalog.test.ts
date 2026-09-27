import { describe, expect, it } from "vitest";
import { createCatalogEntrySchema, updateCatalogEntrySchema } from "./catalog";

describe("catalog mutation schemas", () => {
  it("accepts a physical edition linked to a release", () => {
    expect(createCatalogEntrySchema.parse({
      entry_type: "lp",
      title: "The Album LP",
      release_id: "release-1",
      release_date: "2026-11-01",
      status: "planned",
      sort_position: 0,
      notes: null,
    })).toMatchObject({ entry_type: "lp", title: "The Album LP", release_id: "release-1" });
  });

  it("does not allow ordinary edits to overwrite a catalog number or lock", () => {
    const result = updateCatalogEntrySchema.safeParse({
      id: "entry-1",
      title: "Edited title",
      catalog_number: "TN001",
      catalog_number_locked: false,
    });

    expect(result.success).toBe(false);
  });
});
