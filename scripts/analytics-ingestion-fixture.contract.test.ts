import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(new URL("./analytics-ingestion-fixture.ts", import.meta.url), "utf8");

describe("analytics ingestion fixture contract", () => {
  it("uses the actual importer and analytics table path", () => {
    expect(fixture).toContain('"scripts/sisense-sync.ts"');
    expect(fixture).toContain("analytics_import_runs");
    expect(fixture).toContain("analytics_import_files");
    expect(fixture).toContain("analytics_metric_rows");
    expect(fixture).not.toContain("create table ${schema}.runs");
  });

  it("keeps RLS and advisory-lock checks on the fixture's analytics tables", () => {
    expect(fixture).toContain("verifyRlsAndAdvisoryLock");
    expect(fixture).toContain("analytics_metric_rows enable row level security");
    expect(fixture).toContain("analytics_metric_rows force row level security");
    expect(fixture).toContain("pg_try_advisory_xact_lock");
  });

  it("uses a restricted non-owner role for the unfiltered RLS visibility probe", () => {
    const probe = fixture.slice(
      fixture.indexOf("async function verifyRlsAndAdvisoryLock"),
      fixture.indexOf("async function insertFixtureMetricRow"),
    );
    const createRole = probe.indexOf("create role ${rlsProbeRole} noinherit nologin nosuperuser");
    const grantSchema = probe.indexOf("grant usage on schema ${schema} to ${rlsProbeRole}");
    const grantSelect = probe.indexOf("grant select on ${schema}.analytics_metric_rows to ${rlsProbeRole}");
    const restrictedSelect = probe.indexOf("set local role ${rlsProbeRole}");
    const visibleQuery = probe.indexOf("select id from ${schema}.analytics_metric_rows order by id");

    expect(createRole).toBeGreaterThan(-1);
    expect(probe).toContain("nobypassrls");
    expect(grantSchema).toBeGreaterThan(createRole);
    expect(grantSelect).toBeGreaterThan(grantSchema);
    expect(restrictedSelect).toBeGreaterThan(grantSelect);
    expect(visibleQuery).toBeGreaterThan(restrictedSelect);
    expect(probe.slice(restrictedSelect, visibleQuery + 90)).not.toContain("where org_id");
  });

  it("rolls back RLS probe rows before the final zero-normalized-row assertion", () => {
    const probe = fixture.indexOf("async function verifyRlsAndAdvisoryLock");
    const probeEnd = fixture.indexOf("async function insertFixtureMetricRow", probe);
    const probeCall = fixture.indexOf("await verifyRlsAndAdvisoryLock(client, contender);");
    const importerRun = fixture.indexOf("const result = await runImporter");
    const zeroRowsAssertion = fixture.indexOf("Normalized rows survived a staged-import failure");

    expect(probe).toBeGreaterThan(-1);
    expect(fixture.slice(probe, probeEnd)).toContain('await db.query("rollback");');
    expect(fixture.slice(probe, probeEnd)).toContain('await db.query("reset role").catch(() => undefined);');
    expect(fixture.slice(probe, probeEnd)).toContain("from pg_roles where rolname = $1");
    expect(fixture.slice(probe, probeEnd)).toContain("Fixture RLS probe rollback left rows, policy, or restricted role behind");
    expect(probeCall).toBeGreaterThan(-1);
    expect(importerRun).toBeGreaterThan(probeCall);
    expect(zeroRowsAssertion).toBeGreaterThan(importerRun);
  });
});
