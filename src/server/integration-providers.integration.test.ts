import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

it.skipIf(process.env.CI !== "true")("omits WARM from setup while preserving its historical provider record", async () => {
  const target = process.env.DATABASE_URL ?? "";
  assertDisposableReleaseGateTarget({
    databaseUrl: target, ci: process.env.CI,
    fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  const sql = postgres(target, { max: 1 });
  const org = `providers-${randomUUID()}`;
  try {
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Provider test', ${org})`;
    await sql`insert into label_suite.integration_providers (id, org_id, key, name, category) values
      (${org + '-warm'}, ${org}, 'warm', 'WARM', 'radio'),
      (${org + '-spotify'}, ${org}, 'spotify', 'Spotify', 'analytics')`;
    const { listIntegrationProviders } = await import("./integrations");
    expect((await listIntegrationProviders(org)).map(provider => provider.key)).toEqual(["spotify"]);
    expect(await listIntegrationProviders("missing-workspace")).toEqual([]);
    const [stored] = await sql`select count(*)::int as count from label_suite.integration_providers where org_id = ${org}`;
    expect(stored.count).toBe(2);
  } finally {
    await sql`delete from label_suite.integration_providers where org_id = ${org}`;
    await sql`delete from label_suite.audit_logs where org_id = ${org}`;
    await sql`delete from label_suite.orgs where id = ${org}`;
    await sql.end();
  }
});
