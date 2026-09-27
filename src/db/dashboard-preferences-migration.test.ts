import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../drizzle/0079_dashboard_preferences.sql", import.meta.url);
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";
const normalized = sql.toLowerCase();
const verifyWorkflow = readFileSync(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

describe("dashboard preferences migration", () => {
  it("adds one versioned personal layout per organization and user", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "label_suite"."dashboard_preferences"');
    for (const column of ["org_id", "user_id", "schema_version", "pinned_indicator_ids", "section_order", "hidden_section_ids"]) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_preferences_org_user_unique_idx"');
  });

  it("forces row security and binds both tenant and signed-in user", () => {
    expect(sql).toContain('ALTER TABLE "label_suite"."dashboard_preferences" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "label_suite"."dashboard_preferences" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "dashboard_preferences_personal_isolation"');
    expect(sql).toContain('"org_id" = "label_suite"."current_org_id"()');
    expect(sql).toContain('"user_id" = "label_suite"."current_user_id"()');
  });

  it("keeps layout payloads bounded at the database boundary", () => {
    expect(normalized).toContain("jsonb_typeof(pinned_indicator_ids) = 'array'");
    expect(normalized).toContain("jsonb_array_length(pinned_indicator_ids) <= 3");
    expect(normalized).toContain("jsonb_typeof(section_order) = 'array'");
    expect(normalized).toContain("jsonb_array_length(section_order) = 6");
    expect(normalized).toContain("jsonb_typeof(hidden_section_ids) = 'array'");
  });

  it("declares a section-order default that satisfies the six-section constraint", () => {
    expect(normalized).toContain(
      `"section_order" jsonb default '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb not null`,
    );
  });

  it("journals 0079 immediately after the auth bootstrap migration", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0079_dashboard_preferences");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0078_local_tool_auth_bootstrap");
    expect(entry).toEqual(expect.objectContaining({ idx: 71, version: "7", breakpoints: true }));
    expect(entry!.idx).toBe(predecessor!.idx + 1);
    expect(entry!.when).toBeGreaterThan(predecessor!.when);
  });

  it("runs the personal RLS proof against CI PostgreSQL", () => {
    expect(verifyWorkflow).toContain('DASHBOARD_PREFERENCES_RLS_TEST: "1"');
  });
});
