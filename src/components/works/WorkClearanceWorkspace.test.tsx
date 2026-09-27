import { describe, expect, it } from "vitest";
import {
  buildNextFixes,
  getWorkClearanceDisplay,
  parseWorkClearanceRoute,
  summarizeScope,
  workClearanceFocusIds,
} from "./WorkClearanceWorkspace";

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    ownership_type: "Rights",
    scope: "Publishing",
    percent_share: 100,
    clearance_status: "Signed",
    ...overrides,
  };
}

describe("WorkClearanceWorkspace clearance display", () => {
  it("normalizes incomplete draft rows without inventing clearance", () => {
    expect(getWorkClearanceDisplay([{}])).toEqual({ progress: 0, cleared: false });
    expect(getWorkClearanceDisplay([{ scope: "Publishing" }])).toEqual({ progress: 0, cleared: false });
  });

  it("does not halve or block a cleared publishing-only work", () => {
    expect(getWorkClearanceDisplay([
      role(),
    ])).toEqual({ progress: 100, cleared: true });
  });

  it("clears a master-only work without requiring publishing", () => {
    expect(getWorkClearanceDisplay([
      role({ scope: "Master" }),
    ])).toEqual({ progress: 100, cleared: true });
  });

  it("does not clear empty or credit-only work", () => {
    expect(getWorkClearanceDisplay([])).toEqual({ progress: 0, cleared: false });
    expect(getWorkClearanceDisplay([
      role({ ownership_type: "Credit" }),
    ])).toEqual({ progress: 0, cleared: false });
  });

  it("uses canonical weighted progress for a synthetic 94-percent mixed scope", () => {
    expect(getWorkClearanceDisplay([
      role({ percent_share: 75, clearance_status: "Signed" }),
      role({ percent_share: 25, clearance_status: "Confirmed" }),
    ])).toEqual({ progress: 94, cleared: false });
  });

  it("keeps canonical overallocated progress and clearance", () => {
    expect(getWorkClearanceDisplay([
      role({ percent_share: 150 }),
    ])).toEqual({ progress: 150, cleared: true });
  });
});

describe("WorkClearanceWorkspace scope and next-fix helpers", () => {
  it("renders an empty nonapplicable scope as canonical 100-percent cleared status", () => {
    expect(summarizeScope("Master", ["Master"], [role()])).toMatchObject({
      entered: 0,
      weighted: 0,
      pct: 100,
      cleared: true,
      applicable: false,
    });
  });

  it("keeps an absent master split optional when publishing is fully cleared", () => {
    const publishing = summarizeScope("Publishing", ["Publishing", "Mechanical"], [role()]);
    const master = summarizeScope("Master", ["Master"], [role()]);

    expect(buildNextFixes(publishing, master, 0, true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "done", done: true }),
      expect.objectContaining({ id: "master-missing", optional: true, action: "master" }),
    ]));
    expect(buildNextFixes(publishing, master, 0, true)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "master-missing", optional: false }),
    ]));
  });

  it("explains the remaining signature work behind a synthetic 94-percent result", () => {
    const rows = [role({ percent_share: 75 }), role({ percent_share: 25, clearance_status: "Confirmed" })];
    const publishing = summarizeScope("Publishing", ["Publishing", "Mechanical"], rows);
    const master = summarizeScope("Master", ["Master"], rows);
    expect(publishing.pendingRows).toHaveLength(1);
    expect(buildNextFixes(publishing, master, 0, false)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "publishing-pending" }),
    ]));
  });

  it("does not ask to balance an overallocated scope canonically marked cleared", () => {
    const publishing = summarizeScope("Publishing", ["Publishing", "Mechanical"], [role({ percent_share: 150 })]);
    const master = summarizeScope("Master", ["Master"], []);

    expect(buildNextFixes(publishing, master, 0, true)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "publishing-balance" }),
    ]));
  });
});

describe("WorkClearanceWorkspace routing helpers", () => {
  it("keeps publishing scope links actionable even when the scope is empty", () => {
    expect(parseWorkClearanceRoute("?scope=publishing&focus=publishing")).toEqual({
      scope: "publishing",
    });
    expect(workClearanceFocusIds("publishing")).toEqual([
      "work-publishing-first-contact",
      "work-publishing-add",
    ]);
  });

  it("keeps master scope links actionable even when the scope is empty", () => {
    expect(parseWorkClearanceRoute("?scope=master&focus=master")).toEqual({
      scope: "master",
    });
    expect(workClearanceFocusIds("master")).toEqual([
      "work-master-first-contact",
      "work-master-add",
    ]);
  });

  it("keeps credits scope links actionable even when the scope is empty", () => {
    expect(parseWorkClearanceRoute("?scope=credits&focus=credits")).toEqual({
      scope: "credits",
    });
    expect(workClearanceFocusIds("credits")).toEqual([
      "work-credits-first-contact",
      "work-credits-add",
    ]);
  });

  it("accepts equivalent links passed via focus query param", () => {
    expect(parseWorkClearanceRoute("?focus=publishing")).toEqual({ scope: "publishing" });
    expect(parseWorkClearanceRoute("?focus=master")).toEqual({ scope: "master" });
    expect(parseWorkClearanceRoute("?focus=credits")).toEqual({ scope: "credits" });
  });
});
