import type { InferSelectModel } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  royalty_earnings,
  royalty_ledger_entries,
  royalty_payouts,
  royalty_split_lines,
  royalty_statement_lines,
  royalty_statements,
} from "./royalties";

describe("normalized royalty numeric columns", () => {
  it("exposes monetary amounts and percentages as decimal strings at the Drizzle boundary", () => {
    // Break caught: restoring Drizzle `mode: "number"` would reintroduce
    // floating-point values for normalized royalty data.
    const columns = [
      royalty_earnings.percentage,
      royalty_earnings.gross_amount,
      royalty_earnings.fees_amount,
      royalty_earnings.net_amount,
      royalty_split_lines.share_percent,
      royalty_statements.opening_balance,
      royalty_statements.earnings_amount,
      royalty_statements.adjustments_amount,
      royalty_statements.payout_amount,
      royalty_statements.closing_balance,
      royalty_payouts.amount,
      royalty_statement_lines.share_percent,
      royalty_statement_lines.amount,
      royalty_ledger_entries.amount,
    ];

    expect(columns.map((column) => column.dataType)).toEqual(Array(columns.length).fill("string"));
  });

  it("rejects JavaScript-number contracts for normalized royalty values", () => {
    expectTypeOf<InferSelectModel<typeof royalty_earnings>["net_amount"]>().toEqualTypeOf<string>();
    expectTypeOf<InferSelectModel<typeof royalty_statements>["closing_balance"]>().toEqualTypeOf<string>();
    expectTypeOf<InferSelectModel<typeof royalty_payouts>["amount"]>().toEqualTypeOf<string>();
    expectTypeOf<InferSelectModel<typeof royalty_ledger_entries>["amount"]>().toEqualTypeOf<string>();
  });
});
