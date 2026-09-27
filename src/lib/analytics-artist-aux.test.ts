import { describe, expect, it } from "vitest";
import { LEGACY_UNSCOPED_ANALYTICS_ENABLED } from "./analytics-legacy-policy";
import { mapCanonicalArtistPlaylistRows, mapCanonicalArtistShazamRows } from "./analytics-artist-aux";

describe("canonical artist analytics auxiliaries", () => {
  it("keeps playlist and Shazam rows available while legacy views are disabled", () => {
    expect(LEGACY_UNSCOPED_ANALYTICS_ENABLED).toBe(false);
    expect(mapCanonicalArtistPlaylistRows([{
      dimensions: { playlist__name: "Discover Weekly", playlist__owner_id: "owner-1" },
      metrics: { streams: "42", latest_position: 3 },
    }])).toEqual([{ name: "Discover Weekly", ownerId: "owner-1", streams: 42, latestPosition: 3 }]);
    expect(mapCanonicalArtistShazamRows([{
      dimensions: { city: "Copenhagen", country: "Denmark" },
      metrics: { shazams: "9" },
    }])).toEqual([{ city: "Copenhagen", country: "Denmark", shazams: 9 }]);
  });
});
