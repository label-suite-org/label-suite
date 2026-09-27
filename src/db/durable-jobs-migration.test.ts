import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0050_durable_background_jobs.sql", import.meta.url), "utf8");
const store = readFileSync(new URL("../server/jobs/postgres-store.ts", import.meta.url), "utf8");

describe("durable background job storage contract", () => {
  it("installs queue, lease, retry, idempotency, and attempt fields", () => {
    for (const field of [
      "schema_version",
      "max_attempts",
      "available_at",
      "heartbeat_at",
      "finished_at",
      "lease_owner",
      "lease_expires_at",
      "idempotency_key",
      "error_metadata",
    ]) {
      expect(migration).toContain(`"${field}"`);
    }
    expect(migration).toContain('"label_suite"."job_attempts"');
    expect(migration).toContain("job_runs_org_type_idempotency_unique_idx");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("claims atomically and only completes a currently owned lease", () => {
    expect(store).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(store).toMatch(/status = 'running' AND lease_owner = \$3/);
    expect(store).toMatch(/attempt < max_attempts/);
    expect(store).toMatch(/lease_expires_at <= now\(\)/);
  });

  it("fails expired leases once attempts are exhausted", () => {
    expect(store).toMatch(/job\.attempt >= job\.max_attempts/);
    expect(store).toMatch(/status = 'failed'/);
    expect(store).toMatch(/error_metadata = jsonb_build_object\('name', 'LeaseExpired'/);
  });

  it("deduplicates enqueue by workspace, type, and idempotency key", () => {
    expect(store).toMatch(/ON CONFLICT \(org_id, job_type, idempotency_key\)/);
    expect(store).toMatch(/WHERE idempotency_key IS NOT NULL/);
  });
});
