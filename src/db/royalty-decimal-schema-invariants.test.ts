import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

const migrationUrl = new URL("../../drizzle/0074_royalty_decimal_schema_invariants.sql", import.meta.url);
const journalUrl = new URL("../../drizzle/meta/_journal.json", import.meta.url);

async function readMigration() {
  expect(existsSync(migrationUrl)).toBe(true);
  return readFile(migrationUrl, "utf8");
}

function exportedTable(name: string) {
  const table = Reflect.get(schema, name);
  expect(table).toBeDefined();
  return table as never;
}

function columnNames(table: never) {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("royalty decimal schema invariants", () => {
  it("journals the additive migration immediately after 0073", async () => {
    const journal = JSON.parse(await readFile(journalUrl, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    const migrationIndex = journal.entries.findIndex((entry) => entry.idx === 66);

    expect(journal.entries.slice(migrationIndex - 1, migrationIndex + 1)).toEqual([
      { idx: 65, version: "7", when: 1786140000014, tag: "0073_campaign_activity_proposal_decisions", breakpoints: true },
      { idx: 66, version: "7", when: 1786140000015, tag: "0074_royalty_decimal_schema_invariants", breakpoints: true },
    ]);
  });

  it("exports the three Phase 1 royalty tables and grouped transaction pointer", () => {
    const currencyTotals = exportedTable("royalty_import_currency_totals");
    const calculationRuns = exportedTable("royalty_calculation_runs");
    const ledgerTransactions = exportedTable("royalty_ledger_transactions");
    const ledgerEntries = exportedTable("royalty_ledger_entries");

    expect(columnNames(currencyTotals)).toEqual(expect.arrayContaining([
      "id", "org_id", "import_id", "currency", "row_count", "gross_total", "fees_total", "net_total", "created_at",
    ]));
    expect(columnNames(calculationRuns)).toEqual(expect.arrayContaining([
      "id", "org_id", "engine_version", "status", "idempotency_key", "approved_by", "approved_at", "reversed_by_run_id", "created_at", "updated_at",
    ]));
    expect(columnNames(ledgerTransactions)).toEqual(expect.arrayContaining([
      "id", "org_id", "idempotency_key", "posting_status", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date", "posted_at", "created_at",
    ]));
    expect(columnNames(ledgerEntries)).toContain("transaction_id");
  });

  it("keeps Phase 1 totals at the decimal-string boundary with deterministic keys and exact states", () => {
    const currencyTotals = getTableConfig(exportedTable("royalty_import_currency_totals"));
    const calculationRuns = getTableConfig(exportedTable("royalty_calculation_runs"));
    const ledgerTransactions = getTableConfig(exportedTable("royalty_ledger_transactions"));
    const imports = getTableConfig(exportedTable("royalty_imports"));
    const statements = getTableConfig(exportedTable("royalty_statements"));
    const payouts = getTableConfig(exportedTable("royalty_payouts"));

    const totalsByName = Object.fromEntries(currencyTotals.columns.map((column) => [column.name, column]));
    expect([totalsByName.gross_total, totalsByName.fees_total, totalsByName.net_total].map((column) => column?.dataType))
      .toEqual(["string", "string", "string"]);

    for (const [config, key] of [
      [currencyTotals, "royalty_import_currency_totals_org_import_currency_unique_idx"],
      [calculationRuns, "royalty_calculation_runs_org_idempotency_unique_idx"],
      [ledgerTransactions, "royalty_ledger_transactions_org_idempotency_unique_idx"],
    ] as const) {
      expect(config.indexes.some((index) => index.config.name === key && index.config.unique)).toBe(true);
    }

    expect(calculationRuns.checks.map((check) => check.name)).toContain("royalty_calculation_runs_status_check");
    expect(ledgerTransactions.checks.map((check) => check.name)).toContain("royalty_ledger_transactions_posting_status_check");
    expect(imports.checks.map((check) => check.name)).toContain("royalty_imports_status_canonical_check");
    expect(statements.checks.map((check) => check.name)).toContain("royalty_statements_status_canonical_check");
    expect(payouts.checks.map((check) => check.name)).toContain("royalty_payouts_status_canonical_check");

    const importCurrency = imports.columns.find((column) => column.name === "currency");
    expect(importCurrency).toMatchObject({ notNull: false, hasDefault: false });
    expect(imports.columns.find((column) => column.name === "status")).toMatchObject({ default: "received" });
    expect(payouts.columns.find((column) => column.name === "status")).toMatchObject({ default: "draft" });
  });

  it("adds only additive migration controls for canonical states, grouped posting, and tenant safety", async () => {
    const migration = await readMigration();

    for (const table of [
      "royalty_import_currency_totals",
      "royalty_calculation_runs",
      "royalty_ledger_transactions",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "label_suite"."${table}"`);
      expect(migration).toContain(`ALTER TABLE "label_suite"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."${table}";`);
      expect(migration).toContain(`CREATE POLICY "tenant_isolation" ON "label_suite"."${table}"`);
      expect(migration).toContain(`DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."${table}";`);
      expect(migration).toContain(`AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."${table}"`);
    }

    expect(migration).toContain('"royalty_import_currency_totals_org_import_currency_unique_idx"');
    expect(migration).toContain('"royalty_calculation_runs_org_idempotency_unique_idx"');
    expect(migration).toContain('"royalty_ledger_transactions_org_idempotency_unique_idx"');
    expect(migration).toMatch(/ALTER TABLE\s+"label_suite"\."royalty_ledger_entries"\s+ADD COLUMN IF NOT EXISTS "transaction_id" text;/i);
    expect(migration).toContain('"royalty_ledger_entries_transaction_id_royalty_ledger_transactions_id_fk"');
    expect(migration).toContain('"royalty_ledger_entries_transaction_idx"');

    expect(migration).toContain('"royalty_calculation_runs_status_check" CHECK ("status" IN (\'draft\', \'approved\', \'reversed\'))');
    expect(migration).toContain('"royalty_ledger_transactions_posting_status_check" CHECK ("posting_status" IN (\'draft\', \'posted\', \'reversed\'))');
    expect(migration).toMatch(/"royalty_imports_status_canonical_check"\s+CHECK \("status" IN \('received', 'parsing', 'parsed', 'failed', 'superseded'\)\) NOT VALID/i);
    expect(migration).toMatch(/"royalty_statements_status_canonical_check"\s+CHECK \("status" IN \('draft', 'calculated', 'reviewed', 'issued', 'closed'\)\) NOT VALID/i);
    expect(migration).toMatch(/"royalty_payouts_status_canonical_check"\s+CHECK \("status" IN \('draft', 'approved', 'recorded', 'failed', 'reversed'\)\) NOT VALID/i);
    expect(migration).toContain('ALTER COLUMN "currency" DROP NOT NULL;');
    expect(migration).toContain('ALTER COLUMN "currency" DROP DEFAULT;');
    expect(migration).toContain('ALTER COLUMN "status" SET DEFAULT \'received\';');
    expect(migration).toContain('ALTER COLUMN "status" SET DEFAULT \'draft\';');
    expect(migration).not.toContain("MIXED");
    expect(migration).not.toMatch(/UPDATE\s+"label_suite"\."royalty_(imports|statements|payouts)"/i);
  });

  it("uses same-org reference hooks for every new table relationship", async () => {
    const migration = await readMigration();

    expect(migration).toContain("'import_id', 'royalty_imports'");
    expect(migration).toContain("'reversed_by_run_id', 'royalty_calculation_runs'");
    expect(migration).toContain("'reversal_of_transaction_id', 'royalty_ledger_transactions'");
    expect(migration).toContain("'transaction_id', 'royalty_ledger_transactions'");
    expect(migration).toContain('CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_import_currency_totals"');
    expect(migration).toContain('CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_calculation_runs"');
    expect(migration).toContain('CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_ledger_transactions"');
    expect(migration).toContain('CREATE TRIGGER "royalty_ledger_entries_transaction_same_org" BEFORE INSERT OR UPDATE OF "transaction_id", "org_id" ON "label_suite"."royalty_ledger_entries"');
  });
});
