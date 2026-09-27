import { describe, expect, it } from "vitest";
import { projectNativeReleaseCampaigns, projectNativeReleaseDetail, projectNativeReleasePipeline, projectNativeReleaseProviderContext } from "./native-releases";

describe("native release projections", () => {
  it("projects canonical campaign relationships", () => {
    expect(projectNativeReleaseCampaigns([{ id: "campaign-a", campaign_name: "Autumn", campaign_type: "editorial", status: "active" }])).toEqual([{ id: "campaign-a", name: "Autumn", type: "editorial", status: "active" }]);
  });
  it("keeps pipeline identity and truthful readiness state", () => {
    expect(projectNativeReleasePipeline([
      {
        id: "release-a",
        title: "A very long release title that must remain intact",
        artist_name: "Artist A",
        cover_art_url: null,
        release_date: "2026-09-01",
        status: "scheduled",
        release_ready: false,
        missing_release_fields: ["cover", "tracks"],
      },
    ], new Map([["release-a", "assets_metadata"]]))).toEqual([{
      id: "release-a",
      title: "A very long release title that must remain intact",
      artist_name: "Artist A",
      cover_art_url: null,
      image_state: "missing",
      release_date: "2026-09-01",
      phase: "assets_metadata",
      readiness: "blocked",
      blockers: ["cover", "tracks"],
    }]);
  });

  it("bounds pipeline and child projections before protected caching", () => {
    const rows = Array.from({ length: 55 }, (_, index) => ({
      id: `release-${index}`, title: `Release ${index}`, artist_name: null, cover_art_url: null,
      release_date: null, status: null, release_ready: null, missing_release_fields: [],
    }));
    expect(projectNativeReleasePipeline(rows)).toHaveLength(50);

    const source = {
      id: "release-a", title: "Release A", artist_id: null, artist_name: null, cover_art_url: null,
      release_date: null, status: null, format: null, upc_ean: null, release_ready: null, release_missing: null,
      timeline: { currentPhaseKey: null, phases: [], childReleases: Array.from({ length: 10 }, (_, index) => ({ id: `child-${index}`, title: `Child ${index}`, releaseDate: null, status: null, ready: null })) },
    };
    expect(projectNativeReleaseDetail(source).child_releases).toHaveLength(8);
  });

  it("routes child-record blockers to their canonical Release section", () => {
    const detail = projectNativeReleaseDetail({
      id: "release-a", title: "Release A", artist_id: null, artist_name: null, cover_art_url: null,
      release_date: null, status: "draft", format: "single", upc_ean: null, release_ready: false, release_missing: "tracks",
      timeline: { currentPhaseKey: null, phases: [], childReleases: [] },
    });
    expect(detail.next_action).toEqual({ label: "Resolve tracks", href: "/releases/release-a?section=tracks" });
  });

  it("projects a detail with next action, freshness and bounded child sections", () => {
    expect(projectNativeReleaseDetail({
      id: "release-a",
      title: "Release A",
      artist_id: "artist-a",
      artist_name: "Artist A",
      cover_art_url: "https://cdn.test/cover.jpg",
      release_date: "2026-09-01",
      status: "scheduled",
      format: "single",
      upc_ean: null,
      updated_at: new Date("2026-09-01T12:34:56.789Z"),
      release_ready: false,
      release_missing: "UPC/EAN, tracks",
      timeline: {
        currentPhaseKey: "distribution_dsp",
        phases: [],
        childReleases: [{ id: "child-a", title: "Child A", releaseDate: null, status: "draft", ready: false }],
      },
    })).toEqual({
      release: {
        id: "release-a", title: "Release A", artist_id: "artist-a", artist_name: "Artist A",
        cover_art_url: "https://cdn.test/cover.jpg", image_state: "available", release_date: "2026-09-01",
        status: "scheduled", format: "single", upc_ean: null, updated_at: "2026-09-01T12:34:56.789Z", release_ready: false, release_missing: "UPC/EAN, tracks",
      },
      phase: "distribution_dsp",
      readiness: { state: "blocked", blockers: ["UPC/EAN", "tracks"] },
      next_action: { label: "Resolve UPC/EAN", href: "/releases/release-a?section=overview&focus=upc" },
      sections: [
        { key: "overview", title: "Overview" },
        { key: "timeline", title: "Timeline" },
        { key: "tracks", title: "Tracks" },
        { key: "works", title: "Works" },
        { key: "campaigns", title: "Campaigns" },
        { key: "analytics", title: "Analytics" },
        { key: "royalties", title: "Royalties" },
        { key: "budget", title: "Budget" },
        { key: "assets", title: "Assets" },
        { key: "documents", title: "Documents" },
        { key: "tasks", title: "Tasks" },
        { key: "activity", title: "Activity" },
      ],
      child_releases: [{ id: "child-a", title: "Child A", release_date: null, status: "draft", ready: false }],
    });
  });

  it("keeps configured, partial, unavailable, manual, failure, and expired access distinct without audio URLs", () => {
    const context = projectNativeReleaseProviderContext({
      samply: { configured: true, projectLinked: true, lastSyncedAt: "2026-09-16T10:00:00.000Z", fileCount: 2, unresolvedFileCount: 1, connectionStatus: "verified" },
      dsp: { pitches: [{ id: "pitch-a", platform: "Spotify", status: "sent", sentDate: "2026-09-12T10:00:00.000Z", response: null }], manuallyMaintained: true },
    });
    expect(context.audio).toEqual({ source: "samply", state: "partial", freshness: { state: "unknown", observed_at: "2026-09-16T10:00:00.000Z" }, access: { state: "metadata_only", reason: "Native provider context contains metadata only; playback is not available" }, item_count: 2, unresolved_item_count: 1 });
    expect(context.dsp).toEqual({ source: "canonical_dsp_pitches", state: "manual", freshness: { state: "unknown", observed_at: "2026-09-12T10:00:00.000Z" }, pitches: [{ id: "pitch-a", platform: "Spotify", status: "sent", sent_date: "2026-09-12T10:00:00.000Z", response: null }], has_more: false });
    expect(JSON.stringify(context)).not.toContain("https://");

    expect(projectNativeReleaseProviderContext({ samply: { configured: false, projectLinked: false, lastSyncedAt: null, fileCount: 0, unresolvedFileCount: 0, connectionStatus: null }, dsp: { pitches: [], manuallyMaintained: false } }).audio.state).toBe("unavailable");
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: null, fileCount: 0, unresolvedFileCount: 0, connectionStatus: "manual" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.state).toBe("manual");
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: null, fileCount: 0, unresolvedFileCount: 0, connectionStatus: "failed" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.state).toBe("failure");
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: false, lastSyncedAt: null, fileCount: 0, unresolvedFileCount: 0, connectionStatus: "failed" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.state).toBe("failure");
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: "2020-01-01T00:00:00.000Z", fileCount: 1, unresolvedFileCount: 0, connectionStatus: "verified" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.freshness).toEqual({ state: "unknown", observed_at: "2020-01-01T00:00:00.000Z" });
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: null, fileCount: 1, unresolvedFileCount: 0, connectionStatus: "verified" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.freshness).toEqual({ state: "unknown", observed_at: null });
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: "not-a-timestamp", fileCount: 1, unresolvedFileCount: 0, connectionStatus: "verified" }, dsp: { pitches: [], manuallyMaintained: false } }).audio.freshness).toEqual({ state: "unknown", observed_at: null });
    expect(projectNativeReleaseProviderContext({ samply: { configured: true, projectLinked: true, lastSyncedAt: "2026-09-16T10:00:00.000Z", fileCount: 1, unresolvedFileCount: 1, connectionStatus: "verified", accessExpired: true }, dsp: { pitches: [], manuallyMaintained: false } }).audio.access.state).toBe("expired");
  });

  it("retains exactly twenty native DSP pitches and marks the bounded view incomplete", () => {
    const pitches = Array.from({ length: 20 }, (_, index) => ({ id: `pitch-${index}`, platform: "Spotify", status: "sent", sentDate: null, response: null }));
    expect(projectNativeReleaseProviderContext({
      samply: { configured: false, projectLinked: false, lastSyncedAt: null, fileCount: 0, unresolvedFileCount: 0, connectionStatus: null },
      dsp: { pitches, manuallyMaintained: true, hasMore: true },
    }).dsp).toMatchObject({
      has_more: true,
      pitches: Array.from({ length: 20 }, (_, index) => expect.objectContaining({ id: `pitch-${index}` })),
    });
  });
});
