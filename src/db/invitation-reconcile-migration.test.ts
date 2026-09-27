import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
const schemaSource = readFileSync(new URL("./schema/grants.ts", import.meta.url), "utf8");

describe("invitation migration reconciliation", () => {
  it("keeps the production-applied deadline migration in order before the reconcile migration", () => {
    const entries = journal.entries.filter((entry: { tag: string }) => ["0045_grant_deadlines_unique", "0046_secure_org_invitations_reconcile"].includes(entry.tag));
    expect(entries).toEqual([
      { idx: 37, version: "7", when: 1783960000000, tag: "0045_grant_deadlines_unique", breakpoints: true },
      { idx: 38, version: "7", when: 1783960000001, tag: "0046_secure_org_invitations_reconcile", breakpoints: true },
    ]);
    expect(readFileSync(new URL("../../drizzle/0045_grant_deadlines_unique.sql", import.meta.url), "utf8"))
      .toContain('CREATE UNIQUE INDEX IF NOT EXISTS "grant_deadlines_org_grant_date_unique_idx"');
  });

  it("is forward-only and idempotently reconciles skipped invitation security", () => {
    const sql = readFileSync(new URL("../../drizzle/0046_secure_org_invitations_reconcile.sql", import.meta.url), "utf8");
    for (const column of ["normalized_email", "token_digest", "invited_by_user_id", "accepted_by_user_id", "revoked_at", "last_sent_at"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`, "i"));
    }
    expect(sql).toMatch(/SET "normalized_email" = lower\(btrim\("email"\)\)\s+WHERE "normalized_email" IS NULL/i);
    expect(sql).toMatch(/WHERE "status" = 'pending'\s+AND "token_digest" IS NULL/i);
    expect(sql).toMatch(/DROP INDEX IF EXISTS "label_suite"\."org_invitations_token_unique_idx"/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS "token"/i);
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/gi)).toHaveLength(2);
    expect(sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS/gi)).toHaveLength(2);
  });
});

describe("recorded grant deadline schema", () => {
  it("maps every column and unique key installed by migration 0045", () => {
    const table = schemaSource.match(/export const grant_deadlines = schema\.table\("grant_deadlines", \{[\s\S]+?\n\]\);/)?.[0] ?? "";
    expect(table).toContain('classification: text("classification").notNull().default("confirmed")');
    expect(table).toContain('source_url: text("source_url")');
    expect(table).toContain('deadline_time: text("deadline_time")');
    expect(table).toContain('timezone: text("timezone").notNull().default("Europe/Copenhagen")');
    expect(table).toContain('uniqueIndex("grant_deadlines_org_grant_date_unique_idx").on(table.org_id, table.grant_id, table.deadline_date)');
  });
});
