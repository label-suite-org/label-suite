import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

const org = `delivery-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let delivery: typeof import("./delivery-exports");

describe.skipIf(process.env.CI !== "true")("manual delivery on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = process.env.DATABASE_URL ?? "";
    assertDisposableReleaseGateTarget({ databaseUrl: target, ci: process.env.CI,
      fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
      userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
      analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
    sql = postgres(target);
    delivery = await import("./delivery-exports");
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Synthetic delivery',${org})`;
    await sql`insert into label_suite.releases (id,org_id,title) values (${org},${org},'Original title')`;
  });
  afterAll(async () => { await sql?.end(); });

  it("isolates accounts, coalesces concurrent exports and retains previous payloads", async () => {
    const first = await delivery.exportReleaseDelivery(org,org,{account_label:'Account A'});
    const second = await delivery.exportReleaseDelivery(org,org,{account_label:'Account B'});
    expect(first.attempt.id).not.toBe(second.attempt.id);
    expect([first.attempt.patch_version,second.attempt.patch_version]).toEqual([1,1]);
    await sql`update label_suite.releases set title='Corrected title' where id=${org}`;
    const patched = await Promise.all([1,2].map(()=>delivery.exportReleaseDelivery(org,org,{account_label:'Account A'})));
    expect(patched[0].attempt.id).toBe(patched[1].attempt.id);
    expect(patched[0].attempt.patch_version).toBe(2);
    expect(patched[0].payload.release.title).toBe('Corrected title');
    expect(first.payload.release.title).toBe('Original title');
    const history = await delivery.listReleaseDeliveryAttempts(org,org);
    expect(history).toHaveLength(3);
    expect(history.find(row=>row.id===first.attempt.id)?.payload).toEqual(first.payload);
    expect(history.every(row=>row.response_evidence.mode==='manual_export')).toBe(true);
    const warnings = await sql`select status,details from label_suite.data_quality_issues where org_id=${org}`;
    expect(warnings).toHaveLength(2);
    expect(warnings.find(row=>row.details.account_label==='Account A')?.details.attempt_id).toBe(patched[0].attempt.id);
    await sql`update label_suite.releases set upc_ean='012345678905' where id=${org}`;
    await delivery.exportReleaseDelivery(org,org,{account_label:'Account A'});
    const correctedWarnings = await sql`select status,details from label_suite.data_quality_issues where org_id=${org}`;
    expect(correctedWarnings.find(row=>row.details.account_label==='Account A')?.status).toBe('resolved');
    expect(correctedWarnings.find(row=>row.details.account_label==='Account B')?.status).toBe('open');
    expect(await delivery.listReleaseDeliveryAttempts('foreign',org)).toEqual([]);
    await expect(delivery.exportReleaseDelivery('foreign',org,{})).rejects.toMatchObject({status:404});
  });
});
