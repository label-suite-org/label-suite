import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(new URL("./analytics-sandbox-integration-fixture.ts", import.meta.url), "utf8");

describe("analytics sandbox integration fixture contract", () => {
  it("initializes every declaration before invoking the live fixture entrypoint", () => {
    const expectedCounts = fixture.indexOf("const expectedCounts");
    const cleanup = fixture.indexOf("async function removeTemporaryOrganizationRows");
    const invocation = fixture.lastIndexOf("await main();");

    expect(fixture).toContain("async function main(): Promise<void>");
    expect(expectedCounts).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(expectedCounts);
    expect(invocation).toBeGreaterThan(cleanup);
    expect(fixture.trimEnd().endsWith("await main();")).toBe(true);
  });

  it("accepts only the dedicated local analytics sandbox URL and creates a safe temporary organization", () => {
    expect(fixture).toContain('process.env.ANALYTICS_SANDBOX_DB_URL ?? ""');
    expect(fixture).not.toMatch(/process\.env\.(?!ANALYTICS_SANDBOX_DB_URL)/);
    expect(fixture).toContain('ANALYTICS_SANDBOX_DB_URL: databaseUrl');
    expect(fixture).toContain('ANALYTICS_SANDBOX_ORG_ID: orgId');
    expect(fixture).toContain('analytics-fixture-${randomUUID().replaceAll("-", "")}');
    expect(fixture).toContain("insert into label_suite.orgs");
    expect(fixture).toContain("select current_database() as database_name");
  });

  it("runs the real seed twice with every safety marker and compares exact owned IDs", () => {
    expect(fixture).toContain('["--import", "tsx", "scripts/seed-analytics-sandbox.ts"]');
    expect(fixture).not.toContain("npmExecutable");
    expect(fixture).not.toContain('["run", "analytics:sandbox:seed"]');
    expect((fixture.match(/await runSandboxSeed\(config\)/g) ?? [])).toHaveLength(2);
    for (const marker of ["ANALYTICS_SANDBOX: \"1\"", "ANALYTICS_SANDBOX_DISPOSABLE: \"1\"", "ANALYTICS_SANDBOX_ORG_ID: config.orgId"]) {
      expect(fixture).toContain(marker);
    }
    for (const table of ["artists", "releases", "tracks", "analytics_import_runs", "analytics_metric_rows"]) {
      expect(fixture).toContain(`label_suite.${table}`);
    }
    expect(fixture).toContain("assertExactFixtureState");
    expect(fixture).toContain("assertNoDuplicateIds");
    expect(fixture).toContain("JSON.stringify(first) !== JSON.stringify(second)");
  });

  it("keeps a second organization's identity and fields intact, proves the advisory lock, and cleans only temporary rows", () => {
    expect(fixture).toContain("analytics-sentinel-");
    expect(fixture).toContain("const sentinelBefore = await readSentinelOrganization(client, sentinelOrgId);");
    expect(fixture).toContain("verifySentinelOrganization");
    expect(fixture).toContain("await verifySentinelOrganization(client, sentinelBefore);");
    expect(fixture).toContain("select id, name, slug, plan from label_suite.orgs where id = $1");
    expect(fixture).toContain("sentinel organization was modified by the fixture seed.");
    expect(fixture).toContain("verifyAdvisoryLock");
    expect(fixture).toContain("pg_try_advisory_xact_lock");
    expect(fixture).toContain("label-suite:${fixtureOrgId}:sisense");
    expect(fixture).toContain("removeTemporaryOrganizationRows");
    expect(fixture).toContain("await removeTemporaryOrganizationRows(client, sentinelOrgId);");
    expect(fixture).toContain("delete from label_suite.orgs where id = $1");
    expect(fixture).not.toMatch(/dropdb|drop database|createdb/i);
    expect(fixture).not.toMatch(/SISENSE_|R2_|DOKPLOY_|AWS_|OPENAI_|process\.env\.DATABASE_URL/);
    expect(fixture).not.toContain("...process.env");
  });

  it("removes audit rows created by catalog cleanup before deleting the temporary organization", () => {
    const cleanup = fixture.slice(fixture.indexOf("async function removeTemporaryOrganizationRows"));
    const artists = cleanup.indexOf("delete from label_suite.artists where org_id = $1");
    const auditLogs = cleanup.indexOf("delete from label_suite.audit_logs where org_id = $1");
    const organization = cleanup.indexOf("delete from label_suite.orgs where id = $1");

    expect(artists).toBeGreaterThan(-1);
    expect(auditLogs).toBeGreaterThan(artists);
    expect(organization).toBeGreaterThan(auditLogs);
  });

  it("does not execute cleanup deletes when exact database verification rejects the connection", () => {
    const verification = fixture.indexOf("await verifyDatabaseName(client);");
    const verified = fixture.indexOf("databaseVerified = true;", verification);
    const cleanup = fixture.slice(fixture.indexOf("} finally {"), fixture.indexOf("type FixtureTable"));

    expect(fixture).toContain("let databaseVerified = false;");
    expect(verification).toBeGreaterThan(-1);
    expect(verified).toBeGreaterThan(verification);
    expect(cleanup).toContain("if (databaseVerified)");
    expect(cleanup.indexOf("if (databaseVerified)")).toBeLessThan(cleanup.indexOf("removeTemporaryOrganizationRows"));
  });

  it("runs the isolated real-query probe after the second seed without inheriting provider credentials", () => {
    const secondSeed = fixture.lastIndexOf("await runSandboxSeed(config);");
    const probe = fixture.indexOf("await runAnalyticsQueryProbe(config);");

    expect(fixture).toContain('"scripts/analytics-sandbox-query-probe.ts"');
    expect(probe).toBeGreaterThan(secondSeed);
    expect(probe).toBeLessThan(fixture.indexOf("await verifySentinelOrganization"));
    expect(fixture).toContain("DATABASE_URL: config.databaseUrl");
    expect(fixture).toContain("ANALYTICS_SANDBOX_ORG_ID: config.orgId");
    expect(fixture).not.toContain("...process.env");
  });
});
