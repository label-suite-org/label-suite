import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0058_integration_core_schema.sql", import.meta.url), "utf8");
const helpers = readFileSync(new URL("../server/integrations.ts", import.meta.url), "utf8");

const coreTables = [
  "integration_providers",
  "integration_connections",
  "external_object_links",
  "sync_jobs",
  "raw_integration_events",
  "integration_errors",
  "data_quality_issues",
  "audit_events",
];

describe("integration core foundation migration", () => {
  it("upgrades the confirmed legacy integration shapes before installing new indexes", () => {
    const upgradeStart = migration.indexOf("-- Legacy production-shape recovery");
    expect(upgradeStart).toBeGreaterThan(-1);
    const upgrade = migration.slice(upgradeStart);
    for (const column of [
      'ADD COLUMN IF NOT EXISTS "provider_id"',
      'ADD COLUMN IF NOT EXISTS "last_checked_at"',
      'ADD COLUMN IF NOT EXISTS "last_successful_sync_at"',
      'ADD COLUMN IF NOT EXISTS "settings"',
      'ADD COLUMN IF NOT EXISTS "cursor_before"',
      'ADD COLUMN IF NOT EXISTS "cursor_after"',
      'ADD COLUMN IF NOT EXISTS "idempotency_key"',
      'ADD COLUMN IF NOT EXISTS "details"',
      'ADD COLUMN IF NOT EXISTS "updated_at"',
      'ADD COLUMN IF NOT EXISTS "before"',
      'ADD COLUMN IF NOT EXISTS "after"',
    ]) {
      expect(upgrade).toContain(column);
    }

    expect(upgrade).toMatch(/provider_key[\s\S]+?integration_providers[\s\S]+?provider_id/i);
    expect(upgrade).toContain('integration_connections_provider_compatibility');
    expect(upgrade).toContain('CREATE TRIGGER integration_connections_provider_compatibility');
    expect(upgrade).toContain('provider_key/provider_id mismatch');
    expect(upgrade).not.toContain('legacy_unknown');
    expect(upgrade).toContain('ALTER COLUMN "created_by" DROP NOT NULL');
    expect(upgrade).toContain('ALTER COLUMN "auth_type" SET DEFAULT \'none\'');
    expect(upgrade).toContain('auth_type/provider_id mismatch');
    expect(upgrade).toContain('ALTER COLUMN "settings" SET NOT NULL');
    expect(upgrade).toContain('ALTER COLUMN "match_confidence" TYPE integer');
    expect(upgrade).toMatch(/"match_confidence"\s*\*\s*100/);
    expect(upgrade).toContain('"match_confidence" < 0 OR "match_confidence" > 1');
    expect(upgrade).toContain('ALTER COLUMN "metadata" SET NOT NULL');
    expect(upgrade).toContain('ALTER COLUMN "object_id" DROP NOT NULL');
    expect(upgrade).toContain('ALTER COLUMN "dedupe_hash" DROP NOT NULL');
  });

  it("creates the org-scoped core integration tables and seeded providers", () => {
    for (const table of coreTables) {
      expect(migration).toContain(`"label_suite"."${table}"`);
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "label_suite"\\."${table}"[\\s\\S]+?"org_id" text DEFAULT 'true-nature' NOT NULL`, "i"));
      expect(migration).toMatch(new RegExp(`"${table}_org`, "i"));
    }

    expect(migration).toContain("'provider_samply'");
    expect(migration).toContain("'provider_gmail'");
    expect(migration).toContain("'provider_warm'");
  });

  it("applies tenant isolation to every integration table", () => {
    for (const table of coreTables) {
      expect(migration).toContain(`ALTER TABLE "label_suite"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."${table}";`);
      expect(migration).toMatch(new RegExp(`CREATE POLICY "tenant_isolation" ON "label_suite"\\."${table}"[\\s\\S]+?current_org_id`, "i"));
    }
  });

  it("enforces same-organization references for integration relationships", () => {
    for (const table of [
      "integration_connections",
      "external_object_links",
      "sync_jobs",
      "raw_integration_events",
      "integration_errors",
      "data_quality_issues",
    ]) {
      expect(migration).toMatch(new RegExp(`same_org_references[\\s\\S]+?label_suite\\.${table}`, "i"));
    }
  });

  it("installs provider, org, and idempotency indexes", () => {
    for (const index of [
      "integration_providers_org_key_unique_idx",
      "integration_connections_org_provider_label_unique_idx",
      "external_object_links_provider_object_idx",
      "external_object_links_external_unique_idx",
      "sync_jobs_org_connection_idempotency_unique_idx",
      "raw_integration_events_org_connection_idempotency_unique_idx",
      "data_quality_issues_org_idempotency_unique_idx",
      "raw_integration_events_payload_hash_idx",
    ]) {
      expect(migration).toContain(index);
    }
  });

  it("retains immutable raw provider evidence before normalization", () => {
    for (const field of ["payload", "payload_hash", "idempotency_key", "processing_status"]) {
      expect(migration).toMatch(new RegExp(`"raw_integration_events"[\\s\\S]+?"${field}"`, "i"));
    }
    expect(helpers).toContain("recordRawIntegrationEvent");
  });

  it("keeps imports idempotent in the server helper layer", () => {
    expect(helpers).toContain("deriveSyncJobIdempotencyKey");
    expect(helpers).toContain("deriveRawEventIdempotencyKey");
    expect(helpers).toContain("deriveDataQualityIssueIdempotencyKey");
    expect(helpers).toContain("findExistingSyncJobByIdempotency");
    expect(helpers).toContain("findExistingRawIntegrationEventByIdempotency");
    expect(helpers).toMatch(/createSyncJob[\s\S]+?sync_jobs[\s\S]+?onConflictDoNothing\(\{/);
    expect(helpers).toMatch(/recordRawIntegrationEvent[\s\S]+?raw_integration_events[\s\S]+?onConflictDoNothing\(\{/);
    expect(helpers).toMatch(/onConflictDoUpdate\(\{/);
    expect(helpers).toContain("external_object_links.external_object_type");
    expect(helpers).toContain("payload_hash: payloadHash");
  });
});
