import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandPath = new URL("./seed-analytics-sandbox.ts", import.meta.url);

function readCommand(): string {
  return readFileSync(commandPath, "utf8");
}

describe("seed-analytics-sandbox command boundary", () => {
  it("resolves the local-only configuration before creating its one PostgreSQL client", () => {
    const source = readCommand();

    expect(source).toMatch(/from "pg"/);
    expect(source).toContain("seedAnalyticsSandbox");
    expect(source.indexOf("resolveAnalyticsSandboxConfig(process.env)")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("resolveAnalyticsSandboxConfig(process.env)")).toBeLessThan(source.indexOf("new Client"));
    expect((source.match(/await client\.connect\(\)/g) ?? [])).toHaveLength(1);
  });

  it("has no provider, upload, scheduling, or broad database escape hatch", () => {
    const source = readCommand();

    for (const forbidden of ["fetch(", "axios", "playwright", "SISENSE_", "R2_", "DOKPLOY_", "upload", "schedule", "DATABASE_URL"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("prints only the returned count summary and exits nonzero without retries on failure", () => {
    const source = readCommand();

    expect(source).toContain("analytics sandbox seeded: version=${summary.fixtureVersion} org=${summary.orgId} artists=${summary.artists} releases=${summary.releases} tracks=${summary.tracks} metricRows=${summary.metricRows} importRuns=${summary.importRuns}");
    expect(source).not.toMatch(/console\.log\([^)]*databaseUrl/);
    expect(source).not.toMatch(/console\.error\([^)]*databaseUrl/);
    expect(source).toContain("process.exitCode = 1");
    expect(source).not.toMatch(/retry|attempt|setTimeout/i);
  });
});
