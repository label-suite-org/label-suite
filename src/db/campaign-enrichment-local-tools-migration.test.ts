import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../drizzle/0076_campaign_enrichment_local_tools.sql", import.meta.url);
const bootstrapMigrationUrl = new URL("../../drizzle/0078_local_tool_auth_bootstrap.sql", import.meta.url);
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";
const bootstrapSql = existsSync(bootstrapMigrationUrl) ? readFileSync(bootstrapMigrationUrl, "utf8") : "";
const normalizedSql = sql.toLowerCase();
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

describe("campaign enrichment local-tool migration", () => {
  it("adds token, claim, and run-provenance storage without rewriting rows", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "label_suite"."local_tool_tokens"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "label_suite"."campaign_enrichment_claims"');
    expect(sql).toContain('ALTER TABLE "label_suite"."campaign_enrichment_runs"');

    for (const column of [
      "source_kind",
      "submitted_by_user_id",
      "local_tool_token_id",
      "expected_lead_revision",
      "idempotency_key",
      "submission_hash",
      "client_metadata",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }

    expect(sql).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im);
  });

  it("guards every additive foreign key for safe replay", () => {
    for (const constraint of [
      "local_tool_tokens_org_id_orgs_id_fk",
      "local_tool_tokens_user_id_user_id_fk",
      "campaign_enrichment_claims_org_id_orgs_id_fk",
      "campaign_enrichment_claims_campaign_id_campaigns_id_fk",
      "campaign_enrichment_claims_lead_id_campaign_leads_id_fk",
      "campaign_enrichment_claims_token_id_local_tool_tokens_id_fk",
      "campaign_enrichment_claims_user_id_user_id_fk",
      "campaign_enrichment_runs_submitted_by_user_id_user_id_fk",
      "campaign_enrichment_runs_local_tool_token_id_local_tool_tokens_id_fk",
    ]) {
      expect(sql).toContain(`conname = '${constraint}'`);
      expect(sql).toContain(`ADD CONSTRAINT "${constraint}"`);
    }
  });

  it("enforces source provenance, lowercase hashes, and idempotency", () => {
    expect(normalizedSql).toContain("source_kind in ('in_app_provider', 'codex_mcp')");
    expect(normalizedSql).toContain("secret_hash ~ '^[a-f0-9]{64}$'");
    expect(normalizedSql).toContain("expected_lead_revision is null or expected_lead_revision ~ '^[a-f0-9]{64}$'");
    expect(normalizedSql).toContain("submission_hash is null or submission_hash ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrichment_claims_org_lead_unique_idx"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrichment_runs_local_tool_idempotency_unique_idx"');
    expect(normalizedSql).toContain('where "idempotency_key" is not null');
  });

  it("adds tenant policies and same-organization enforcement", () => {
    for (const table of ["local_tool_tokens", "campaign_enrichment_claims"]) {
      expect(sql).toContain(`ALTER TABLE "label_suite"."${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_org_isolation"`);
    }
    expect(sql).toContain('"org_id" = "label_suite"."current_org_id"()');
    expect(sql).not.toContain("label_suite_current_org_id()");
    expect(sql).toContain("'campaign_id', 'campaigns'");
    expect(sql).toContain("'lead_id', 'campaign_leads'");
    expect(sql).toContain("'token_id', 'local_tool_tokens'");
    expect(sql).toContain("'local_tool_token_id', 'local_tool_tokens'");
  });

  it("does not copy the token verifier into the generic row-audit trail", () => {
    expect(sql).not.toMatch(/audit_row_changes" ON "label_suite"\."local_tool_tokens/);
  });

  it("journals migration 0076 immediately after royalty lifecycle integrity", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0076_campaign_enrichment_local_tools");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0075_royalty_lifecycle_integrity");

    expect(entry).toEqual(expect.objectContaining({
      idx: 68,
      version: "7",
      tag: "0076_campaign_enrichment_local_tools",
      breakpoints: true,
    }));
    expect(entry!.idx).toBe(predecessor!.idx + 1);
    expect(entry!.when).toBeGreaterThan(predecessor!.when);
  });

  it("allows only the presented token ID to bootstrap before tenant context is known", () => {
    expect(bootstrapSql).toContain('CREATE POLICY "local_tool_tokens_authentication_bootstrap"');
    expect(bootstrapSql).toContain('FOR SELECT');
    expect(bootstrapSql).toContain('"id" = nullif(current_setting(\'app.current_local_tool_token_id\', true), \'\')');
    expect(bootstrapSql).not.toMatch(/BYPASSRLS|DISABLE ROW LEVEL SECURITY|current_org_id\s*=\s*null/i);

    const entry = journal.entries.find((candidate) => candidate.tag === "0078_local_tool_auth_bootstrap");
    expect(entry).toEqual(expect.objectContaining({
      idx: 70,
      version: "7",
      tag: "0078_local_tool_auth_bootstrap",
      breakpoints: true,
    }));
  });
});
