import { describe, expect, it } from "vitest";
import { buildMxdExpenseFollowUpPlan, buildMxdExpenseFollowUpUpdate, canApplyMxdExpenseFollowUp, MXD_NEXT_ACTION } from "./grant-application-evidence-core";

const row = (overrides: Partial<Parameters<typeof buildMxdExpenseFollowUpPlan>[0][number]> = {}) => ({
  id: "application-1", grantName: "Støtte til markedsudvikling", funder: "MXD", outcome: "approved", amountAwarded: 7500, nextAction: null, ...overrides,
});

describe("MXD grant evidence follow-up", () => {
  it("plans only the exact approved 7,500 DKK record", () => {
    expect(buildMxdExpenseFollowUpPlan([row()])).toMatchObject({ status: "update", nextAction: MXD_NEXT_ACTION });
    expect(buildMxdExpenseFollowUpPlan([row({ amountAwarded: 7500.01 })]).status).toBe("not_found");
    expect(buildMxdExpenseFollowUpPlan([row({ outcome: "rejected" })]).status).toBe("not_found");
  });

  it("is idempotent when the follow-up is already recorded", () => {
    expect(buildMxdExpenseFollowUpPlan([row({ nextAction: MXD_NEXT_ACTION })])).toMatchObject({ status: "already_set" });
  });

  it("refuses to choose between multiple exact matches", () => {
    expect(buildMxdExpenseFollowUpPlan([row(), row({ id: "application-2" })]).status).toBe("ambiguous");
  });

  it("rejects a stale apply when the award or grant changes after planning", () => {
    const plan = buildMxdExpenseFollowUpPlan([row({ grantId: "mxd-grant" })]);
    expect(canApplyMxdExpenseFollowUp(plan, row({ grantId: "mxd-grant", amountAwarded: 7501 }))).toBe(false);
    expect(canApplyMxdExpenseFollowUp(plan, row({ grantId: "different-grant" }))).toBe(false);
  });

  it("builds a mutation that changes only next_action for the exact row", () => {
    expect(buildMxdExpenseFollowUpUpdate(row())).toEqual({ next_action: MXD_NEXT_ACTION });
    expect(buildMxdExpenseFollowUpUpdate(row({ funder: "Other funder" }))).toBeNull();
    expect(buildMxdExpenseFollowUpUpdate(row({ amountAwarded: 7501 }))).toBeNull();
  });
});
