import { describe, expect, it } from "vitest";
import { presentCatalogIssue, summarizeReleaseBlockers } from "./dashboard-presentation";

describe("summarizeReleaseBlockers", () => {
  it("turns repeated track validation text into one precise blocker and a remainder count", () => {
    expect(summarizeReleaseBlockers(
      'Track "I Wanna Believe [Main]": Audio file, Track "I Wanna Believe [Main]": Master clearance 0%',
    )).toEqual({
      label: "Audio file missing",
      detail: "I Wanna Believe [Main] · 1 more blocker",
    });
  });

  it("presents a release-level field without internal validation punctuation", () => {
    expect(summarizeReleaseBlockers("Cover art")).toEqual({
      label: "Cover art missing",
      detail: null,
    });
  });

  it("keeps release-level blockers ahead of track blockers and counts both", () => {
    expect(summarizeReleaseBlockers(
      'Cover art, Track "I Wanna Believe [Main]": Audio file',
    )).toEqual({
      label: "Cover art missing",
      detail: "1 more blocker",
    });
  });

  it("uses a calm pending state when no blocker evidence exists", () => {
    expect(summarizeReleaseBlockers(null)).toEqual({
      label: "Readiness check pending",
      detail: null,
    });
  });

  it("fails soft when a legacy blocker value contains only delimiters", () => {
    expect(summarizeReleaseBlockers(", ")).toEqual({
      label: "Readiness check pending",
      detail: null,
    });
  });
});

describe("presentCatalogIssue", () => {
  it("names the affected track and replaces engineering bug language", () => {
    expect(presentCatalogIssue({
      title: "Track missing audio",
      description: 'Track "I Wanna Believe [Main]" has no audio file.',
      sourceTable: "tracks",
    })).toEqual({
      label: "Audio file missing",
      subject: "I Wanna Believe [Main]",
      kind: "Track",
    });
  });

  it("keeps a useful fallback when a legacy validation has no quoted subject", () => {
    expect(presentCatalogIssue({
      title: "Release incomplete",
      description: null,
      sourceTable: "releases",
    })).toEqual({
      label: "Release incomplete",
      subject: null,
      kind: "Release",
    });
  });
});
