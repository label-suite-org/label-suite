import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const database = vi.hoisted(() => {
  const results: unknown[][] = [];
  const selections: unknown[] = [];
  const select = vi.fn((selection: unknown) => {
    selections.push(selection);
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      groupBy: () => chain,
      then: <T>(onfulfilled?: (value: unknown[]) => T | PromiseLike<T>, onrejected?: (reason: unknown) => T | PromiseLike<T>) =>
        Promise.resolve(results.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  });
  return { results, selections, select };
});

vi.mock("../lib/db", () => ({ db: { select: database.select } }));

import { getRoyaltyPipelineSummary, listUnmatchedRoyaltyEarnings } from "./royalty-ledger";

describe("royalty ledger query boundary", () => {
  beforeEach(() => {
    database.results.length = 0;
    database.selections.length = 0;
    database.select.mockClear();
  });

  it("returns decimal-string zero values when normalized aggregate queries have no rows", async () => {
    // Break caught: numeric fallbacks allow JavaScript numbers back into the
    // normalized ledger summary when an organization has no royalty rows.
    database.results.push([], [], [], [], []);

    const summary = await getRoyaltyPipelineSummary("org-1");

    expect(summary.earnings).toMatchObject({ netAmount: "0" });
    expect(summary.statements).toMatchObject({ closingBalance: "0" });
    expect(summary.payouts).toMatchObject({ recordedAmount: "0", outstandingAmount: "0" });
    expect(summary.balances).toEqual([]);
  });

  it("preserves driver decimal strings for aggregate and unmatched normalized values", async () => {
    // Break caught: coercing a query result with Number() would round this
    // value before the read-only UI can display it.
    database.results.push(
      [{ rowCount: 1, matchedCount: 0, unmatchedCount: 1, netAmount: "9007199254740993.12345678" }],
      [],
      [{ count: 0, openCount: 0, closingBalance: "0" }],
      [{ count: 0, recordedAmount: "0", outstandingAmount: "0" }],
      [{ contactId: "contact-1", contactName: "Ada", currency: "USD", balance: "0.00000001" }],
    );

    const summary = await getRoyaltyPipelineSummary("org-1");
    database.results.push([{ id: "earning-1", netAmount: "9007199254740993.12345678", currency: "USD" }]);
    const unmatched = await listUnmatchedRoyaltyEarnings("org-1");

    expect(summary.earnings.netAmount).toBe("9007199254740993.12345678");
    expect(summary.balances[0]?.balance).toBe("0.00000001");
    expect(unmatched[0]?.netAmount).toBe("9007199254740993.12345678");
  });

  it("has string result types for normalized monetary query values", () => {
    expectTypeOf<Awaited<ReturnType<typeof getRoyaltyPipelineSummary>>["earnings"]["netAmount"]>().toEqualTypeOf<string>();
    expectTypeOf<Awaited<ReturnType<typeof getRoyaltyPipelineSummary>>["statements"]["closingBalance"]>().toEqualTypeOf<string>();
    expectTypeOf<Awaited<ReturnType<typeof getRoyaltyPipelineSummary>>["payouts"]["recordedAmount"]>().toEqualTypeOf<string>();
    expectTypeOf<Awaited<ReturnType<typeof listUnmatchedRoyaltyEarnings>>[number]["netAmount"]>().toEqualTypeOf<string>();
  });

  it("uses only canonical payout states for outstanding and recorded summary totals", async () => {
    // Break caught: a carry-forward paid/scheduled/processing query makes the
    // summary disagree with the Phase 1 payout state machine.
    database.results.push([], [], [], [], []);

    await getRoyaltyPipelineSummary("org-1");

    const selection = database.selections[3] as Record<string, SQL>;
    expect(selection).toHaveProperty("recordedAmount");
    expect(selection).toHaveProperty("outstandingAmount");

    const dialect = new PgDialect();
    const recordedSql = dialect.sqlToQuery(selection.recordedAmount).sql;
    const outstandingSql = dialect.sqlToQuery(selection.outstandingAmount).sql;

    expect(recordedSql).toContain("'recorded'");
    expect(recordedSql).not.toMatch(/'paid'|'scheduled'|'processing'/);
    expect(outstandingSql).toContain("'draft'");
    expect(outstandingSql).toContain("'approved'");
    expect(outstandingSql).not.toMatch(/'paid'|'scheduled'|'processing'|'failed'|'reversed'/);
  });
});
