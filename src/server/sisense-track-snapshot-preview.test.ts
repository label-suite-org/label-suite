import { describe, expect, it, vi } from "vitest";
import { parseSisenseTrackSnapshot } from "./sisense-track-snapshot";
import {
  previewSisenseTrackSnapshot,
  SisenseTrackSnapshotPreviewAmbiguityError,
  SISENSE_TRACK_PREVIEW_BATCH_SIZE,
  type SisenseTrackPreviewStore,
} from "./sisense-track-snapshot-preview";

const period = {
  reportingFrom: "2026-08-01",
  reportingThrough: "2026-08-08",
  aggregation: "Daily",
};
const headers = "track_title,primary_artist,release_title,isrc,spotify_streams,combined_streams,combined_views";

function parsed(csv: string) {
  return parseSisenseTrackSnapshot(new TextEncoder().encode(csv), "Tracks by Growth Rate.csv", period);
}

function canonicalTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: "track-a",
    artistId: "artist-a",
    isrc: "GBAYE9000123",
    title: "Cherry-coloured Funk",
    releaseTitle: "Heaven or Las Vegas",
    ...overrides,
  };
}

function store(overrides: Partial<SisenseTrackPreviewStore> = {}): SisenseTrackPreviewStore {
  return {
    findArtist: vi.fn().mockResolvedValue({ id: "artist-a", name: "Cocteau Twins" }),
    findTracksByIsrc: vi.fn().mockResolvedValue([]),
    findTracksByIdentity: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function preview(
  previewStore: SisenseTrackPreviewStore,
  snapshot = parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\nUnmatched Song,Cocteau Twins,,,10,11,12\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\n`),
) {
  return previewSisenseTrackSnapshot(previewStore, {
    orgId: "org-a",
    artistId: "artist-a",
    parsed: snapshot,
  });
}

describe("previewSisenseTrackSnapshot", () => {
  it("resolves unique ISRCs, keeps unambiguous source identities, and totals only unique rows", async () => {
    const previewStore = store({ findTracksByIsrc: vi.fn().mockResolvedValue([canonicalTrack()]) });

    const result = await preview(previewStore);

    expect(result.counts).toEqual({
      sourceRows: 3,
      uniqueTracks: 2,
      matched: 1,
      unmatched: 1,
      ambiguous: 0,
      exactDuplicates: 1,
    });
    expect(result.totals).toEqual({ combinedStreams: 54305, combinedViews: 112 });
    expect(result.rows.map((row) => row.persistedRowKey)).toEqual([
      "artist:artist-a:track:track-a",
      expect.stringMatching(/^artist:artist-a:source:[a-f0-9]{64}$/),
    ]);
    expect(result.rows).toMatchObject([
      { matchStatus: "matched", trackId: "track-a" },
      { matchStatus: "unmatched", trackId: null },
    ]);
  });

  it("uses a unique selected-artist ISRC before title and release fallback", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack({ id: "track-by-isrc", title: "Different title", releaseTitle: null })]);
    const findTracksByIdentity = vi.fn().mockResolvedValue([canonicalTrack({ id: "track-by-title" })]);
    const previewStore = store({ findTracksByIsrc, findTracksByIdentity });

    const result = await preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\n`));

    expect(result.rows[0]).toMatchObject({ trackId: "track-by-isrc", matchStatus: "matched" });
    expect(findTracksByIsrc).toHaveBeenCalledWith({ orgId: "org-a", artistId: "artist-a", isrcs: ["GBAYE9000123"] });
    expect(findTracksByIdentity).not.toHaveBeenCalled();
  });

  it("uses only the selected tenant and artist for normalized title and release fallback", async () => {
    const findTracksByIdentity = vi.fn().mockResolvedValue([
      canonicalTrack(),
      canonicalTrack({ id: "wrong-release", releaseTitle: "Other release" }),
    ]);
    const previewStore = store({ findTracksByIdentity });

    const result = await preview(previewStore, parsed(`${headers}\n  CHERRY-coloured   Funk  ,  Cocteau   Twins  , HEAVEN or LAS VEGAS ,,51575,54294,100\n`));

    expect(result.rows[0]).toMatchObject({ trackId: "track-a", matchStatus: "matched" });
    expect(findTracksByIdentity).toHaveBeenCalledWith({
      orgId: "org-a",
      artistId: "artist-a",
      identities: [{ trackTitle: "cherry-coloured funk", releaseTitle: "heaven or las vegas" }],
    });
  });

  it("blocks a source row whose primary artist conflicts with the selected artist", async () => {
    const previewStore = store();

    await expect(preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Not Cocteau Twins,Heaven or Las Vegas,,51575,54294,100\n`)))
      .rejects.toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
    expect(previewStore.findTracksByIdentity).not.toHaveBeenCalled();
  });

  it("blocks an ISRC that resolves to two selected-artist canonical tracks", async () => {
    const previewStore = store({
      findTracksByIsrc: vi.fn().mockResolvedValue([canonicalTrack(), canonicalTrack({ id: "track-b" })]),
    });

    await expect(preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\n`)))
      .rejects.toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
  });

  it("counts repeated ambiguity for one source identity once and merges its source rows", async () => {
    const previewStore = store({
      findTracksByIsrc: vi.fn().mockResolvedValue([canonicalTrack(), canonicalTrack({ id: "track-b" })]),
    });
    const snapshot = parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51576,54295,101\n`);

    try {
      await preview(previewStore, snapshot);
      throw new Error("Expected preview to reject ambiguous rows");
    } catch (error) {
      expect(error).toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
      expect(error).toMatchObject({
        totalAmbiguityCount: 1,
        ambiguities: [{
          identity: "isrc:GBAYE9000123",
          sourceRows: [2, 3],
          reason: "Identity resolves to multiple canonical tracks",
        }],
      });
    }
  });

  it("keeps distinct valid ISRC ambiguities separate when their metadata is identical", async () => {
    const previewStore = store({
      findTracksByIsrc: vi.fn().mockResolvedValue([
        canonicalTrack({ id: "track-a-1", isrc: "GBAYE9000123" }),
        canonicalTrack({ id: "track-a-2", isrc: "GBAYE9000123" }),
        canonicalTrack({ id: "track-b-1", isrc: "GBAYE9000124" }),
        canonicalTrack({ id: "track-b-2", isrc: "GBAYE9000124" }),
      ]),
    });
    const snapshot = parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000124,51576,54295,101\n`);

    try {
      await preview(previewStore, snapshot);
      throw new Error("Expected preview to reject ambiguous ISRCs");
    } catch (error) {
      expect(error).toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
      expect(error).toMatchObject({
        totalAmbiguityCount: 2,
        ambiguities: [
          {
            identity: "isrc:GBAYE9000123",
            sourceRows: [2],
            reason: "Identity resolves to multiple canonical tracks",
          },
          {
            identity: "isrc:GBAYE9000124",
            sourceRows: [3],
            reason: "Identity resolves to multiple canonical tracks",
          },
        ],
      });
      expect(JSON.stringify(error)).not.toContain("Cherry-coloured Funk");
    }
  });

  it("blocks an ISRC candidate returned outside the selected artist scope", async () => {
    const previewStore = store({
      findTracksByIsrc: vi.fn().mockResolvedValue([canonicalTrack({ artistId: "artist-b" })]),
    });

    await expect(preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\n`)))
      .rejects.toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
  });

  it("falls back without an ISRC lookup for nonblank invalid ISRC evidence", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack()]);
    const findTracksByIdentity = vi.fn().mockResolvedValue([canonicalTrack()]);
    const previewStore = store({ findTracksByIsrc, findTracksByIdentity });

    const result = await preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,N/A,51575,54294,100\n`));

    expect(result.rows[0]).toMatchObject({ trackId: "track-a", matchStatus: "matched" });
    expect(findTracksByIsrc).not.toHaveBeenCalled();
    expect(findTracksByIdentity).toHaveBeenCalledTimes(1);
  });

  it("falls back without an ISRC lookup for structurally invalid alphanumeric ISRC evidence", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack()]);
    const findTracksByIdentity = vi.fn().mockResolvedValue([canonicalTrack()]);
    const previewStore = store({ findTracksByIsrc, findTracksByIdentity });

    const result = await preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE90ABCDE,51575,54294,100\n`));

    expect(result.rows[0]).toMatchObject({ trackId: "track-a", matchStatus: "matched" });
    expect(findTracksByIsrc).not.toHaveBeenCalled();
    expect(findTracksByIdentity).toHaveBeenCalledTimes(1);
  });

  it("normalizes punctuation and case before one batch ISRC lookup", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack()]);
    const previewStore = store({ findTracksByIsrc });

    await preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,gb-aye-90-00123,51575,54294,100\n`));

    expect(findTracksByIsrc).toHaveBeenCalledWith({ orgId: "org-a", artistId: "artist-a", isrcs: ["GBAYE9000123"] });
  });

  it("resolves multiple rows with one bounded catalog call per identity phase", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack()]);
    const findTracksByIdentity = vi.fn().mockResolvedValue([
      canonicalTrack({ id: "track-b", isrc: null, title: "B", releaseTitle: null }),
      canonicalTrack({ id: "track-c", isrc: null, title: "C", releaseTitle: null }),
    ]);
    const previewStore = store({ findTracksByIsrc, findTracksByIdentity });
    const snapshot = parsed(`${headers}\nA,Cocteau Twins,,GBAYE9000123,1,1,1\nB,Cocteau Twins,,GBAYE9000124,2,2,2\nC,Cocteau Twins,,N/A,3,3,3\n`);

    const result = await preview(previewStore, snapshot);

    expect(result.counts).toMatchObject({ uniqueTracks: 3, matched: 3 });
    expect(findTracksByIsrc).toHaveBeenCalledTimes(1);
    expect(findTracksByIsrc).toHaveBeenCalledWith({
      orgId: "org-a", artistId: "artist-a", isrcs: ["GBAYE9000123", "GBAYE9000124"],
    });
    expect(findTracksByIdentity).toHaveBeenCalledTimes(1);
    expect(findTracksByIdentity).toHaveBeenCalledWith({
      orgId: "org-a",
      artistId: "artist-a",
      identities: [
        { trackTitle: "b", releaseTitle: null },
        { trackTitle: "c", releaseTitle: null },
      ],
    });
  });

  it("matches a source row without a release by title alone when exactly one selected-artist track exists", async () => {
    const previewStore = store({ findTracksByIdentity: vi.fn().mockResolvedValue([canonicalTrack()]) });

    const result = await preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,,,51575,54294,100\n`));

    expect(result.rows[0]).toMatchObject({ trackId: "track-a", matchStatus: "matched" });
  });

  it("blocks a title-only fallback when the selected artist has multiple tracks with that title", async () => {
    const previewStore = store({
      findTracksByIdentity: vi.fn().mockResolvedValue([
        canonicalTrack(),
        canonicalTrack({ id: "track-b", releaseTitle: "Other release" }),
      ]),
    });

    await expect(preview(previewStore, parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,,,51575,54294,100\n`)))
      .rejects.toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
  });

  it("returns bounded sanitized ambiguity samples without raw CSV rows", async () => {
    const previewStore = store({ findTracksByIsrc: vi.fn().mockResolvedValue([canonicalTrack()]) });
    const conflictingRows = Array.from({ length: 12 }, (_, index) => (
      `Cherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,${51575 + index},${54294 + index},${100 + index}`
    ));

    try {
      await preview(previewStore, parsed(`${headers}\n${conflictingRows.join("\n")}\n`));
      throw new Error("Expected preview to reject conflicting rows");
    } catch (error) {
      expect(error).toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
      const ambiguityError = error as SisenseTrackSnapshotPreviewAmbiguityError;
      expect(ambiguityError).toMatchObject({
        name: "SisenseTrackSnapshotPreviewAmbiguityError",
        status: 409,
        ambiguities: [{
          identity: "artist:artist-a:track:track-a",
          sourceRows: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          reason: "Conflicting rows resolve to the same identity",
        }],
      });
      expect(JSON.stringify(ambiguityError.ambiguities)).not.toContain("Cherry-coloured Funk");
      expect(JSON.stringify(ambiguityError.ambiguities)).not.toContain("rawRow");
    }
  });

  it("reports the exact ambiguity count separately from capped sanitized samples", async () => {
    const previewStore = store();
    const mismatchedRows = Array.from({ length: 26 }, (_, index) => (
      `Track ${index},Not Cocteau Twins,,,1,1,1`
    ));

    try {
      await preview(previewStore, parsed(`${headers}\n${mismatchedRows.join("\n")}\n`));
      throw new Error("Expected preview to reject mismatched artists");
    } catch (error) {
      expect(error).toBeInstanceOf(SisenseTrackSnapshotPreviewAmbiguityError);
      const ambiguityError = error as SisenseTrackSnapshotPreviewAmbiguityError;
      expect(ambiguityError.totalAmbiguityCount).toBe(26);
      expect(ambiguityError.ambiguities).toHaveLength(25);
      expect(JSON.stringify(ambiguityError.ambiguities)).not.toContain("Track 25");
    }
  });

  it("chunks catalog batch lookups at the documented fixed maximum", async () => {
    const findTracksByIsrc = vi.fn().mockResolvedValue([]);
    const findTracksByIdentity = vi.fn().mockResolvedValue([]);
    const previewStore = store({ findTracksByIsrc, findTracksByIdentity });
    const rowCount = SISENSE_TRACK_PREVIEW_BATCH_SIZE + 1;
    const rows = Array.from({ length: rowCount }, (_, index) => (
      `Track ${index},Cocteau Twins,,GBAYE${String(index).padStart(7, "0")},1,1,1`
    ));

    const result = await preview(previewStore, parsed(`${headers}\n${rows.join("\n")}\n`));

    expect(result.counts).toMatchObject({ uniqueTracks: rowCount, unmatched: rowCount });
    expect(findTracksByIsrc).toHaveBeenCalledTimes(2);
    expect(findTracksByIsrc.mock.calls.map(([input]) => input.isrcs.length)).toEqual([
      SISENSE_TRACK_PREVIEW_BATCH_SIZE,
      1,
    ]);
    expect(findTracksByIdentity).toHaveBeenCalledTimes(2);
    expect(findTracksByIdentity.mock.calls.map(([input]) => input.identities.length)).toEqual([
      SISENSE_TRACK_PREVIEW_BATCH_SIZE,
      1,
    ]);
  });

  it("rejects totals that exceed the safe integer range", async () => {
    const previewStore = store();
    const snapshot = parsed(`${headers}\nA,Cocteau Twins,,,1,9007199254740991,0\nB,Cocteau Twins,,,1,9007199254740991,0\n`);

    await expect(preview(previewStore, snapshot)).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
      message: "Sisense snapshot totals exceed safe integer range",
    });
  });

  it("does not allow a client-supplied organization field to influence store scope", async () => {
    const findArtist = vi.fn().mockResolvedValue({ id: "artist-a", name: "Cocteau Twins" });
    const findTracksByIsrc = vi.fn().mockResolvedValue([canonicalTrack()]);
    const previewStore = store({ findArtist, findTracksByIsrc });
    const input = {
      orgId: "active-org",
      artistId: "artist-a",
      parsed: parsed(`${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,100\n`),
      organizationId: "attacker-org",
    };

    await previewSisenseTrackSnapshot(previewStore, input);

    expect(findArtist).toHaveBeenCalledWith({ orgId: "active-org", artistId: "artist-a" });
    expect(findTracksByIsrc).toHaveBeenCalledWith({ orgId: "active-org", artistId: "artist-a", isrcs: ["GBAYE9000123"] });
  });
});
