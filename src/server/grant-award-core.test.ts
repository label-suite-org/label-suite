import { describe, expect, it } from "vitest";
import { allocateAwardProportionally, reportingTaskForAward } from "./grant-award-core";

describe("grant award helpers", () => {
  it("prefills an award proportionally and keeps the total exact", () => {
    expect(allocateAwardProportionally(50_000, [
      { fundingNeedId: "need-1", amountRequested: 30_000 },
      { fundingNeedId: "need-2", amountRequested: 10_000 },
    ])).toEqual([
      { fundingNeedId: "need-1", amountAwarded: 37_500 },
      { fundingNeedId: "need-2", amountAwarded: 12_500 },
    ]);
  });

  it("creates the reporting task fourteen days before the due date", () => {
    expect(reportingTaskForAward("2027-02-15")).toEqual({ nextAction: "Submit funder report", nextActionDue: "2027-02-01" });
    expect(reportingTaskForAward(null)).toBeNull();
  });
});
