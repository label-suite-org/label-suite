import { describe, expect, it } from "vitest";
import {
  ANALYTICS_SECTIONS,
  analyticsSectionHref,
  analyticsSyncRunsHref,
  parseAnalyticsSection,
} from "./analytics-workspace";

describe("analytics workspace section contract", () => {
  it("keeps the six product sections in the approved order", () => {
    expect(ANALYTICS_SECTIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "overview", label: "Overview" },
      { id: "trends", label: "Trends" },
      { id: "audience", label: "Audience" },
      { id: "discovery", label: "Discovery" },
      { id: "forecast", label: "Forecast" },
      { id: "data-health", label: "Data Health" },
    ]);
  });

  it("defaults unknown or missing values to overview", () => {
    expect(parseAnalyticsSection(null)).toBe("overview");
    expect(parseAnalyticsSection("not-a-section")).toBe("overview");
    expect(parseAnalyticsSection("forecast")).toBe("forecast");
  });

  it("preserves analytics scope while changing only section", () => {
    const current = new URL(
      "https://suite.test/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d#old",
    );
    expect(analyticsSectionHref("audience", current)).toBe(
      "/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d&section=audience",
    );
  });

  it("targets Data Health sync runs while preserving every analytics filter", () => {
    const current = new URL("https://suite.test/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d");
    expect(analyticsSyncRunsHref(current)).toBe(
      "/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d&section=data-health#analytics-sync-runs",
    );
  });
});
