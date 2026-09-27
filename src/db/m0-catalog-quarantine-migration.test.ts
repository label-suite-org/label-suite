import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0088_m0_catalog_quarantine.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe("M0 catalog quarantine migration", () => {
  it("fails closed around the reviewed tenant-scoped evidence ledger", () => {
    expect(migration).toContain("array_length(samply_track_ids, 1) <> 27");
    expect(migration).toContain("array_length(invalid_track_ids, 1) <> 28");
    expect(migration).toContain("IF affected = 0 THEN");
    expect(migration).toContain("expected all 28 reviewed rows or a clean database");
    expect(migration).toContain("Expected 35 Samply file records for quarantine");
    expect(migration).toContain("Reviewed invalid tracks gained % unsupported downstream references");
    expect(migration).toContain("WHERE org_id = 'true-nature' AND id = ANY(invalid_track_ids)");
  });

  it("retains source evidence while removing unsupported canonical tracks", () => {
    expect(migration).toContain("sync_status = 'unmatched'");
    expect(migration).toContain("postgres_table_name = 'data_quality_issues'");
    expect(migration).toContain("issue_type,");
    expect(migration).toContain("'empty_release_track'");
    expect(migration).toContain("DELETE FROM label_suite.tracks");
  });

  it("journals 0088 immediately after the current schema history", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0088_m0_catalog_quarantine");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0087_finance_reconciliation");
    expect(entry?.idx).toBe((predecessor?.idx ?? -2) + 1);
  });
});
