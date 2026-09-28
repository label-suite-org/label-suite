import { describe, expect, it } from "vitest";
import {
  compareDecimalStrings,
  deriveFinanceExceptionIdempotencyKey,
  hashRawFinanceEvidence,
  normalizeFinanceTransaction,
} from "./finance-reconciliation-core";

describe("finance reconciliation core", () => {
  it("normalizes source evidence without losing its original shape", () => {
    const input = normalizeFinanceTransaction({
      source_provider: " Bank CSV ",
      account_label: " Operating ",
      external_transaction_id: " bank-1 ",
      occurred_at: "2026-08-01T00:00:00.000Z",
      amount: "120.50000000",
      currency: " dkk ",
      direction: "credit",
      description: "  Royalty receipt  ",
      raw_evidence: { amount: "120.50", reference: "bank-1" },
    });

    expect(input).toMatchObject({
      source_provider: "bank csv",
      account_label: "Operating",
      external_transaction_id: "bank-1",
      amount: "120.5",
      currency: "DKK",
      description: "Royalty receipt",
    });
    expect(input.idempotency_key).toContain("bank csv:Operating");
    expect(hashRawFinanceEvidence(input.raw_evidence)).toHaveLength(64);
  });

  it("keeps decimal comparisons exact at eight fractional places", () => {
    expect(compareDecimalStrings("10.12000000", "10.12")).toBe(0);
    expect(compareDecimalStrings("10.12000001", "10.12")).toBe(1);
    expect(compareDecimalStrings("9.99", "10")).toBe(-1);
  });

  it("preserves whole-number zeros while removing only fractional trailing zeros", () => {
    for (const amount of ["100", "100.00", "100.00000000"]) {
      const normalized = normalizeFinanceTransaction({
        source_provider: "bank", account_label: "Operating",
        occurred_at: "2026-08-01T00:00:00.000Z", amount,
        currency: "DKK", direction: "credit", raw_evidence: {},
      });
      expect(normalized.amount).toBe("100");
    }
  });

  it("derives a stable tenant queue key", () => {
    expect(deriveFinanceExceptionIdempotencyKey("fin_tx_1")).toBe("finance_reconciliation:unmatched:fin_tx_1");
  });

  it("rejects invalid amount precision and currency", () => {
    expect(() => normalizeFinanceTransaction({
      source_provider: "bank",
      account_label: "Operating",
      occurred_at: "2026-08-01T00:00:00.000Z",
      amount: "1.000000001",
      currency: "DKK",
      direction: "debit",
      raw_evidence: {},
    })).toThrow("positive decimal");
    expect(() => normalizeFinanceTransaction({
      source_provider: "bank",
      account_label: "Operating",
      occurred_at: "2026-08-01T00:00:00.000Z",
      amount: "1",
      currency: "DANISH",
      direction: "debit",
      raw_evidence: {},
    })).toThrow("three-letter");
  });
});
