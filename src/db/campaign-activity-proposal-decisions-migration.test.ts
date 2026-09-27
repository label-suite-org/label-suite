import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0073_campaign_activity_proposal_decisions.sql", import.meta.url),
  "utf8",
);

describe("campaign activity proposal decisions migration", () => {
  it("protects proposal decisions with tenant, same-org, and audit controls", () => {
    expect(migration).toContain('ALTER TABLE "label_suite"."campaign_activity_proposal_decisions" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "tenant_isolation"');
    expect(migration).toContain('enforce_same_org_references');
    expect(migration).toContain('write_audit_log');
  });

  it("creates the proposal-decision uniqueness boundary", () => {
    expect(migration).toContain("campaign_activity_proposal_decisions_org_campaign_proposal_unique_idx");
  });
});
