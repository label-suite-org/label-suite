import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0055_artist_relationships.sql", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema/catalog.ts", import.meta.url), "utf8");

describe("artist relationship migration", () => {
  it("adds the relationship column, index, and constraint to artists", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "relationship" text');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "artists_relationship_idx"');
    expect(migration).toContain('ADD CONSTRAINT "artists_relationship_check"');
    expect(schemaSource).toContain('relationship: text("relationship")');
    expect(schemaSource).toContain('index("artists_relationship_idx")');
    expect(schemaSource).toContain('check(');
  });

  it("keeps existing artist rows unclassified instead of backfilling guesses", () => {
    expect(migration).not.toMatch(/update\s+"label_suite"\."artists"/i);
    expect(migration).not.toMatch(/set\s+"relationship"/i);
  });
});
