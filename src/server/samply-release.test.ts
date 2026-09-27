import { describe, expect, it } from "vitest";
import { deriveCanonicalTrackCandidates, selectMappedSamplyTrackId } from "./samply-release";

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
