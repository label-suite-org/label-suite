import { describe, expect, it } from "vitest";
import { canEditBudgetCosts } from "./budget-mutations";

describe("budget edit permissions", () => {
  it("allows cost edits on unlocked lines and requires approval for locked lines", () => {
    expect(canEditBudgetCosts("open", false)).toBe(true);
    expect(canEditBudgetCosts("approval_required", false)).toBe(false);
    expect(canEditBudgetCosts("locked", false)).toBe(false);
    expect(canEditBudgetCosts("locked", true)).toBe(true);
  });
});
