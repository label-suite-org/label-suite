import { describe, expect, it } from "vitest";
import { createReleaseGateFixtureWorld, validateReleaseGateFixtureWorld, configuredReleaseGateFixtureWorld, releaseGateFixtureManifest, assertReleaseGateFixtureManifest } from "./release-gate-fixture-world";

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

  it("resolves the same read-only credentials for seeding and browser login", () => {
    const env = { E2E_USER_EMAIL: "operator@example.test", E2E_USER_PASSWORD: "fixture-password" };
    expect(createReleaseGateFixtureWorld(env).readOnlyUser).toEqual({
      name: "Release Gate Read-only Member", email: "operator+readonly@example.test", password: "fixture-password",
    });
    expect(createReleaseGateFixtureWorld({ ...env, E2E_READ_ONLY_USER_EMAIL: " custom@example.test ", E2E_READ_ONLY_USER_PASSWORD: " distinct-password " }).readOnlyUser).toEqual({
      name: "Release Gate Read-only Member", email: "custom@example.test", password: "distinct-password",
    });
  });

  it("rejects identity collisions before seeding or browser verification", () => {
    const world = createReleaseGateFixtureWorld();
    expect(() => validateReleaseGateFixtureWorld({ ...world, ids: { ...world.ids, track: world.ids.release } })).toThrow("IDs must be unique");
    expect(() => validateReleaseGateFixtureWorld({ ...world, ids: { ...world.ids, campaignStation: world.ids.campaign } })).toThrow("IDs must be unique");
  });

  it("rejects missing prerequisites and an operator reused as the read-only member", () => {
    expect(() => configuredReleaseGateFixtureWorld({})).toThrow("E2E_USER_EMAIL");
    const env = { E2E_USER_EMAIL: "operator@example.test", E2E_USER_PASSWORD: "fixture-secret", E2E_ARTIST_ID: "artist", E2E_RELEASE_ID: "release", E2E_TRACK_ID: "track", E2E_EVENT_ID: "event" };
    expect(configuredReleaseGateFixtureWorld(env).operator.email).toBe("operator@example.test");
    expect(() => configuredReleaseGateFixtureWorld({ ...env, E2E_READ_ONLY_USER_EMAIL: env.E2E_USER_EMAIL })).toThrow("identities must differ");
  });

  it("verifies serialized seed identity and topology without sharing passwords or UI expectations", () => {
    const world = createReleaseGateFixtureWorld({ E2E_USER_EMAIL: "operator@example.test", E2E_USER_PASSWORD: "never-serialize-this" });
    const manifest = JSON.parse(JSON.stringify(releaseGateFixtureManifest(world)));
    expect(JSON.stringify(manifest)).not.toContain("never-serialize-this");
    expect(manifest).not.toHaveProperty("radio");
    expect(() => assertReleaseGateFixtureManifest(world, manifest)).not.toThrow();
    expect(() => assertReleaseGateFixtureManifest(world, { ...manifest, releaseId: "another-release" })).toThrow("seed manifest");
    expect(() => assertReleaseGateFixtureManifest(world, { ...manifest, activity: [] })).toThrow("seed manifest");
    expect(() => assertReleaseGateFixtureManifest(world, null)).toThrow("seed manifest");
  });

  it("keeps activity identities related and rejects broken public or activity topology", () => {
    const world = createReleaseGateFixtureWorld();
    expect(world.activity.map(entry => [entry.project, entry.leadId])).toEqual([
      ["desktop-gate", world.ids.activityLeads.desktop], ["mobile-390-gate", world.ids.activityLeads.mobile390], ["mobile-320-gate", world.ids.activityLeads.mobile320],
    ]);
    expect(() => validateReleaseGateFixtureWorld({ ...world, relationships: { ...world.relationships, publicCampaign: { ...world.relationships.publicCampaign, releaseId: "wrong" } } })).toThrow("topology");
    expect(() => validateReleaseGateFixtureWorld({ ...world, activity: [{ ...world.activity[0], taskId: "wrong" }] })).toThrow("topology");
  });
});
