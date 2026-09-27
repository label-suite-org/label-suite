import { describe, expect, it } from "vitest";
import {
  getRecordSearchKey,
  dedupeRecordSearchResults,
  normalizeRecordSearchQuery,
  rankRecordSearchResults,
  recordSearchContactHref,
  recordSearchEventHref,
  recordSearchEventSubtitle,
  recordSearchOrganizationHref,
  recordSearchProjectHref,
  recordSearchProjectSubtitle,
  recordSearchTrackHref,
  recordToCommand,
} from "./records";

describe("record search helpers", () => {
  it("normalizes and bounds record queries", () => {
    expect(normalizeRecordSearchQuery("  artist  ")).toBe("artist");
    expect(normalizeRecordSearchQuery(undefined)).toBe("");
    expect(normalizeRecordSearchQuery("x".repeat(100))).toHaveLength(80);
  });

  it("maps records into command-palette definitions", () => {
    expect(recordToCommand({
      id: "artist-1",
      kind: "artist",
      title: "Former Actress",
      subtitle: "Roster",
      href: "/artists/artist-1",
    })).toMatchObject({
      id: "record.artist.artist-1",
      group: "record",
      title: "Former Actress",
      href: "/artists/artist-1",
      keywords: ["artist"],
    });
  });

  it("deduplicates records by stable kind and id", () => {
    expect(
      dedupeRecordSearchResults([
        { id: "artist-1", kind: "artist", title: "Artist", href: "/artists/artist-1" },
        { id: "artist-1", kind: "artist", title: "Artist duplicate", href: "/artists/artist-1" },
        { id: "artist-2", kind: "artist", title: "Artist", href: "/artists/artist-2" },
        { id: "artist-2", kind: "track", title: "Track", href: "/tracks/artist-2" },
      ]),
    ).toMatchObject([
      { id: "artist-1", kind: "artist" },
      { id: "artist-2", kind: "artist" },
      { id: "artist-2", kind: "track" },
    ]);
  });

  it("sorts exact record matches ahead of partial title matches", () => {
    const ranked = rankRecordSearchResults(
      [
        { id: "track", kind: "track", title: "Track 2", href: "/tracks/track-2" },
        { id: "artist", kind: "artist", title: "Artist", href: "/artists/artist" },
        { id: "exact", kind: "release", title: "Rock", href: "/releases/rock" },
      ],
      "rock",
    );

    expect(ranked.map((record) => record.id)).toEqual(["exact", "artist", "track"]);
  });

  it("applies deterministic tie-breakers after exact-title and title-order ranking", () => {
    const ranked = rankRecordSearchResults(
      [
        { id: "track-b", kind: "track", title: "Exact", href: "/tracks/track-b" },
        { id: "artist-a", kind: "artist", title: "Exact", href: "/artists/artist-a" },
        { id: "artist-b", kind: "artist", title: "Exact", href: "/artists/artist-b" },
      ],
      "exact",
    );

    expect(ranked.map((record) => `${record.kind}:${record.id}`)).toEqual([
      "artist:artist-a",
      "artist:artist-b",
      "track:track-b",
    ]);
  });

  it("builds stable record keys using kind and id", () => {
    expect(getRecordSearchKey({ kind: "artist", id: "artist-1" })).toBe("artist:artist-1");
    expect(getRecordSearchKey({ kind: "work", id: "artist-1" })).toBe("work:artist-1");
  });

  it("builds precise record-search hrefs for nested records", () => {
    expect(recordSearchTrackHref({ id: "track 1", releaseId: "release 1", workId: "work-1" })).toBe(
      "/releases/release%201/tracks?track=track%201#track-track%201",
    );
    expect(recordSearchTrackHref({ id: "track-2", releaseId: null, workId: "work 2" })).toBe("/works/work%202");
    expect(recordSearchTrackHref({ id: "track-3", releaseId: null, workId: null })).toBe("/works");
    expect(recordSearchContactHref("contact 1")).toBe("/contacts?contact=contact%201");
    expect(recordSearchOrganizationHref("org 1")).toBe("/contacts?organization=org%201");
    expect(recordSearchProjectHref("project 1")).toBe("/projects/project%201");
    expect(recordSearchEventHref("event 1")).toBe("/events/event%201");
  });

  it("builds useful project and event subtitles", () => {
    expect(recordSearchProjectSubtitle({
      projectType: "music_video",
      status: "on_hold",
      startDate: "2026-08-20",
    })).toBe("Music Video - On Hold - 2026-08-20");
    expect(recordSearchProjectSubtitle({
      projectType: null,
      status: null,
      startDate: null,
    })).toBe("Project");

    expect(recordSearchEventSubtitle({
      eventType: "release_party",
      status: "confirmed",
      startDate: "2026-09-01",
    })).toBe("Release Party - Confirmed - 2026-09-01");
    expect(recordSearchEventSubtitle({
      eventType: null,
      status: null,
      startDate: null,
    })).toBe("Event");
  });
});
