import { describe, expect, it } from "vitest";
import {
  collectReleaseSweepBugs,
  collectRoleSweepBugs,
  collectTrackSweepBugs,
  collectWorkSweepBugs,
} from "./sweep-core";

describe("sweep bug collectors", () => {
  it("creates track blockers for missing work, ISRC, and audio", () => {
    const bugs = collectTrackSweepBugs([
      { id: "track-1", title: "Song", isrc: null, audio_url: null, work_id: null },
    ]);

    expect(bugs.map((bug) => bug.key)).toEqual([
      "work-missing-track-1",
      "isrc-missing-track-1",
      "audio-missing-track-1",
    ]);
    expect(bugs.map((bug) => bug.priority)).toEqual(["P1", "P1", "P0"]);
  });

  it("creates release blockers for missing delivery fields and empty tracklist", () => {
    const bugs = collectReleaseSweepBugs(
      [{ id: "rel-1", title: "Release", upc_ean: null, release_date: null, cover_art_url: null }],
      [],
    );

    expect(bugs.map((bug) => bug.key)).toEqual([
      "release-upc-missing-rel-1",
      "release-date-missing-rel-1",
      "release-artwork-missing-rel-1",
      "release-tracks-missing-rel-1",
    ]);
  });

  it("does not create no-track release bugs when tracks link to the release", () => {
    const bugs = collectReleaseSweepBugs(
      [{ id: "rel-1", title: "Release", upc_ean: "123", release_date: "2026-01-01", cover_art_url: "https://asset" }],
      [{ id: "track-1", title: "Song", isrc: "DKO7P2600001", audio_url: "https://audio", work_id: "work-1", release_id: "rel-1" }],
    );

    expect(bugs).toEqual([]);
  });

  it("creates role blockers when a rights share has no scope", () => {
    const bugs = collectRoleSweepBugs([
      {
        id: "role-1",
        work_id: "work-1",
        role: "Producer",
        ownership_type: "Rights",
        scope: null,
        percent_share: 25,
      },
    ]);

    expect(bugs).toHaveLength(1);
    expect(bugs[0].key).toBe("role-scope-missing-role-1");
  });

  it("creates work blockers when no applicable rights shares are entered", () => {
    const bugs = collectWorkSweepBugs(
      [{ id: "work-1", title: "Song" }],
      [
        {
          id: "role-1",
          work_id: "work-1",
          role: "Vocalist",
          ownership_type: "Credit",
          scope: "Master",
          percent_share: 100,
        },
      ],
    );

    expect(bugs).toHaveLength(1);
    expect(bugs[0].key).toBe("work-rights-missing-work-1");
  });

  it("does not create work blockers when an applicable rights share exists", () => {
    const bugs = collectWorkSweepBugs(
      [{ id: "work-1", title: "Song" }],
      [
        {
          id: "role-1",
          work_id: "work-1",
          role: "Producer",
          ownership_type: "Rights",
          scope: "Master",
          percent_share: 100,
        },
      ],
    );

    expect(bugs).toEqual([]);
  });

  it("creates work blockers for underallocated applicable rights scopes", () => {
    const bugs = collectWorkSweepBugs(
      [{ id: "work-1", title: "Song" }],
      [
        {
          id: "role-1",
          work_id: "work-1",
          role: "Songwriter",
          ownership_type: "Rights",
          scope: "Publishing",
          percent_share: 75,
        },
      ],
    );

    expect(bugs.map((bug) => bug.key)).toEqual([
      "work-publishing-underallocated-work-1",
    ]);
    expect(bugs[0].description).toContain("75% Publishing rights");
  });

  it("creates work blockers for overallocated applicable rights scopes", () => {
    const bugs = collectWorkSweepBugs(
      [{ id: "work-1", title: "Song" }],
      [
        {
          id: "role-1",
          work_id: "work-1",
          role: "Producer",
          ownership_type: "Rights",
          scope: "Master",
          percent_share: 60,
        },
        {
          id: "role-2",
          work_id: "work-1",
          role: "Performer",
          ownership_type: "Rights",
          scope: "Master",
          percent_share: 60,
        },
      ],
    );

    expect(bugs.map((bug) => bug.key)).toEqual([
      "work-master-overallocated-work-1",
    ]);
    expect(bugs[0].description).toContain("120% Master rights");
  });

  it("rolls Mechanical scope into Publishing allocation checks", () => {
    const bugs = collectWorkSweepBugs(
      [{ id: "work-1", title: "Song" }],
      [
        {
          id: "role-1",
          work_id: "work-1",
          role: "Songwriter",
          ownership_type: "Rights",
          scope: "Publishing",
          percent_share: 50,
        },
        {
          id: "role-2",
          work_id: "work-1",
          role: "Publisher",
          ownership_type: "Rights",
          scope: "Mechanical",
          percent_share: 50,
        },
      ],
    );

    expect(bugs).toEqual([]);
  });
});
