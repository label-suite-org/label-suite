import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("canonical budget planned amount migration", () => {
  it("backfills planned_amount from the legacy amount without dropping amount yet", async () => {
    const sql = await readFile(new URL("../../drizzle/0048_budget_planned_amount_canonical.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/UPDATE "label_suite"\."budget_line_items"/i);
    expect(sql).toMatch(/planned_amount\"?\s*\)?\s*=\s*\"?amount/i);
    expect(sql).not.toMatch(/DROP COLUMN[\s\S]*amount/i);
  });
});
