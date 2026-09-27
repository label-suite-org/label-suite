import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Spotify analytics database fixture contract", () => {
  it("runs in the migrated disposable PostgreSQL verification lane", async () => {
    const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
    const migration = workflow.indexOf('DATABASE_URL="$ANALYTICS_FIXTURE_DB_URL" npm run db:migrate');
    const spotifyFixture = workflow.indexOf("npm run test:spotify-analytics-import");

    expect(migration).toBeGreaterThan(-1);
    expect(spotifyFixture).toBeGreaterThan(-1);
    expect(migration).toBeLessThan(spotifyFixture);
  });

  it("runs the shipped production adapter against the guarded migrated database", async () => {
    const fixture = await readFile(new URL("./spotify-analytics-import-fixture.ts", import.meta.url), "utf8");

    expect(fixture).toContain("createSpotifyAnalyticsImportProductionService");
    expect(fixture).toContain("assertDisposableMigratedAnalyticsFixtureTarget");
    expect(fixture).not.toContain("type SpotifyImportStore");
    expect(fixture).not.toContain("type SpotifyImportTransaction");
    expect(fixture).not.toContain("function makeTransaction");
    expect(fixture).not.toContain("create table");
  });

  it("asserts lock serialization, tenant scoping, successful provenance, completion, and separate failure evidence", async () => {
    const fixture = await readFile(new URL("./spotify-analytics-import-fixture.ts", import.meta.url), "utf8");

    expect(fixture).toContain("pg_try_advisory_xact_lock");
    expect(fixture).toContain("successfulEvidence");
    expect(fixture).toContain("status: \"completed\"");
    expect(fixture).toContain("await service.listLatestSpotifyAudienceImports(orgB)");
    expect(fixture).toContain("failedEvidence");
    expect(fixture).toContain("status: \"failed\"");
  });
});
