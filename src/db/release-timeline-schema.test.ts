import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0034_release_timeline_families.sql", import.meta.url), "utf8");

describe("release timeline migration constraints", () => {
  test("creates timeline objects idempotently", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS "label_suite"\."release_milestones"/i);

    const createTable = migration.match(/CREATE TABLE IF NOT EXISTS "label_suite"\."release_milestones"[\s\S]+?;\n/)?.[0];
    for (const column of [
      "id",
      "org_id",
      "release_id",
      "title",
      "phase",
      "due_date",
      "status",
      "owner",
      "notes",
      "is_blocking",
      "position",
      "created_at",
      "updated_at",
    ]) {
      expect(createTable).toContain(`"${column}"`);
    }
    expect(createTable).toMatch(/"id" text PRIMARY KEY NOT NULL/i);
    expect(createTable).toContain("release_milestones_org_id_orgs_id_fk");
    expect(createTable).not.toContain("release_milestones_release_id_releases_id_fk");

    for (const column of ["release_milestone_id", "timeline_phase", "parent_release_id"]) {
      expect(migration).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`, "i"));
    }

    for (const index of [
      "release_milestones_org_release_phase_idx",
      "ops_tasks_release_milestone_idx",
      "ops_tasks_timeline_phase_idx",
      "releases_parent_release_id_idx",
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE INDEX IF NOT EXISTS "${index}"`, "i"));
    }
  });

  test.each([
    ["release_milestones_release_id_releases_id_fk", "CASCADE"],
    ["ops_tasks_release_milestone_id_fkey", "SET NULL"],
    ["releases_parent_release_id_fkey", "SET NULL"],
  ])("reconciles and validates %s with ON DELETE %s", (constraint, deleteAction) => {
    expect(migration).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS "${constraint}"`, "i"));
    expect(migration).toMatch(
      new RegExp(`ADD CONSTRAINT "${constraint}"[^;]+ON DELETE ${deleteAction}[^;]+NOT VALID;`, "i"),
    );
    expect(migration).toMatch(new RegExp(`VALIDATE CONSTRAINT "${constraint}"`, "i"));
  });

  test("reconciles and validates the canonical timeline phase check", () => {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS "ops_tasks_timeline_phase_check"/i);
    expect(migration).toMatch(/ADD CONSTRAINT "ops_tasks_timeline_phase_check"[\s\S]+?CHECK[\s\S]+?NOT VALID/i);
    expect(migration).toMatch(/VALIDATE CONSTRAINT "ops_tasks_timeline_phase_check"/i);
    for (const phase of ["strategy_lock", "assets_metadata", "distribution_dsp", "campaign_rollout", "release_week", "post_release"]) {
      expect(migration).toContain(`'${phase}'`);
    }
  });

  test("replaces tenant isolation and audit wiring", () => {
    expect(migration).toContain('ALTER TABLE "label_suite"."release_milestones" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."release_milestones"');
    expect(migration).toMatch(
      /CREATE POLICY "tenant_isolation"[\s\S]+?USING \("org_id" = "label_suite"\."current_org_id"\(\)\)[\s\S]+?WITH CHECK \("org_id" = "label_suite"\."current_org_id"\(\)\)/i,
    );
    expect(migration).toContain('DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."release_milestones"');
    expect(migration).toMatch(
      /CREATE TRIGGER "audit_row_changes"[\s\S]+?EXECUTE FUNCTION "label_suite"\."write_audit_log"\(\)/i,
    );
  });
});
