import { describe, expect, it } from "vitest";
import { normalizeSpotifyText, proposeSpotifyIdentity } from "./spotify-identity-core";

describe("Spotify identity proposals", () => {
  it("normalizes punctuation and diacritics for conservative title matching", () => {
    expect(normalizeSpotifyText("Beyoncé — Live!")) .toBe("beyonce live");
  });

  it("prefers exact ISRC but still requires confirmation", () => {
    const result = proposeSpotifyIdentity(
      { object_type: "track", external_id: "sp-track", name: "Track", artist_name: "Artist", isrc: "ISRC-123" },
      [{ object_type: "track", object_id: "track-1", title: "Different title", artist_name: "Other", isrc: "isrc-123" }],
    );
    expect(result).toMatchObject({ status: "needs_confirmation", match_method: "isrc", confidence: 100 });
  });

  it("does not silently choose tied title/artist candidates", () => {
    const result = proposeSpotifyIdentity(
      { object_type: "album", external_id: "sp-album", name: "Album", artist_name: "Artist" },
      [
        { object_type: "album", object_id: "release-1", title: "Album", artist_name: "Artist" },
        { object_type: "album", object_id: "release-2", title: "Album", artist_name: "Artist" },
      ],
    );
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.object_id)).toEqual(["release-1", "release-2"]);
  });
});
