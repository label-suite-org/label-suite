import { describe, expect, it } from "vitest";
import {
  assertRoyaltyLifecycleTransition,
  canTransitionRoyaltyLifecycle,
  royaltyLifecycleDefinitions,
} from "./royalty-lifecycle";

describe("royalty lifecycle transition contract", () => {
  it.each([
    ["import", "received", "parsing"],
    ["import", "parsing", "parsed"],
    ["import", "parsing", "failed"],
    ["import", "parsed", "superseded"],
    ["calculationRun", "draft", "approved"],
    ["calculationRun", "approved", "reversed"],
    ["statement", "draft", "calculated"],
    ["statement", "calculated", "reviewed"],
    ["statement", "reviewed", "issued"],
    ["statement", "issued", "closed"],
    ["payout", "draft", "approved"],
    ["payout", "approved", "recorded"],
    ["payout", "draft", "failed"],
    ["payout", "approved", "failed"],
    ["payout", "recorded", "reversed"],
    ["ledgerTransaction", "draft", "posted"],
    ["ledgerTransaction", "posted", "reversed"],
  ] as const)("allows the canonical %s transition from %s to %s", (entity, from, to) => {
    // Break caught: permissive state handling lets a financial record skip a
    // review or move backward after it has become authoritative.
    expect(canTransitionRoyaltyLifecycle(entity, from, to)).toBe(true);
    expect(() => assertRoyaltyLifecycleTransition(entity, from, to)).not.toThrow();
  });

  it.each([
    ["import", "received", "parsed"],
    ["import", "parsed", "parsing"],
    ["import", "superseded", "received"],
    ["calculationRun", "draft", "reversed"],
    ["calculationRun", "reversed", "approved"],
    ["statement", "draft", "reviewed"],
    ["statement", "issued", "reviewed"],
    ["statement", "closed", "issued"],
    ["payout", "draft", "recorded"],
    ["payout", "approved", "reversed"],
    ["payout", "failed", "approved"],
    ["payout", "reversed", "recorded"],
    ["ledgerTransaction", "draft", "reversed"],
    ["ledgerTransaction", "reversed", "posted"],
  ] as const)("rejects skipped, backward, and terminal %s transitions from %s to %s", (entity, from, to) => {
    expect(canTransitionRoyaltyLifecycle(entity, from, to)).toBe(false);
    expect(() => assertRoyaltyLifecycleTransition(entity, from, to)).toThrow(
      `Invalid ${entity} lifecycle transition: ${from} -> ${to}`,
    );
  });

  it("rejects unknown lifecycle entities and states", () => {
    expect(() => assertRoyaltyLifecycleTransition("unknown", "draft", "posted")).toThrow("Unknown royalty lifecycle entity");
    expect(() => assertRoyaltyLifecycleTransition("payout", "scheduled", "recorded")).toThrow("Unknown payout lifecycle state: scheduled");
    expect(() => assertRoyaltyLifecycleTransition("payout", "draft", "paid")).toThrow("Unknown payout lifecycle state: paid");
  });

  it("publishes the exact canonical status sets for database trigger parity", () => {
    expect(royaltyLifecycleDefinitions).toEqual({
      import: {
        states: ["received", "parsing", "parsed", "failed", "superseded"],
        transitions: [["received", "parsing"], ["parsing", "parsed"], ["parsing", "failed"], ["parsed", "superseded"]],
      },
      calculationRun: {
        states: ["draft", "approved", "reversed"],
        transitions: [["draft", "approved"], ["approved", "reversed"]],
      },
      statement: {
        states: ["draft", "calculated", "reviewed", "issued", "closed"],
        transitions: [["draft", "calculated"], ["calculated", "reviewed"], ["reviewed", "issued"], ["issued", "closed"]],
      },
      payout: {
        states: ["draft", "approved", "recorded", "failed", "reversed"],
        transitions: [["draft", "approved"], ["approved", "recorded"], ["draft", "failed"], ["approved", "failed"], ["recorded", "reversed"]],
      },
      ledgerTransaction: {
        states: ["draft", "posted", "reversed"],
        transitions: [["draft", "posted"], ["posted", "reversed"]],
      },
    });
  });
});
