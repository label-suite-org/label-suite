import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0049_chronological_shared_catalog.sql", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema/catalog.ts", import.meta.url), "utf8");

describe("chronological catalog migration", () => {
  it("adds workspace catalog settings and the catalog entry table", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "catalog_prefix"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "catalog_number_width"');
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS "label_suite"\."catalog_entries"/i);
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "catalog_entries_org_release_entry_unique_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "catalog_entries_org_number_unique_idx"');
    expect(schemaSource).toContain('export const catalog_entries = schema.table("catalog_entries"');
  });

  it("backfills existing releases in chronological order and marks generated values", () => {
    expect(migration).toMatch(/INSERT INTO "label_suite"\."catalog_entries"[\s\S]+FROM "label_suite"\."releases"/i);
    expect(migration).toMatch(/release_date"? ASC NULLS LAST[\s\S]+created_at"? ASC[\s\S]+id"? ASC/i);
    expect(migration).toContain("catalog_number_source");
    expect(migration).toContain("generated");
    expect(migration).toContain("catalog_number_locked");
  });
});
