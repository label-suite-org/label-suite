import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createReleaseGateFixtureWorld, validateReleaseGateFixtureWorld } from "./release-gate-fixture-world";

describe("release-gate fixture world", () => {
  it("derives the same overrideable catalog identities and validates relationships", () => {
    const world = createReleaseGateFixtureWorld({ E2E_ARTIST_ID: "artist-override", E2E_RELEASE_ID: "release-override", E2E_TRACK_ID: "track-override", E2E_EVENT_ID: "event-override" });
    expect(world.ids).toMatchObject({ artist: "artist-override", release: "release-override", track: "track-override", event: "event-override" });
    expect(world.ids.campaign).toBe("e2e-campaign-release-gate");
    expect(world.relationships.campaign.releaseId).toBe(world.ids.release);
    expect(world.relationships.publicCampaign.artistId).toBe(world.ids.artist);
    expect(world.foreignTenant.campaign).not.toBe(world.ids.campaign);
    expect(() => validateReleaseGateFixtureWorld(world)).not.toThrow();
  });

  it("rejects identity collisions before seeding or browser verification", () => {
    const world = createReleaseGateFixtureWorld();
    expect(() => validateReleaseGateFixtureWorld({ ...world, ids: { ...world.ids, track: world.ids.release } })).toThrow("IDs must be unique");
    expect(() => validateReleaseGateFixtureWorld({ ...world, ids: { ...world.ids, campaignStation: world.ids.campaign } })).toThrow("IDs must be unique");
  });

  it("passes the deletion test by being the sole identity source for both consumers", () => {
    const seed = readFileSync(new URL("./seed-release-gate-fixtures.ts", import.meta.url), "utf8");
    const browser = readFileSync(new URL("../tests/release-gate/release-gate.spec.ts", import.meta.url), "utf8");
    expect(seed).toContain("./release-gate-fixture-world");
    expect(browser).toContain("../../scripts/release-gate-fixture-world");
    expect(seed).not.toContain("const FIXTURE_IDS = {");
    expect(browser).not.toContain('const RADIO_CAMPAIGN_ID = "e2e-campaign-release-gate"');
  });
});
