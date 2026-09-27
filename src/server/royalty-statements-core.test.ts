import { describe, expect, it } from "vitest";
import { prepareStatementPlans } from "./royalty-statements-core";

function earning(overrides: Partial<Parameters<typeof prepareStatementPlans>[0]["earnings"][number]> = {}) {
  return {
    earningId: "earning-1",
    workId: "work-1",
    reportPeriod: "2026-01",
    currency: "USD",
    netAmount: "1.01000000",
    title: "Track One",
    platform: "Spotify",
    ...overrides,
  };
}

function split(splitLineId: string, contactId: string, sharePercent: string | number) {
  return { splitLineId, contactId, payeeName: contactId, sharePercent };
}

describe("royalty statement preparation", () => {
  it("allocates exact source totals across payee statement lines", () => {
    const result = prepareStatementPlans({
      orgId: "org-a",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      earnings: [earning()],
      splitsByWork: new Map([["work-1", [split("split-a", "contact-a", "60"), split("split-b", "contact-b", "40")]]]),
    });

    expect(result.blockers).toEqual([]);
    expect(result.sourceTotal).toBe("1.01000000");
    expect(result.allocatedTotal).toBe("1.01000000");
    expect(result.reconciliations).toEqual([
      expect.objectContaining({ earningId: "earning-1", sourceAmount: "1.01000000", allocatedAmount: "1.01000000", reconciled: true }),
    ]);
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((plan) => plan.earningsAmount).sort()).toEqual(["0.40400000", "0.60600000"]);
  });

  it("does not allocate earnings when master splits are missing or unbalanced", () => {
    const result = prepareStatementPlans({
      orgId: "org-a",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      earnings: [earning(), earning({ earningId: "earning-2", workId: "work-2" }), earning({ earningId: "earning-3", workId: null })],
      splitsByWork: new Map([
        ["work-1", [split("split-a", "contact-a", "60"), split("split-b", "contact-b", "30")]],
        ["work-2", []],
      ]),
    });

    expect(result.plans).toEqual([]);
    expect(result.blockers).toEqual([
      expect.objectContaining({ earningId: "earning-1", reason: "unbalanced_master_splits" }),
      expect.objectContaining({ earningId: "earning-2", reason: "missing_master_splits" }),
      expect.objectContaining({ earningId: "earning-3", reason: "missing_work" }),
    ]);
    expect(result.allocatedTotal).toBe("0.00000000");
    expect(result.sourceTotal).toBe("3.03000000");
  });

  it("uses a deterministic residual allocation so rounded lines still reconcile", () => {
    const result = prepareStatementPlans({
      orgId: "org-a",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      earnings: [earning({ netAmount: "0.01000000" })],
      splitsByWork: new Map([["work-1", [split("split-a", "contact-a", "33.333333"), split("split-b", "contact-b", "33.333333"), split("split-c", "contact-c", "33.333334")]]]),
    });

    expect(result.reconciliations[0]?.reconciled).toBe(true);
    expect(result.plans.flatMap((plan) => plan.lines).map((line) => line.amount).sort()).toEqual(["0.00333333", "0.00333333", "0.00333334"]);
  });
});
