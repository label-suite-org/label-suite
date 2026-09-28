import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableReleaseGateTarget } from "../../../../scripts/release-gate-fixture-safety";

let sql: ReturnType<typeof postgres>;
const org = `stem-repeat-${randomUUID()}`;

describe.skipIf(process.env.CI !== "true")("STEM import on disposable PostgreSQL", () => {
  beforeAll(async () => {
    assertDisposableReleaseGateTarget({ databaseUrl: process.env.DATABASE_URL ?? "", ci: process.env.CI,
      fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
      userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
      analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
    sql = postgres(process.env.DATABASE_URL!);
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Synthetic STEM repeat',${org})`;
  });
  afterAll(async () => { await sql?.end(); });

  it("returns duplicate success for simultaneous identical imports and preserves source rows", async () => {
    const { POST } = await import("./import-stem");
    const headers = Array.from({ length: 25 }, (_, i) => `column_${i}`);
    const row = (amount: string) => {
      const cells = Array<string>(25).fill("");
      cells[5] = "EPAY"; cells[8] = "ZZTEST2600001"; cells[11] = "Synthetic recording";
      cells[16] = "2026"; cells[17] = "8"; cells[22] = "1"; cells[23] = "100"; cells[24] = amount;
      return cells;
    };
    const csv = [headers, row("0.1"), row("0.2")].map(cells => cells.join(",")).join("\n");
    const upload = () => {
      const body = new FormData();
      body.set("file", new File([csv], "fixture.csv", { type: "text/csv" }));
      return POST({ locals: { orgId: org, membershipRole: "operator" },
        request: new Request("http://localhost/api/royalties/import-stem", { method: "POST", body }),
      } as Parameters<typeof POST>[0]);
    };
    const responses = await Promise.all([upload(), upload()]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const duplicate = responses.find(response => response.status === 200)!;
    expect(await duplicate.json()).toMatchObject({ duplicate: true, rows_imported: 2 });
    expect((await upload()).status).toBe(200);
    const imports = await sql`select id,currency,period_start::text,period_end::text from label_suite.royalty_imports where org_id=${org}`;
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ currency: "USD", period_start: "2026-08-01", period_end: "2026-08-31" });
    const rows = await sql`select import_id,source_row_id,raw_data,report_period,currency,net_amount from label_suite.royalty_earnings where org_id=${org} order by net_amount`;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.source_row_id)).size).toBe(2);
    expect(rows.map(row => row.net_amount)).toEqual(["0.10000000", "0.20000000"]);
    rows.forEach((row, i) => {
      expect(row).toMatchObject({ import_id: imports[0].id, report_period: "2026-08", currency: "USD" });
      expect(row.raw_data.column_24).toBe(i ? "0.2" : "0.1");
    });
    expect(await sql`select net_total from label_suite.royalty_import_currency_totals where org_id=${org}`).toEqual([{ net_total: "0.30000000" }]);
    expect(await sql`select id from label_suite.royalties_revenue where org_id=${org}`).toHaveLength(1);
  });
});
