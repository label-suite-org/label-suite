import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration35Sql = readFileSync(new URL("../../drizzle/0035_grants_workspace_v2.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
const schemaSource = readFileSync(new URL("./schema/grants.ts", import.meta.url), "utf8");

describe("Grants V2 migration security", () => {
  it("tolerates pre-existing operational columns in production", () => {
    for (const column of ["next_action", "next_action_due"]) {
      expect(migration35Sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
  });

  it("enforces same-organization references on every grants workspace join", () => {
    expect(migration35Sql).toContain('FUNCTION "label_suite"."enforce_same_org_references"');
    for (const table of [
      "project_funding_profiles",
      "funding_needs",
      "funding_need_budget_lines",
      "grant_deadlines",
      "grant_application_funding_needs",
      "grant_requirements",
      "grant_application_requirements",
      "grant_application_calls",
      "grant_application_events",
      "grant_applications",
      "grant_application_documents",
    ]) {
      expect(migration35Sql).toContain(`same_org_references ON label_suite.${table}`);
    }
  });

  it("installs row audit triggers on every new operational table", () => {
    for (const table of [
      "project_funding_profiles",
      "funding_needs",
      "funding_need_budget_lines",
      "grant_deadlines",
      "grant_application_funding_needs",
      "grant_requirements",
      "grant_application_requirements",
      "grant_application_calls",
      "grant_application_events",
    ]) {
      expect(migration35Sql).toMatch(new RegExp(`audit_row_changes ON label_suite\\.${table}`));
    }
  });
});

describe("grant application evidence migrations", () => {
  it("registers the owner-membership and extraction migrations after the integration core schema", () => {
    const entries = journal.entries.filter((entry: { tag: string }) => [
      "0058_integration_core_schema",
      "0059_grant_application_owner_membership",
      "0060_grant_document_extractions",
    ].includes(entry.tag));

    expect(entries).toEqual([
      { idx: 50, version: "7", when: 1786060000000, tag: "0058_integration_core_schema", breakpoints: true },
      { idx: 51, version: "7", when: 1786140000000, tag: "0059_grant_application_owner_membership", breakpoints: true },
      { idx: 52, version: "7", when: 1786140000001, tag: "0060_grant_document_extractions", breakpoints: true },
    ]);
  });

  it("guards application owners with active workspace membership", () => {
    const sql = readFileSync(new URL("../../drizzle/0059_grant_application_owner_membership.sql", import.meta.url), "utf8");

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "owner_user_id"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "grant_applications_org_owner_user_idx"');
    expect(sql).toContain('"label_suite"."enforce_grant_application_owner_membership"');
    expect(sql).toContain('"org_memberships" membership');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF "org_id", "owner_user_id"');
    expect(schemaSource).toContain('owner_user_id: text("owner_user_id").references(() => users.id)');
  });

  it("keeps extracted grant document text tenant scoped and audited", () => {
    const sql = readFileSync(new URL("../../drizzle/0060_grant_document_extractions.sql", import.meta.url), "utf8");
    const table = schemaSource.match(/export const grant_document_extractions = schema\.table\("grant_document_extractions", \{[\s\S]+?\n\]\);/)?.[0] ?? "";

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "label_suite"."grant_document_extractions"');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "tenant_isolation"');
    expect(sql).toContain("label_suite.enforce_same_org_references");
    expect(sql).toContain("label_suite.write_audit_log");
    expect(table).toContain('source_hash: text("source_hash").notNull()');
    expect(table).toContain('uniqueIndex("grant_document_extractions_source_unique_idx").on(table.org_id, table.document_id, table.source_hash)');
  });
});
