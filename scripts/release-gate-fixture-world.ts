/**
 * Validated identity and relationship topology for the release-gate scenario.
 *
 * Seeding and browser verification consume this world, while each consumer
 * keeps its own behavioral assertions. This module intentionally contains no
 * expected UI copy or database writes.
 */

export type ReleaseGateFixtureWorld = {
  orgId: string;
  readOnlyUser: { name: string; email: string; password: string };
  foreignTenant: {
    org: string;
    membership: string;
    campaign: string;
    source: string;
    lead: string;
  };
  ids: {
    artist: string;
    release: string;
    event: string;
    campaign: string;
    station: string;
    campaignStation: string;
    track: string;
    audience: string;
    duplicateStationA: string;
    duplicateStationB: string;
    source: string;
    lead: string;
    focusedDraft: string;
    aiGoalRun: string;
    aiFocusedRun: string;
    aiPublicRun: string;
    artwork: string;
    publishedCampaign: string;
    activityLeads: { desktop: string; mobile390: string; mobile320: string; readOnly: string };
    activityTasks: { desktop: string; mobile390: string; mobile320: string };
    activityEvents: { desktop: string; mobile390: string; mobile320: string };
    activityRuns: { desktop: string; mobile390: string; mobile320: string };
    activitySuggestions: { desktop: string; mobile390: string; mobile320: string };
    activityEmail: string;
  };
  relationships: {
    catalog: { releaseArtistId: string; trackReleaseId: string };
    campaign: { id: string; releaseId: string; artistId: string; stationId: string; campaignStationId: string };
    publicCampaign: { id: string; releaseId: string; artistId: string };
    activity: { campaignId: string };
  };
  radio: {
    reviewSlug: string;
    publicSlug: string;
    artworkUrl: string;
    subject: string;
    body: string;
  };
  publicFixturePublishedAt: string;
};

