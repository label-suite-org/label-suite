import { describe, expect, it } from "vitest";
import { computeClearanceFromRoleRows, type ClearanceRoleRow } from "./readiness-core";

function role(overrides: Partial<ClearanceRoleRow> = {}): ClearanceRoleRow {
  return {
    ownership_type: "Rights",
    scope: "Publishing",
    percent_share: 100,
    clearance_status: "Signed",
    ...overrides,
  };
}

describe("computeClearanceFromRoleRows", () => {
  it("excludes credit-only lines from clearance", () => {
    const result = computeClearanceFromRoleRows([
      role({ ownership_type: "Credit", scope: "Publishing", percent_share: 100 }),
    ]);

    expect(result.pub.progress).toBe(1);
    expect(result.master.progress).toBe(1);
    expect(result.overall).toBe(0);
    expect(result.cleared).toBe(false);
  });

  it("rolls Mechanical scope into Publishing", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Mechanical", percent_share: 100, clearance_status: "Signed" }),
    ]);

    expect(result.pub).toMatchObject({
      enteredTotal: 100,
      weightedTotal: 100,
      progress: 1,
      cleared: true,
    });
    expect(result.overall).toBe(1);
    expect(result.cleared).toBe(true);
  });

  it("does not block on a scope with no Rights lines", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 100, clearance_status: "Signed" }),
    ]);

    expect(result.pub.cleared).toBe(true);
    expect(result.master.progress).toBe(1);
    expect(result.master.cleared).toBe(true);
    expect(result.overall).toBe(1);
    expect(result.cleared).toBe(true);
  });

  it("does not clear when there are no applicable Rights lines", () => {
    const result = computeClearanceFromRoleRows([]);

    expect(result.pub.progress).toBe(1);
    expect(result.master.progress).toBe(1);
    expect(result.overall).toBe(0);
    expect(result.cleared).toBe(false);
  });

  it("does not clear Rights lines that have no usable scope", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: null, percent_share: 100, clearance_status: "Signed" }),
    ]);

    expect(result.pub.progress).toBe(1);
    expect(result.master.progress).toBe(1);
    expect(result.overall).toBe(0);
    expect(result.cleared).toBe(false);
  });

  it("normalizes progress against 100 rather than entered shares", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 50, clearance_status: "Signed" }),
    ]);

    expect(result.pub.enteredTotal).toBe(50);
    expect(result.pub.weightedTotal).toBe(50);
    expect(result.pub.progress).toBe(0.5);
    expect(result.pub.cleared).toBe(false);
    expect(result.cleared).toBe(false);
  });

  it("applies status weights", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 25, clearance_status: "Signed" }),
      role({ scope: "Publishing", percent_share: 25, clearance_status: "Confirmed" }),
      role({ scope: "Publishing", percent_share: 25, clearance_status: "Pending" }),
      role({ scope: "Publishing", percent_share: 25, clearance_status: "Unknown" }),
    ]);

    expect(result.pub.enteredTotal).toBe(100);
    expect(result.pub.weightedTotal).toBe(50);
    expect(result.pub.progress).toBe(0.5);
    expect(result.pub.cleared).toBe(false);
  });

  it("uses the weakest applicable universe as overall progress", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 100, clearance_status: "Signed" }),
      role({ scope: "Master", percent_share: 50, clearance_status: "Signed" }),
    ]);

    expect(result.pub.progress).toBe(1);
    expect(result.master.progress).toBe(0.5);
    expect(result.overall).toBe(0.5);
    expect(result.cleared).toBe(false);
  });

  it("allows progress over 100 percent when a scope is overallocated", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 150, clearance_status: "Signed" }),
    ]);

    expect(result.pub.enteredTotal).toBe(150);
    expect(result.pub.weightedTotal).toBe(150);
    expect(result.pub.progress).toBe(1.5);
    expect(result.pub.cleared).toBe(true);
  });

  it("rounds progress to four decimals", () => {
    const result = computeClearanceFromRoleRows([
      role({ scope: "Publishing", percent_share: 33.33333, clearance_status: "Signed" }),
    ]);

    expect(result.pub.progress).toBe(0.3333);
  });
});
