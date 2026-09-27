import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AnalyticsSandboxBanner", () => {
  it("renders a persistent, versioned status message for local fixtures or imported snapshots", () => {
    const component = readFileSync(new URL("./AnalyticsSandboxBanner.astro", import.meta.url), "utf8");

    expect(component).toContain('role="status"');
    expect(component).toContain('data-analytics-sandbox="analytics-sandbox-v1"');
    expect(component).toContain("Sandbox data — local fixtures or imported snapshots, not production analytics.");
  });
});
