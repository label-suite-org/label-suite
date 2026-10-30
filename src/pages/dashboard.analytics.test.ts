import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import NativeMusicImport from "../components/analytics/NativeMusicImport";
import { describe, expect, it } from "vitest";

describe("dashboard analytics signals", () => {
  it("renders the native import form and fragment target before hydration", () => {
    const page = readFileSync(new URL("./analytics.astro", import.meta.url), "utf8");
    const importer = readFileSync(new URL("../components/analytics/NativeMusicImport.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/<div id="native-music-import">\s*<NativeMusicImport\s+client:load[^>]*\/>\s*<\/div>/);
    const dataHealth = page.slice(page.indexOf('{activeSection === "data-health"'));
    const target = dataHealth.indexOf('<div id="native-music-import">');
    expect(target).toBeGreaterThan(0);
    // A client-only importer above the target shifts it after initial fragment navigation.
    expect(dataHealth.slice(0, target)).not.toContain("client:only");
    expect(importer).not.toContain('id="native-music-import"');
    const html = renderToString(createElement(NativeMusicImport, {
      artists: [{ id: "fixture-artist", name: "Fixture artist" }], selectedArtistId: "fixture-artist",
    }));
    expect(html).toContain("Native music snapshot import");
    expect(html).toContain('<option value="fixture-artist" selected="">Fixture artist</option>');
    expect(html).toContain('type="file"');
    expect(html).toContain("Preview native snapshot");
  });

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
