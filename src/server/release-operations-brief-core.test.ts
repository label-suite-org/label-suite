import { describe, expect, it } from "vitest";
import { buildReleaseOperationsBrief, type ReleaseOperationsBriefInput } from "./release-operations-brief-core";

const baseInput: ReleaseOperationsBriefInput = {
  today: "2026-07-21",
  release: {
    id: "release-1",
    title: "Fountain",
    artistName: "True Blue",
    releaseDate: "2026-09-18",
    format: "single",
    upcEan: "123456789012",
    coverArtUrl: "/cover.jpg",
    releaseReady: true,
    status: "scheduled",
  },
  tracks: [{ id: "track-1", title: "Fountain", ready: true, missing: null }],
  pitches: [{ id: "pitch-1", status: "draft" }],
  timeline: null,
  hasScopedAnalytics: false,
};

describe("buildReleaseOperationsBrief", () => {
  it("returns a clear brief when grounded release checks pass", () => {
    const brief = buildReleaseOperationsBrief(baseInput);

    expect(brief.status).toBe("clear");
    expect(brief.headline).toBe("No operational blockers found");
    expect(brief.items).toEqual([]);
    expect(brief.sourcesChecked).toEqual(["Release record", "Track readiness", "DSP pitches"]);
  });

  it("prioritizes specific track blockers and preserves their evidence", () => {
    const brief = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [
        { id: "track-1", title: "Fountain", ready: false, missing: "ISRC, Publishing clearance 25%" },
        { id: "track-2", title: "Still Water", ready: false, missing: "Audio file" },
      ],
    });

    expect(brief.status).toBe("blocked");
    expect(brief.items[0]).toMatchObject({
      id: "track-readiness",
      severity: "blocker",
      title: "2 tracks need work",
      actionKey: "track-readiness",
      evidence: { label: "Fountain track", href: "/releases/release-1/tracks?track=track-1&focus=isrc" },
    });
    expect(brief.items[0]?.detail).toContain("Fountain: ISRC, Publishing clearance 25%");
    expect(brief.items[0]?.detail).toContain("Still Water: Audio file");
  });

  it("links track blockers to focused editor fields and scope pages", () => {
    const withPublishingClearance = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [{ id: "track-1", title: "Publishing track", ready: false, missing: "Publishing clearance 25%", workId: "work-pub" }],
    });
    const withAudioMissing = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [{ id: "track-2", title: "Audio track", ready: false, missing: "Audio file", workId: "work-audio" }],
    });
    const withCreditMissing = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [{ id: "track-3", title: "Credit track", ready: false, missing: "Missing credited persons", workId: "work-credit" }],
    });

    expect(withPublishingClearance.items[0]?.evidence).toMatchObject({
      label: "Publishing clearance",
      href: "/works/work-pub?scope=publishing&focus=publishing",
    });
    expect(withAudioMissing.items[0]?.evidence).toMatchObject({
      label: "Audio track track",
      href: "/releases/release-1/tracks?track=track-2&focus=audio",
    });
    expect(withCreditMissing.items[0]?.evidence).toMatchObject({
      label: "Credited persons",
      href: "/works/work-credit?scope=credits&focus=credits",
    });

    const withMasterClearance = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [{ id: "track-4", title: "Master track", ready: false, missing: "Master clearance 40%", workId: "work-master" }],
    });
    expect(withMasterClearance.items[0]?.evidence).toMatchObject({
      label: "Master clearance",
      href: "/works/work-master?scope=master&focus=master",
    });
  });

  it("sends generic missing-rights blockers to the linked work clearance editor", () => {
    const brief = buildReleaseOperationsBrief({
      ...baseInput,
      release: { ...baseInput.release, releaseReady: false },
      tracks: [{
        id: "track-no-rights",
        title: "No rights track",
        ready: false,
        missing: "Clearance required — no rights entered",
        workId: "work-no-rights",
      }],
    });

    expect(brief.items[0]?.evidence).toMatchObject({
      label: "Work clearance",
      href: "/works/work-no-rights?scope=publishing&focus=publishing",
    });
  });

  it("surfaces overdue blocking timeline work ahead of attention items", () => {
    const brief = buildReleaseOperationsBrief({
      ...baseInput,
      timeline: {
        releaseDate: "2026-09-18",
        today: "2026-07-21",
        currentPhaseKey: "assets_metadata",
        unallocatedBudget: { planned: 0, committed: 0, paid: 0 },
        phases: [
          {
            key: "assets_metadata",
            label: "Masters, artwork & metadata",
            startDate: "2026-05-29",
            endDate: "2026-07-24",
            health: "blocked",
            milestones: [{ id: "milestone-1", title: "Approve final master", phase: "assets_metadata", dueDate: "2026-07-20", status: "todo", owner: null, isBlocking: true, notes: null }],
            tasks: [],
            budgetItems: [],
            childReleases: [],
            budget: { planned: 0, committed: 0, paid: 0 },
            completeCount: 0,
            totalCount: 1,
          },
          {
            key: "campaign_rollout",
            label: "Campaign rollout",
            startDate: "2026-07-24",
            endDate: "2026-09-11",
            health: "attention",
            milestones: [{ id: "milestone-2", title: "Confirm press owner", phase: "campaign_rollout", dueDate: "2026-08-01", status: "todo", owner: null, isBlocking: false, notes: null }],
            tasks: [],
            budgetItems: [],
            childReleases: [],
            budget: { planned: 0, committed: 0, paid: 0 },
            completeCount: 0,
            totalCount: 1,
          },
        ],
      },
    });

    expect(brief.items[0]).toMatchObject({
      id: "timeline-assets_metadata",
      severity: "blocker",
      title: "Masters, artwork & metadata is blocked",
      actionKey: "timeline",
      evidence: { label: "Release timeline", href: "/releases/release-1?section=timeline#release-timeline" },
    });
    expect(brief.items[0]?.detail).toContain("Approve final master was due Jul 20");
    expect(brief.items[1]).toMatchObject({ severity: "attention", title: "Campaign rollout needs attention" });
  });

  it("treats missing analytics as a post-release watch item, not a pre-release blocker", () => {
    const upcoming = buildReleaseOperationsBrief(baseInput);
    expect(upcoming.items.find((item) => item.id === "analytics")).toBeUndefined();

    const released = buildReleaseOperationsBrief({
      ...baseInput,
      today: "2026-10-01",
      release: { ...baseInput.release, releaseDate: "2026-09-18", status: "released" },
    });
    expect(released.items.find((item) => item.id === "analytics")).toMatchObject({
      severity: "watch",
      title: "No scoped performance data is linked",
      actionKey: "analytics",
      evidence: { label: "Release analytics", href: "/releases/release-1?section=analytics#performance-data" },
    });
  });

  it("keeps missing release essentials traceable to the release record", () => {
    const brief = buildReleaseOperationsBrief({
      ...baseInput,
      release: {
        ...baseInput.release,
        releaseDate: null,
        upcEan: null,
        coverArtUrl: null,
        releaseReady: false,
      },
      pitches: [],
    });

    expect(brief.items.map((item) => item.id)).toEqual(expect.arrayContaining(["release-date", "upc", "cover", "pitch"]));
    expect(brief.items.find((item) => item.id === "release-date")).toMatchObject({
      severity: "blocker",
      actionKey: "date",
      evidence: { label: "Release date", href: "/releases/release-1?section=overview&focus=date" },
    });
  });
});
