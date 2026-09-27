import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

async function readOptional(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8").catch(() => "");
}

describe("Sisense track snapshot production fixture contract", () => {
  it("wires the guarded fixture into the migrated disposable PostgreSQL lane", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");

    expect(packageJson.scripts["test:sisense-track-snapshot-import"])
      .toBe("tsx scripts/sisense-track-snapshot-import-fixture.ts");
    expect(workflow).toContain("npm run test:sisense-track-snapshot-import");
    expect(workflow).toContain("ANALYTICS_FIXTURE_DB_URL: postgres://label_suite:label_suite@127.0.0.1:5432/analytics_fixture_ci");
    expect(workflow.indexOf('DATABASE_URL="$ANALYTICS_FIXTURE_DB_URL" npm run db:migrate'))
      .toBeLessThan(workflow.indexOf("npm run test:sisense-track-snapshot-import"));
  });

  it("uses the shipped production adapter after the hard target and migration guards", async () => {
    const fixtureSource = await readOptional("./sisense-track-snapshot-import-fixture.ts");

    expect(fixtureSource).toContain("createProductionSisenseTrackSnapshotService");
    expect(fixtureSource).toContain("ANALYTICS_FIXTURE_DB_URL");
    expect(fixtureSource).toContain("assertDisposableMigratedAnalyticsFixtureTarget");
    expect(fixtureSource).toContain("assertRepositoryMigration0077");
    expect(fixtureSource).toContain("0077_analytics_metric_rows_last_seen_membership");
    expect(fixtureSource).not.toContain("create table");
    expect(fixtureSource).not.toContain("type SisenseTrackSnapshotStore");
    expect(fixtureSource).not.toContain("type SisenseTrackSnapshotTransaction");

    const targetGuard = fixtureSource.indexOf("createGuardedAnalyticsFixturePool({");
    const migrationGuard = fixtureSource.indexOf("await assertRepositoryMigration0077");
    const productionService = fixtureSource.indexOf("createProductionSisenseTrackSnapshotService");
    const firstMutation = fixtureSource.indexOf("await seedFixtureData");

    expect(targetGuard).toBeGreaterThan(-1);
    expect(migrationGuard).toBeGreaterThan(targetGuard);
    expect(firstMutation).toBeGreaterThan(migrationGuard);
    expect(productionService).toBeGreaterThan(migrationGuard);

    const auditCleanup = fixtureSource.indexOf('delete from "label_suite"."audit_logs"');
    const tenantCleanup = fixtureSource.indexOf('delete from "label_suite"."orgs"');
    expect(auditCleanup).toBeGreaterThan(-1);
    expect(tenantCleanup).toBeGreaterThan(auditCleanup);
  });

  it("creates a random organization, artist, and track namespace", async () => {
    const fixtureSource = await readOptional("./sisense-track-snapshot-import-fixture.ts");

    expect(fixtureSource).toContain("randomUUID");
    expect(fixtureSource).toMatch(/org[A-Za-z]*\s*=\s*`[^`]*\$\{randomUUID\(\)\}/);
    expect(fixtureSource).toMatch(/artist[A-Za-z]*\s*=\s*`[^`]*\$\{randomUUID\(\)\}/);
    expect(fixtureSource).toMatch(/track[A-Za-z]*\s*=\s*`[^`]*\$\{randomUUID\(\)\}/);
  });

  it("refuses a database whose repository migration 0077 marker is absent", async () => {
    const fixtureModule = await import("./sisense-track-snapshot-import-fixture").catch(() => ({}));
    const assertMarker = Reflect.get(fixtureModule, "assertRepositoryMigration0077");

    expect(assertMarker).toBeTypeOf("function");
    await expect(assertMarker({
      query: async () => ({ rowCount: 0, rows: [] }),
    })).rejects.toThrow("0077_analytics_metric_rows_last_seen_membership");
  });

  it.each([
    "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?host=production.example",
    "postgresql://fixture:fixture@%2Fvar%2Frun%2Fpostgresql/analytics_fixture_ci",
    "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?hostaddr=203.0.113.10",
    "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?host=127.0.0.1&host=production.example",
    "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci#override",
    "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?application_name=fixture",
  ])("rejects URL override %s before constructing a pool", async (databaseUrl) => {
    const fixtureModule = await import("./sisense-track-snapshot-import-fixture").catch(() => ({}));
    const createPool = Reflect.get(fixtureModule, "createGuardedAnalyticsFixturePool");
    const poolFactory = vi.fn();

    expect(createPool).toBeTypeOf("function");
    if (typeof createPool !== "function") return;
    expect(() => createPool({
      databaseUrl,
      fixtureDb: "1",
      fixtureDisposable: "1",
    }, poolFactory)).toThrow("Refusing migrated fixture target");
    expect(poolFactory).not.toHaveBeenCalled();
  });

  it("asserts failed transactions leave no original run, file, metric row, or metric change", async () => {
    const fixtureSource = await readOptional("./sisense-track-snapshot-import-fixture.ts");

    expect(fixtureSource).toContain("transactionalRunId");
    expect(fixtureSource).toContain("transactionalFileId");
    expect(fixtureSource).toContain("failureRunCount");
    expect(fixtureSource).toContain("failureFileCount");
    expect(fixtureSource).toContain("failureMetricRowCount");
    expect(fixtureSource).toContain("failureMetricChangeCount");
  });

  it("proves imports hold the tenant/source lock while private provenance is archived", async () => {
    const fixtureSource = await readOptional("./sisense-track-snapshot-import-fixture.ts");

    expect(fixtureSource).toContain("pg_try_advisory_xact_lock");
    expect(fixtureSource).toContain("label-suite:${orgId}:sisense");
    expect(fixtureSource).toContain("lockProofs");
  });

  it("derives private failure evidence from the seeded identity without public preview rows", async () => {
    const fixtureSource = await readOptional("./sisense-track-snapshot-import-fixture.ts");

    expect(fixtureSource).toContain("`artist:${namespace.artistFailure}:track:${namespace.trackFailure}`");
    expect(fixtureSource).not.toContain("failurePreview.rows");
    expect(fixtureSource).not.toContain("rawRow");
  });
});
