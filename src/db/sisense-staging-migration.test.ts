import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0063_sisense_staging_schema.sql", import.meta.url), "utf8");
const indexMigrationPath = new URL("../../drizzle/0064_sisense_staging_indexes.sql", import.meta.url);
const indexMigration = existsSync(indexMigrationPath) ? readFileSync(indexMigrationPath, "utf8") : "";
const importer = readFileSync(new URL("../../scripts/import_sisense_csvs.ts", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));

const stagingTableNames = [
  "staging_tracks_cumulative",
  "staging_spotify_streams_source",
  "staging_apple_streams_source",
  "staging_spotify_demographics",
  "staging_spotify_superfans_city",
  "staging_spotify_playlists",
  "staging_shazams_city",
];

const stagingIndexes = [
  ['"idx_spotify_source_date"', '"label_suite"."staging_spotify_streams_source"', '"date"'],
  ['"idx_spotify_source_source"', '"label_suite"."staging_spotify_streams_source"', '"source"'],
  ['"idx_apple_source_date"', '"label_suite"."staging_apple_streams_source"', '"date"'],
  ['"idx_apple_source_source"', '"label_suite"."staging_apple_streams_source"', '"source_of_stream"'],
  ['"idx_spotify_demo_gender_age"', '"label_suite"."staging_spotify_demographics"', '"gender", "age_group"'],
  ['"idx_spotify_superfans_city"', '"label_suite"."staging_spotify_superfans_city"', '"city"'],
  ['"idx_spotify_superfans_country"', '"label_suite"."staging_spotify_superfans_city"', '"country"'],
  ['"idx_spotify_playlists_streams"', '"label_suite"."staging_spotify_playlists"', '"streams" DESC'],
  ['"idx_shazams_city"', '"label_suite"."staging_shazams_city"', '"city"'],
] as const;

function stagingTableColumns(source: string): Map<string, string[]> {
  const expression = /CREATE TABLE IF NOT EXISTS\s+"?label_suite"?\."?(staging_[a-z_]+)"?\s*\(([\s\S]*?)\);/gi;
  return new Map([...source.matchAll(expression)].map(([, name, definition]) => [
    name,
    definition
      .split("\n")
      .map((column) => column.trim().replace(/,$/, ""))
      .filter(Boolean)
      .map((column) => column.replaceAll('"', "").replace(/\s+/g, " ").toLowerCase()),
  ]));
}

describe("Sisense staging schema migration", () => {
  it("adopts exactly the seven importer-owned staging tables with every required column", () => {
    const importerTables = stagingTableColumns(importer);
    const migrationTables = stagingTableColumns(migration);

    expect([...migration.matchAll(/CREATE TABLE IF NOT EXISTS/gi)]).toHaveLength(7);
    expect([...importer.matchAll(/CREATE TABLE IF NOT EXISTS/gi)]).toHaveLength(7);
    expect([...importerTables.keys()].sort()).toEqual([...stagingTableNames].sort());
    expect([...migrationTables.keys()].sort()).toEqual([...stagingTableNames].sort());

    for (const name of stagingTableNames) {
      expect(migrationTables.get(name)).toEqual(importerTables.get(name));
    }
  });

  it("is additive and never rewrites the existing importer data", () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER\s+TABLE)\b/i);
  });

  it("keeps the staging schema immediately before its index migration", () => {
    const entry = journal.entries.find((candidate: { tag: string }) => candidate.tag === "0063_sisense_staging_schema");
    const indexEntry = journal.entries.find((candidate: { tag: string }) => candidate.tag === "0064_sisense_staging_indexes");
    expect(entry).toEqual(expect.objectContaining({ idx: 55, version: "7", tag: "0063_sisense_staging_schema", breakpoints: true }));
    expect(indexEntry!.idx).toBe(entry!.idx + 1);
  });

  it("canonicalizes every observed importer-owned staging index without changing rows", () => {
    expect([...indexMigration.matchAll(/CREATE INDEX IF NOT EXISTS/gi)]).toHaveLength(stagingIndexes.length);
    for (const [name, table, columns] of stagingIndexes) {
      expect(indexMigration).toContain(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns});`);
    }
    expect(indexMigration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER\s+TABLE|INSERT)\b/i);
  });

  it("journals the staging-index migration immediately after the staging schema", () => {
    const entry = journal.entries.find((candidate: { tag: string }) => candidate.tag === "0064_sisense_staging_indexes");
    const schemaEntry = journal.entries.find((candidate: { tag: string }) => candidate.tag === "0063_sisense_staging_schema");
    expect(entry).toEqual(expect.objectContaining({ idx: 56, version: "7", tag: "0064_sisense_staging_indexes", breakpoints: true }));
    expect(entry!.idx).toBe(schemaEntry!.idx + 1);
  });
});
