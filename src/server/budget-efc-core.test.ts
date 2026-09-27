import { describe, expect, it } from "vitest";
import { classifyBudgetBucket, computeLineEfc, rollupBudgetCosts } from "./budget-efc-core";

describe("budget EFC model", () => {
  it("calculates EFC from paid, committed, and remaining forecast", () => {
    expect(computeLineEfc({ planned_amount: 10_000, amount: 10_000, committed_amount: 4_000, paid_amount: 3_000, forecast_amount: 12_000 })).toMatchObject({ efc: 12_000, variance: -2_000, planned: 10_000 });
    expect(computeLineEfc({ planned_amount: null, amount: 10_000, committed_amount: 0, paid_amount: 0, forecast_amount: null })).toMatchObject({ efc: 10_000, variance: 0, planned: 10_000 });
  });

  it("keeps locked contingency out of production and marketing totals", () => {
    expect(classifyBudgetBucket({ categoryType: "production", lockStatus: "locked" })).toBe("contingency");
    expect(classifyBudgetBucket({ categoryType: "production_contingency", lockStatus: "open" })).toBe("production");
    expect(classifyBudgetBucket({ categoryType: "marketing", lockStatus: "open" })).toBe("marketing");
  });

  it("rolls line totals without double counting", () => {
    expect(rollupBudgetCosts([
      { categoryType: "production", lockStatus: "open", planned_amount: 10_000, amount: 10_000, forecast_amount: 12_000, committed_amount: 4_000, paid_amount: 3_000 },
      { categoryType: "marketing", lockStatus: "open", planned_amount: 5_000, amount: 5_000, forecast_amount: 4_000, committed_amount: 1_000, paid_amount: 1_000 },
      { categoryType: "production", lockStatus: "locked", planned_amount: 2_000, amount: 2_000, forecast_amount: 2_000, committed_amount: 0, paid_amount: 0 },
    ])).toMatchObject({ planned: 17_000, efc: 18_000, variance: -1_000, buckets: { production: { planned: 10_000 }, marketing: { planned: 5_000 }, contingency: { planned: 2_000 } } });
  });
});
