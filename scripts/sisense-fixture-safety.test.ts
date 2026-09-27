import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertDisposableAnalyticsFixtureTarget,
  assertDisposableForcedFailureTarget,
  assertDisposableMigratedAnalyticsFixtureTarget,
} from "./sisense-fixture-safety";

describe("Sisense forced-failure fixture safety", () => {
  it("accepts only the explicit local disposable database and schema contract", () => {
    expect(() => assertDisposableForcedFailureTarget({
      databaseUrl: "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_task4",
      schema: "analytics_fixture_task4",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).not.toThrow();
    expect(() => assertDisposableForcedFailureTarget({
      databaseUrl: "postgresql://fixture:fixture@database/analytics_fixture_ci",
      schema: "analytics_fixture_ci",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).not.toThrow();
  });

  it("rejects production-like targets even when callers supply every marker", () => {
    expect(() => assertDisposableForcedFailureTarget({
      databaseUrl: "postgresql://production.example/label_suite",
      schema: "analytics_fixture_task4",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).toThrow("Refusing fixture target");
    expect(() => assertDisposableAnalyticsFixtureTarget({
      databaseUrl: "postgresql://127.0.0.1/analytics_fixture_task4",
      schema: "label_suite",
    })).toThrow("Refusing fixture target");
  });

  it("guards a migrated analytics fixture database without accepting a production schema target", () => {
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl: "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).not.toThrow();
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl: "postgresql://fixture:fixture@database.example/analytics_fixture_ci",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).toThrow("Refusing migrated fixture target");
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl: "postgresql://fixture:fixture@127.0.0.1/label_suite",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).toThrow("Refusing migrated fixture target");
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl: "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci",
      fixtureDb: "1",
      fixtureDisposable: undefined,
    })).toThrow("ANALYTICS_FIXTURE_DB=1 and ANALYTICS_FIXTURE_DISPOSABLE=1");
  });

  it.each([
    ["host override", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?host=production.example"],
    ["hostaddr override", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?hostaddr=203.0.113.10"],
    ["multiple host parameters", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?host=127.0.0.1&host=production.example"],
    ["TLS override", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?sslmode=require"],
    ["ordinary query parameter", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci?application_name=fixture"],
    ["fragment", "postgresql://fixture:fixture@127.0.0.1/analytics_fixture_ci#host=production.example"],
    ["encoded Unix socket host", "postgresql://fixture:fixture@%2Fvar%2Frun%2Fpostgresql/analytics_fixture_ci"],
  ])("rejects a migrated fixture URL with a %s", (_label, databaseUrl) => {
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl,
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).toThrow("Refusing migrated fixture target");
  });

  it.each([
    ["missing user", "postgresql://127.0.0.1:5432/analytics_fixture_ci"],
    ["unexpected port", "postgresql://fixture:fixture@127.0.0.1:6543/analytics_fixture_ci"],
  ])("rejects a migrated fixture URL with %s", (_label, databaseUrl) => {
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl,
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).toThrow("Refusing migrated fixture target");
  });

  it("accepts an explicit PostgreSQL port and decoded non-empty fixture user", () => {
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({
      databaseUrl: "postgresql://fixture:fixture@localhost:5432/analytics_fixture_local",
      fixtureDb: "1",
      fixtureDisposable: "1",
    })).not.toThrow();
  });

  it("accepts the dedicated loopback CI port while rejecting that port on other hosts", () => {
    const target = { databaseUrl: "postgresql://fixture:fixture@127.0.0.1:55432/analytics_fixture_ci", fixtureDb: "1", fixtureDisposable: "1" };
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget(target)).not.toThrow();
    expect(() => assertDisposableMigratedAnalyticsFixtureTarget({ ...target, databaseUrl: "postgresql://fixture:fixture@production.example:55432/analytics_fixture_ci" })).toThrow();
  });

  it("checks the target contract before the importer can query or mutate", () => {
    const importer = readFileSync(new URL("./sisense-sync.ts", import.meta.url), "utf8");
    const seamCheck = importer.indexOf("assertForcedFailureSeamTarget();");
    const firstDatabaseQuery = importer.indexOf("successfulRunExists(pool, orgId)");
    const firstDatabaseConnection = importer.indexOf("const client = pool ? await pool.connect() : null;");

    expect(seamCheck).toBeGreaterThan(-1);
    expect(firstDatabaseQuery).toBeGreaterThan(-1);
    expect(firstDatabaseConnection).toBeGreaterThan(-1);
    expect(seamCheck).toBeLessThan(firstDatabaseQuery);
    expect(seamCheck).toBeLessThan(firstDatabaseConnection);
  });
});
