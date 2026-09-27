import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const probePath = new URL("./analytics-sandbox-query-probe.ts", import.meta.url);

describe("analytics sandbox real-query probe contract", () => {
  it("exists as an isolated subprocess entrypoint", () => {
    expect(existsSync(probePath)).toBe(true);
  });

  it("uses real analytics query consumers and verifies the complete fixture shape", () => {
    const probe = readFileSync(probePath, "utf8");

    expect(probe).toContain('from "../src/server/analytics"');
    expect(probe).toContain('from "../src/server/analytics-data-quality"');
    for (const consumer of ["listAnalyticsTracksByGrowth", "listAnalyticsStreamSources", "listAnalyticsCities", "listAnalyticsDataQuality"]) {
      expect(probe).toContain(consumer);
    }
    expect(probe).toContain("tracks.length !== 5");
    expect(probe).toContain("combinedStreams > 0");
    expect(probe).toContain("source === \"Unknown\"");
    expect(probe).toContain("cities.length !== 6");
    expect(probe).toContain('quality.health.coverage !== "complete"');
    expect(probe).toContain("expectedWidgetKeys");
    expect(probe).not.toMatch(/SISENSE_|R2_|DOKPLOY_|AWS_|OPENAI_|process\.env\.(?!DATABASE_URL|ANALYTICS_SANDBOX_ORG_ID)/);
  });
});
