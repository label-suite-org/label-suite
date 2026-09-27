import { describe, expect, it } from "vitest";
import {
  REQUIRED_FORCE_RLS_TABLES,
  assertRoyaltyRuntimeAccessPosture,
  assertRoyaltyRuntimePrincipalPosture,
  assertRoyaltyRuntimeTablePosture,
} from "./royalty-runtime-db-posture";

describe("royalty runtime database posture", () => {
  it("covers every Phase 1 tenant financial table", () => {
    // Break caught: omitting an owned tenant table leaves the application
    // principal able to bypass its tenant policy without failing postflight.
    expect(REQUIRED_FORCE_RLS_TABLES).toEqual([
      "royalty_imports",
      "royalty_import_currency_totals",
      "royalty_earnings",
      "royalty_split_snapshots",
      "royalty_split_lines",
      "royalty_calculation_runs",
      "royalty_statements",
      "royalty_payouts",
      "royalty_statement_lines",
      "royalty_ledger_transactions",
      "royalty_ledger_entries",
    ]);
  });

  it("accepts a non-bypass principal before migration", () => {
    expect(() => assertRoyaltyRuntimePrincipalPosture({
      principal: "label_suite_runtime",
      superuser: false,
      bypassRls: false,
    })).not.toThrow();
  });

  it("accepts the complete FORCE-RLS table set after migration", () => {
    expect(() => assertRoyaltyRuntimeTablePosture({
      forceRlsTables: [...REQUIRED_FORCE_RLS_TABLES],
    })).not.toThrow();
  });

  it.each([
    ["superuser", { superuser: true, bypassRls: false }],
    ["BYPASSRLS", { superuser: false, bypassRls: true }],
  ])("rejects a %s application principal", async (_caseName, flags) => {
    expect(() => assertRoyaltyRuntimePrincipalPosture({
      principal: "unsafe_runtime",
      ...flags,
    })).toThrow("cannot enforce royalty tenant RLS");
  });

  it("rejects a financial table without FORCE RLS", () => {
    expect(() => assertRoyaltyRuntimeTablePosture({
      forceRlsTables: REQUIRED_FORCE_RLS_TABLES.filter((table) => table !== "royalty_statements"),
    })).toThrow("royalty_statements");
  });

  it("requires lifecycle entrypoint access without exposing its context table", () => {
    expect(() => assertRoyaltyRuntimeAccessPosture({
      schemaUsage: true,
      establishLifecycleContext: true,
      lifecycleContextTable: false,
    })).not.toThrow();

    expect(() => assertRoyaltyRuntimeAccessPosture({
      schemaUsage: true,
      establishLifecycleContext: true,
      lifecycleContextTable: true,
    })).toThrow("royalty lifecycle context table");
  });
});