export function createReleaseGateFixtureWorld(env: Record<string, string | undefined> = process.env): ReleaseGateFixtureWorld {
  const ids: ReleaseGateFixtureWorld["ids"] = {
    artist: env.E2E_ARTIST_ID?.trim() || "e2e-artist-release-gate",
    release: env.E2E_RELEASE_ID?.trim() || "e2e-release-release-gate",
    event: env.E2E_EVENT_ID?.trim() || "e2e-event-release-gate",
    campaign: "e2e-campaign-release-gate",
    station: "e2e-station-release-gate",
    campaignStation: "e2e-campaign-station-release-gate",
    track: env.E2E_TRACK_ID?.trim() || "e2e-track-release-gate",
    audience: "e2e-audience-release-gate",
    duplicateStationA: "e2e-station-radio-duplicate-a",
    duplicateStationB: "e2e-station-radio-duplicate-b",
    source: "e2e-source-release-gate",
    lead: "e2e-lead-release-gate",
    focusedDraft: "e2e-focused-draft-release-gate",
    aiGoalRun: "e2e-editor-ai-goal-release-gate",
    aiFocusedRun: "e2e-editor-ai-focused-release-gate",
    aiPublicRun: "e2e-editor-ai-public-release-gate",
    artwork: "e2e-artwork-release-gate",
    publishedCampaign: "e2e-campaign-public-release-gate",
    activityLeads: {
      desktop: "e2e-activity-lead-desktop",
      mobile390: "e2e-activity-lead-mobile-390",
      mobile320: "e2e-activity-lead-mobile-320",
      readOnly: "e2e-activity-lead-read-only",
    },
    activityTasks: {
      desktop: "e2e-activity-task-desktop",
      mobile390: "e2e-activity-task-mobile-390",
      mobile320: "e2e-activity-task-mobile-320",
    },
    activityEvents: {
      desktop: "e2e-activity-event-desktop",
      mobile390: "e2e-activity-event-mobile-390",
      mobile320: "e2e-activity-event-mobile-320",
    },
    activityRuns: {
      desktop: "e2e-activity-run-desktop",
      mobile390: "e2e-activity-run-mobile-390",
      mobile320: "e2e-activity-run-mobile-320",
    },
    activitySuggestions: {
      desktop: "e2e-activity-suggestion-desktop",
      mobile390: "e2e-activity-suggestion-mobile-390",
      mobile320: "e2e-activity-suggestion-mobile-320",
    },
    activityEmail: "e2e-activity-email",
  };
  const operatorEmail = env.E2E_USER_EMAIL?.trim() ?? "";
  const at = operatorEmail.indexOf("@");
  const derivedReadOnlyEmail = at > 0
    ? `${operatorEmail.slice(0, at)}+readonly${operatorEmail.slice(at)}`
    : `${operatorEmail}+readonly@example.test`;
  const world: ReleaseGateFixtureWorld = {
    orgId: "true-nature",
    readOnlyUser: {
      name: "Release Gate Read-only Member",
      email: env.E2E_READ_ONLY_USER_EMAIL?.trim() || derivedReadOnlyEmail,
      password: env.E2E_READ_ONLY_USER_PASSWORD?.trim() || env.E2E_USER_PASSWORD?.trim() || "",
    },
    foreignTenant: {
      org: "e2e-org-release-gate-foreign",
      membership: "e2e-membership-release-gate-foreign",
      campaign: "e2e-campaign-release-gate-foreign",
      source: "e2e-source-release-gate-foreign",
      lead: "e2e-lead-release-gate-foreign",
    },
    ids,
    relationships: {
      catalog: { releaseArtistId: ids.artist, trackReleaseId: ids.release },
      campaign: { id: ids.campaign, releaseId: ids.release, artistId: ids.artist, stationId: ids.station, campaignStationId: ids.campaignStation },
      publicCampaign: { id: ids.publishedCampaign, releaseId: ids.release, artistId: ids.artist },
      activity: { campaignId: ids.campaign },
    },
    radio: {
      reviewSlug: "e2e-fountain-radio-review",
      publicSlug: "e2e-fountain-radio-public",
      artworkUrl: "https://assets.example.test/fountain-release-gate-cover.svg",
      subject: "Fountain Edits — an independent-radio update",
      body: "A concise radio update for Fountain Edits.\n\nListen: https://example.test/fountain-listen\n\nShared with our independent radio network.",
    },
    publicFixturePublishedAt: "2026-08-05T08:00:00.000Z",
  };
  validateReleaseGateFixtureWorld(world);
  return world;
}

export function validateReleaseGateFixtureWorld(world: ReleaseGateFixtureWorld): void {
  const flattened = flattenIds(world.ids);
  const duplicates = [...new Set(flattened.filter((id, index) => flattened.indexOf(id) !== index))];
  if (duplicates.length) throw new Error(`Release-gate fixture IDs must be unique: ${duplicates.join(", ")}`);
  if (world.ids.campaignStation === world.ids.campaign) throw new Error("Campaign-station identity must not reuse campaign identity.");
  if (world.ids.track === world.ids.release) throw new Error("Track identity must not reuse release identity.");
  if (world.relationships.catalog.releaseArtistId !== world.ids.artist || world.relationships.catalog.trackReleaseId !== world.ids.release) {
    throw new Error("Catalog relationship topology does not match fixture identities.");
  }
  if (world.relationships.campaign.id !== world.ids.campaign || world.relationships.campaign.releaseId !== world.ids.release || world.relationships.campaign.artistId !== world.ids.artist) {
    throw new Error("Campaign relationship topology does not match fixture identities.");
  }
  if (world.foreignTenant.campaign === world.ids.campaign || world.foreignTenant.lead === world.ids.lead) {
    throw new Error("Foreign-tenant identities must remain separate from the primary fixture world.");
  }
}

function flattenIds(ids: ReleaseGateFixtureWorld["ids"]): string[] {
  return Object.values(ids).flatMap((value) => typeof value === "string" ? [value] : Object.values(value));
}

export const releaseGateFixtureWorld = createReleaseGateFixtureWorld();
