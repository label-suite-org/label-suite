import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../drizzle/0047_grant_money_model_backfill.sql", import.meta.url);

describe("grant money model migration", () => {
  it("backfills only lifecycle-bearing grant sources and links them idempotently", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/INSERT INTO "label_suite"\."grant_applications"/i);
    expect(sql).toMatch(/fs\."type"[\s\S]{0,80}'grant'/i);
    expect(sql).toMatch(/application_date|decision_date|grant_amount_received|grant_reporting_due/i);
    expect(sql).toMatch(/NOT EXISTS\s*\([\s\S]*funding_source_id/i);
    expect(sql).toMatch(/legacy-grant-application-/i);
  });

  it("does not drop the legacy columns before the deprecation window", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toMatch(/DROP COLUMN[\s\S]*(application_date|decision_date|grant_amount_received|grant_reporting_due)/i);
  });
});
