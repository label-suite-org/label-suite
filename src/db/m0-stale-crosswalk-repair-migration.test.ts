import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0089_m0_stale_crosswalk_repair.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe("M0 stale crosswalk repair migration", () => {
  it("fails closed around the complete reviewed import ledger", () => {
    expect(migration).toContain("jsonb_array_length(project_rows) <> 3");
    expect(migration).toContain("jsonb_array_length(track_rows) <> 24");
    expect(migration).toContain("jsonb_array_length(role_rows) <> 9");
    expect(migration).toContain("expected all 38 source mappings or a clean database");
    expect(migration).toContain("mapping.import_batch_id IS NOT NULL");
    expect(migration).toContain("mapping.record_hash IS NOT NULL");
    expect(migration).toContain("partially restored canonical targets");
  });

  it("uses exact source relationships and quarantines unsupported identity", () => {
    expect(migration).toContain("source.release");
    expect(migration).toContain("source.work");
    expect(migration).toContain("source.contributor");
    expect(migration).toContain("catalog_number = 'TNR-007'");
    expect(migration).toContain("'empty_project'");
    expect(migration).toContain("'unresolved_role_contributor'");
    expect(migration).toContain("no name or email inference was applied");
    expect(migration).not.toMatch(/lower\([^\n]*(title|name)/i);
  });

  it("journals 0089 immediately after the current schema history", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0089_m0_stale_crosswalk_repair");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0088_m0_catalog_quarantine");
    expect(entry?.idx).toBe((predecessor?.idx ?? -2) + 1);
  });
});
