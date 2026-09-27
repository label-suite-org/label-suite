import { describe, expect, it } from "vitest";
import { buildTrackReadinessChecks, isTrackReadinessComplete } from "./track-readiness-ui";

describe("buildTrackReadinessChecks", () => {
  it("does not call empty clearance universes complete", () => {
    const checks = buildTrackReadinessChecks({
      audioUrl: "/audio/proof.wav",
      isrc: "DKO7P2600105",
      workId: "work-1",
      clearance_pub: 1,
      clearance_master: 1,
      clearance_pub_entered: 0,
      clearance_master_entered: 0,
    });

    expect(checks.find((check) => check.label === "Publishing clearance")).toMatchObject({
      state: "missing",
      detail: "No rights entered on this track",
    });
    expect(checks.find((check) => check.label === "Master clearance")).toMatchObject({
      state: "missing",
      detail: "No rights entered on this track",
    });
  });

  it("marks an empty universe as not applicable when another universe has rights", () => {
    const checks = buildTrackReadinessChecks({
      audioUrl: "/audio/proof.wav",
      isrc: "DKO7P2600105",
      workId: "work-1",
      clearance_pub: 1,
      clearance_master: 1,
      clearance_pub_entered: 100,
      clearance_master_entered: 0,
    });

    expect(checks.find((check) => check.label === "Publishing clearance")).toMatchObject({
      state: "complete",
      detail: "100% complete",
    });
    expect(checks.find((check) => check.label === "Master clearance")).toMatchObject({
      state: "not-applicable",
      detail: "No master rights entered",
    });
  });

  it("keeps both scopes blocked when neither universe has entered rights", () => {
    const checks = buildTrackReadinessChecks({
      audioUrl: "/audio/proof.wav",
      isrc: "DKO7P2600105",
      workId: "work-1",
      clearance_pub: 1,
      clearance_master: 1,
      clearance_pub_entered: 0,
      clearance_master_entered: 0,
    });

    expect(checks.find((check) => check.label === "Publishing clearance")).toMatchObject({
      state: "missing",
      detail: "No rights entered on this track",
    });
    expect(checks.find((check) => check.label === "Master clearance")).toMatchObject({
      state: "missing",
      detail: "No rights entered on this track",
    });
  });
});

describe("isTrackReadinessComplete", () => {
  it("does not report an incomplete track queue as complete", () => {
    expect(isTrackReadinessComplete(0, 5)).toBe(false);
    expect(isTrackReadinessComplete(5, 5)).toBe(true);
    expect(isTrackReadinessComplete(0, 0)).toBe(false);
  });
});
