import { describe, expect, it, vi } from "vitest";
import { deriveCanonicalTrackCandidates, getReleaseSamplyReview, selectMappedSamplyTrackId } from "./samply-release";

vi.mock("../lib/db", () => ({ db: { select: vi.fn() } }));
import { db } from "../lib/db";

describe("deriveCanonicalTrackCandidates", () => {
  it("preserves Samply custom order instead of sorting stacks by creation time", () => {
    const candidates = deriveCanonicalTrackCandidates([
      {
        id: "stack-former-actress",
        object: "stack",
        name: "Former Actress Edit",
        timeCreated: 300,
        children: [{ id: "file-former-actress", name: "v1" }],
      },
      {
        id: "file-former-actress",
        object: "file",
        name: "former-actress.wav",
        duration: 120,
      },
      {
        id: "stack-dj-python",
        object: "stack",
        name: "DJ Python Remix",
        timeCreated: 100,
        children: [{ id: "file-dj-python", name: "v1" }],
      },
      {
        id: "file-dj-python",
        object: "file",
        name: "dj-python.wav",
        duration: 120,
      },
    ]);

    expect(candidates.map((candidate) => candidate.trackTitle)).toEqual([
      "Former Actress Edit",
      "DJ Python Remix",
    ]);
  });
});

describe("selectMappedSamplyTrackId", () => {
  it("uses only an established mapping to a canonical track with a work", () => {
    const tracks = [
      { id: "canonical-track", workId: "work-1" },
      { id: "unlinked-track", workId: null },
    ];

    expect(selectMappedSamplyTrackId("canonical-track", tracks)).toBe("canonical-track");
    expect(selectMappedSamplyTrackId("unlinked-track", tracks)).toBeNull();
    expect(selectMappedSamplyTrackId("same-title-but-unmapped", tracks)).toBeNull();
  });
});


describe("getReleaseSamplyReview", () => {
  it("streams each inventory file independently, including recordings without catalogue mappings", async () => {
    const rows = [
      [{ id: "project", remoteProjectId: "remote-project", metadata: {} }],
      [],
      [
        { id: "v1", trackId: "track", remoteBoxId: "file-1", fileName: "Take v1.wav", audioUrl: "/catalogue-selected.wav" },
        { id: "v2", trackId: "track", remoteBoxId: "file-2", fileName: "Take v2.wav", audioUrl: "/catalogue-selected.wav" },
        { id: "unmapped", trackId: null, remoteBoxId: "file-3", fileName: "Demo.wav", audioUrl: null },
      ],
      [{ count: "3" }],
    ];
    vi.mocked(db.select).mockImplementation(() => {
      const result = Promise.resolve(rows.shift());
      return Object.assign(result, {
        from: () => result, where: () => result, leftJoin: () => result,
        orderBy: () => result, limit: () => result,
      }) as unknown as ReturnType<typeof db.select>;
    });
    try {
      const review = await getReleaseSamplyReview("org", "release");
      expect(review.inventory.map(file => file.audioUrl)).toEqual([
        "/api/releases/release/samply/files/file-1/download",
        "/api/releases/release/samply/files/file-2/download",
        "/api/releases/release/samply/files/file-3/download",
      ]);
      expect(review.inventory[2].trackId).toBeNull();
    } finally { vi.mocked(db.select).mockReset(); }
  });
});
