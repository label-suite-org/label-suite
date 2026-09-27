import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard analytics signals", () => {
  it("uses the data-health-aware card selection for its rendered analytics list", () => {
    const page = readFileSync(new URL("./dashboard.astro", import.meta.url), "utf8");
    expect(page).toContain('import { selectDashboardAnalyticsCards } from "../server/analytics-command-center-core"');
    expect(page).toContain("selectDashboardAnalyticsCards(todayHub.cards, 3)");
  });

  it("activates the local analytics sandbox from runtime server state before queries", () => {
    const page = readFileSync(new URL("./analytics.astro", import.meta.url), "utf8");
    const runtimeEnvironment = "process.env";
    const resolverCall = "resolveAnalyticsSandboxRuntimeState({ env: process.env, isDev: import.meta.env.DEV, orgId: Astro.locals.orgId! })";

    expect(page).toContain('import AnalyticsSandboxBanner from "../components/analytics/AnalyticsSandboxBanner.astro"');
    expect(page).toContain('import { resolveAnalyticsSandboxRuntimeState } from "../lib/analytics-sandbox"');
    expect(page).toContain(runtimeEnvironment);
    expect(page).toContain(resolverCall);
    expect(page).not.toContain("import.meta.env.ANALYTICS_SANDBOX");
    expect(page.indexOf(runtimeEnvironment)).toBeLessThan(page.indexOf("listAnalyticsCommandCenter(orgId, filter)"));
    expect(page.indexOf(resolverCall)).toBeLessThan(page.indexOf("listAnalyticsCommandCenter(orgId, filter)"));
    expect(page).toContain("{sandboxState.enabled && <AnalyticsSandboxBanner />}");
    expect(page).not.toMatch(/searchParams\.get\(["'](?:analytics[-_])?sandbox/i);
    expect(page).not.toContain("Astro.cookies");
  });
});
