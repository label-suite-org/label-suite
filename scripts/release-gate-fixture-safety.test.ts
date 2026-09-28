import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { assertDisposableReleaseGateTarget } from "./release-gate-fixture-safety";

const credentials = {
  fixtureDisposable: "1",
  userEmail: "release-gate@example.test",
  userPassword: "ReleaseGatePass123!",
} as const;

describe("release-gate fixture target safety", () => {
  test("accepts the explicit disposable CI database contract", () => {
    expect(assertDisposableReleaseGateTarget({
      ...credentials,
      databaseUrl: "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite",
      ci: "true",
      analyticsFixtureDb: "1",
      analyticsFixtureDisposable: "1",
    })).toEqual({ mode: "ci", host: "127.0.0.1", database: "label_suite" });
  });

  test.each([
    "postgres://label_suite:label_suite@localhost:5432/label_suite_release_gate",
    "postgresql://label_suite:label_suite@postgres:5432/label_suite_release_gate_task_7",
    "postgres://label_suite:label_suite@database:5432/label_suite_release_gate_20260805",
  ])("accepts a clearly named disposable local database on an allowlisted host: %s", (databaseUrl) => {
    expect(assertDisposableReleaseGateTarget({ ...credentials, databaseUrl })).toMatchObject({ mode: "local" });
  });

  test("rejects a production-like host even when every marker is present", () => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      databaseUrl: "postgres://label_suite:label_suite@database.example.com/label_suite",
      ci: "true",
      analyticsFixtureDb: "1",
      analyticsFixtureDisposable: "1",
    })).toThrow("Refusing release-gate fixture target");
  });

  test("requires the explicit release-gate disposable marker", () => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      fixtureDisposable: undefined,
      databaseUrl: "postgres://label_suite:label_suite@localhost/label_suite_release_gate",
    })).toThrow("RELEASE_GATE_FIXTURE_DISPOSABLE=1");
  });

  test.each([
    { userEmail: "", userPassword: credentials.userPassword },
    { userEmail: "   ", userPassword: credentials.userPassword },
    { userEmail: credentials.userEmail, userPassword: "" },
    { userEmail: credentials.userEmail, userPassword: "   " },
  ])("requires explicit nonempty fixture credentials: %o", (overrides) => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      ...overrides,
      databaseUrl: "postgres://label_suite:label_suite@localhost/label_suite_release_gate",
    })).toThrow("explicit nonempty E2E_USER_EMAIL and E2E_USER_PASSWORD");
  });

  test("rejects the generic label_suite database outside CI", () => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      databaseUrl: "postgres://label_suite:label_suite@127.0.0.1/label_suite",
    })).toThrow("Refusing release-gate fixture target");
  });

  test("requires both analytics fixture markers for the CI label_suite database", () => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      databaseUrl: "postgres://label_suite:label_suite@127.0.0.1/label_suite",
      ci: "true",
      analyticsFixtureDb: "1",
    })).toThrow("Refusing release-gate fixture target");
  });

  test("does not permit a locally named database under the CI contract", () => {
    expect(() => assertDisposableReleaseGateTarget({
      ...credentials,
      databaseUrl: "postgres://label_suite:label_suite@127.0.0.1/label_suite_release_gate_ci",
      ci: "true",
      analyticsFixtureDb: "1",
      analyticsFixtureDisposable: "1",
    })).toThrow("Refusing release-gate fixture target");
  });

  test.each([
    "mysql://label_suite:label_suite@localhost/label_suite_release_gate",
    "not a database URL",
  ])("rejects non-PostgreSQL or malformed URLs: %s", (databaseUrl) => {
    expect(() => assertDisposableReleaseGateTarget({ ...credentials, databaseUrl })).toThrow("Refusing release-gate fixture target");
  });

  test("keeps the direct seed guard before the first mutation-capable call", () => {
    const seed = readFileSync(new URL("./seed-release-gate-fixtures.ts", import.meta.url), "utf8");
    const main = seed.slice(seed.indexOf("async function main()"));
    expect(main.indexOf("assertDisposableReleaseGateTarget(")).toBeGreaterThan(-1);
    expect(main.indexOf("assertDisposableReleaseGateTarget(")).toBeLessThan(main.indexOf("ensureFixtureUser()"));
  });

  test("keeps owner and read-only fixture identities distinct and idempotent", () => {
    const seed = readFileSync(new URL("./seed-release-gate-fixtures.ts", import.meta.url), "utf8");
    const ensureUser = seed.slice(seed.indexOf("async function ensureFixtureUser"), seed.indexOf("async function ensureTrueNatureOrg"));
    const main = seed.slice(seed.indexOf("async function main()"));

    expect(seed).toContain("const READ_ONLY_FIXTURE_USER = releaseGateFixtureWorld.readOnlyUser;");
    expect(ensureUser).toContain("const existing = await findUserByEmail(user.email);");
    expect(ensureUser).toContain("const created = await findUserByEmail(user.email);");
    expect(ensureUser).toContain("if (existing) return existing.id;");
    expect(main).toContain("const userId = await ensureFixtureUser();");
    expect(main).toContain("const readOnlyUserId = await ensureFixtureUser(READ_ONLY_FIXTURE_USER);");
    expect(main).toContain('await ensureTrueNatureOrg(userId);');
    expect(main).toContain('await ensureTrueNatureOrg(readOnlyUserId, "member");');
    expect(seed).toContain("onConflictDoUpdate({");
    expect(seed).toContain("set: { role },");
    expect(main.match(/await verifyMembership\(/g)).toHaveLength(2);
  });

  test("sets the explicit non-secret release-gate marker in CI", () => {
    const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
    expect(workflow).toContain('CI: "true"');
    expect(workflow).toContain('RELEASE_GATE_FIXTURE_DISPOSABLE: "1"');
  });
});
