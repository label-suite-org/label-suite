import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importer = vi.hoisted(() => {
  const calls: Array<{ query: string; values?: unknown[] }> = [];
  const record = (query: string, values?: unknown[]) => {
    calls.push({ query, values });
    return { rows: [] };
  };

  class Pool {
    async query(query: string, values?: unknown[]) {
      return record(query, values);
    }

    async connect() {
      return {
        query: async (query: string, values?: unknown[]) => record(query, values),
        release: () => undefined,
      };
    }

    async end() {
      return undefined;
    }
  }

  return { calls, Pool };
});

const source = vi.hoisted(() => ({
  records: [] as Array<{ id: string; fields: Record<string, unknown> }>,
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("pg", () => ({ Pool: importer.Pool }));

const originalArgv = process.argv;
const originalApiKey = process.env.AIRTABLE_API_KEY;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  importer.calls.length = 0;
  source.records = [{
    id: "rec-1",
    fields: {
      percentage: "12.34",
      net_earnings: "9007199254740993.12345678",
      currency: "USD",
    },
  }];
  vi.resetModules();
  process.argv = ["node", "royalty-sheet-import.ts", "--apply", "--max-records", "1"];
  process.env.AIRTABLE_API_KEY = "test-token";
  process.env.DATABASE_URL = "postgres://test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    records: source.records,
  }), { status: 200 })));
});

async function importRecords(records: Array<{ id: string; fields: Record<string, unknown> }>) {
  source.records = records;
  process.argv = ["node", "royalty-sheet-import.ts", "--apply", "--max-records", String(records.length || 1)];
  await import("./royalty-sheet-import.ts");
}

function normalizedWriteCalls() {
  return importer.calls.filter((call) => call.query.includes("label_suite.royalty_imports") || call.query.includes("label_suite.royalty_earnings"));
}

afterEach(() => {
  process.argv = originalArgv;
  if (originalApiKey == null) delete process.env.AIRTABLE_API_KEY;
  else process.env.AIRTABLE_API_KEY = originalApiKey;
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  vi.unstubAllGlobals();
});

describe("royalty sheet provenance import", () => {
  it("writes exact decimals while advancing a new import through canonical states", async () => {
    // Break caught: numeric parameter values round high-precision Airtable
    // data, while an advanced-state INSERT bypasses the database lifecycle.
    await import("./royalty-sheet-import.ts");

    const earningsWrite = importer.calls.find((call) => call.query.includes("insert into label_suite.royalty_earnings"));
    const importWrite = importer.calls.find((call) => call.query.includes("insert into label_suite.royalty_imports"));
    const tenantContextIndex = importer.calls.findIndex((call) => call.query.includes("set_config('app.current_org_id'"));
    const earningsWriteIndex = importer.calls.indexOf(earningsWrite!);

    expect(tenantContextIndex).toBeGreaterThan(-1);
    expect(tenantContextIndex).toBeLessThan(earningsWriteIndex);
    expect(earningsWrite?.values?.[12]).toBe("12.340000");
    expect(earningsWrite?.values?.[13]).toBe("9007199254740993.12345678");
    expect(importWrite?.query).toContain("'received'");
    expect(importWrite?.query).toContain("royalty_imports.status = 'completed'");
    expect(importWrite?.query).toContain("royalty_imports.id ~ '^royalty_import_[0-9a-f]{24}$'");
    expect(importWrite?.query).not.toContain("royalty_imports.id like 'royalty_import_%'");
    const lifecycleWrites = importer.calls
      .filter((call) => call.query.includes("update label_suite.royalty_imports"))
      .map((call) => call.query.replace(/\s+/g, " ").trim());
    expect(lifecycleWrites).toEqual([
      expect.stringContaining("set status = 'parsing'"),
      expect.stringContaining("set status = 'parsed'"),
    ]);
  });

  it("rejects Airtable JSON-number earnings before a normalized import write", async () => {
    // Break caught: String(number) makes a rounded JSON value look like an
    // authoritative source amount at the normalized database boundary.
    await expect(importRecords([{
      id: "rec-lossy-number",
      fields: { net_earnings: 999999999999.12345678, currency: "USD" },
    }])).rejects.toThrow("net_earnings must be supplied as a decimal string");

    expect(normalizedWriteCalls()).toEqual([]);
  });

  it.each([
    ["null", null],
    ["blank", ""],
    ["absent", undefined],
    ["malformed", "not-a-decimal"],
    ["over-scale", "1.000000000"],
  ])("rejects %s net_earnings before a normalized import write", async (_caseName, netEarnings) => {
    // Break caught: treating a missing amount as zero invents a normalized
    // financial value, while malformed input must fail before any insert.
    await expect(importRecords([{
      id: `rec-invalid-${_caseName}`,
      fields: { net_earnings: netEarnings, currency: "USD" },
    }])).rejects.toThrow(`rec-invalid-${_caseName}`);

    expect(normalizedWriteCalls()).toEqual([]);
  });

  it("rejects mixed canonical currencies before a normalized import write", async () => {
    // Break caught: treating an EUR row as USD lets a mixed-currency source
    // batch reach the normalized ledger with an invented cross-currency total.
    await expect(importRecords([
      { id: "rec-usd", fields: { net_earnings: "1.00000000", currency: "USD" } },
      { id: "rec-eur", fields: { net_earnings: "2.00000000", currency: "EUR" } },
    ])).rejects.toThrow("Money currency mismatch");

    expect(normalizedWriteCalls()).toEqual([]);
  });

  it("sums large canonical amounts and a negative adjustment exactly in the CLI summary", async () => {
    // Break caught: Decimal's default precision rounds this 21-significant-
    // digit total, losing the smallest amount and negative adjustment.
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await importRecords([
      { id: "rec-large-1", fields: { net_earnings: "999999999999.99999999", currency: "USD" } },
      { id: "rec-large-2", fields: { net_earnings: "999999999999.99999999", currency: "USD" } },
      { id: "rec-adjustment", fields: { net_earnings: "-0.00000001", currency: "USD" } },
    ]);

    const summaryLog = log.mock.calls.find(([value]) => typeof value === "string" && value.includes('"netTotal"'))?.[0];
    const summary = JSON.parse(String(summaryLog)) as { netTotal: string };
    const earningsWrite = importer.calls.find((call) => call.query.includes("insert into label_suite.royalty_earnings"));

    expect(summary.netTotal).toBe("1999999999999.99999997");
    expect(earningsWrite?.values?.[63]).toBe("-0.00000001");
  });
});
