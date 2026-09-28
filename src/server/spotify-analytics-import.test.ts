import { describe, expect, it } from "vitest";
import { resolveSpotifyPrivateAnalyticsBucket, spotifyAudienceArchiveKey } from "./spotify-analytics-import";

describe("Spotify private archive", () => {
  it("requires a dedicated private analytics bucket distinct from public media storage", () => {
    expect(() => resolveSpotifyPrivateAnalyticsBucket({})).toThrow("R2_ANALYTICS_PRIVATE_BUCKET");
    expect(() => resolveSpotifyPrivateAnalyticsBucket({
      R2_ANALYTICS_PRIVATE_BUCKET: "label-suite-private-analytics",
      R2_BUCKET: "label-suite-public-media",
      R2_PUBLIC_BASE_URL: "https://media.example.com",
    })).not.toThrow();
    expect(() => resolveSpotifyPrivateAnalyticsBucket({
      R2_ANALYTICS_PRIVATE_BUCKET: "label-suite",
      R2_BUCKET: "label-suite",
    })).toThrow("must be distinct from R2_BUCKET");
  });

  it("keeps lossy artist-id sanitization collision-safe in deterministic archive keys", () => {
    const sha256 = "a".repeat(64);

    expect(spotifyAudienceArchiveKey("artist/a", sha256)).not.toBe(spotifyAudienceArchiveKey("artist-a", sha256));
    expect(spotifyAudienceArchiveKey("artist-a", sha256)).toBe(`analytics/spotify-for-artists/artist-a/audience-timeline/${sha256}.csv`);
  });

});
