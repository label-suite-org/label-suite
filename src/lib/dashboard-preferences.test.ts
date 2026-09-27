import { describe, expect, it } from "vitest";
import {
  DASHBOARD_INDICATOR_IDS,
  DASHBOARD_SECTION_IDS,
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
} from "./dashboard-preferences";

describe("dashboard preferences", () => {
  it("provides a calm, complete default without making attention configurable", () => {
    expect(defaultDashboardPreferences()).toEqual({
      schemaVersion: 1,
      pinnedIndicatorIds: ["release_readiness", "due_tasks", "catalog_issues"],
      sectionOrder: ["releases", "tasks", "catalog", "analytics", "royalties", "funding"],
      hiddenSectionIds: ["royalties", "funding"],
    });
    expect(DASHBOARD_SECTION_IDS).not.toContain("needs_attention");
  });

  it("accepts an exact, constrained personal layout", () => {
    expect(normalizeDashboardPreferences({
      schemaVersion: 1,
      pinnedIndicatorIds: ["net_revenue"],
      sectionOrder: ["funding", "royalties", "analytics", "catalog", "tasks", "releases"],
      hiddenSectionIds: ["catalog"],
    })).toEqual({
      schemaVersion: 1,
      pinnedIndicatorIds: ["net_revenue"],
      sectionOrder: ["funding", "royalties", "analytics", "catalog", "tasks", "releases"],
      hiddenSectionIds: ["catalog"],
    });
  });

  it.each([
    { label: "more than three pins", patch: { pinnedIndicatorIds: ["release_readiness", "due_tasks", "catalog_issues", "net_revenue"] } },
    { label: "duplicate pins", patch: { pinnedIndicatorIds: ["due_tasks", "due_tasks"] } },
    { label: "unknown pin", patch: { pinnedIndicatorIds: ["made_up"] } },
    { label: "missing section", patch: { sectionOrder: DASHBOARD_SECTION_IDS.slice(1) } },
    { label: "duplicate section", patch: { sectionOrder: [...DASHBOARD_SECTION_IDS.slice(0, -1), "releases"] } },
    { label: "unknown hidden section", patch: { hiddenSectionIds: ["needs_attention"] } },
  ])("rejects $label", ({ patch }) => {
    const candidate = { ...defaultDashboardPreferences(), ...patch };
    expect(() => normalizeDashboardPreferences(candidate)).toThrow();
  });

  it("returns independent defaults and preserves caller input", () => {
    const first = defaultDashboardPreferences();
    const second = defaultDashboardPreferences();
    first.pinnedIndicatorIds.splice(0, 1);
    expect(second.pinnedIndicatorIds).toEqual(["release_readiness", "due_tasks", "catalog_issues"]);

    const input = defaultDashboardPreferences();
    const snapshot = structuredClone(input);
    normalizeDashboardPreferences(input);
    expect(input).toEqual(snapshot);
    expect(DASHBOARD_INDICATOR_IDS).toHaveLength(6);
  });

  it("falls back to the canonical default for an unknown stored schema version", () => {
    expect(normalizeDashboardPreferences({
      ...defaultDashboardPreferences(),
      schemaVersion: 99,
    }, { stored: true })).toEqual(defaultDashboardPreferences());
  });
});
