import { describe, expect, it } from "vitest";
import type { NativeMusicCatalogue } from "../server/native-music-import";
import { groupNativeMusicDays, musicBucketStart } from "./native-music-history";
const capture = (id = "song-a", values: (number | null)[] = [2, 0, 5]): NativeMusicCatalogue => ({
  version: 1, periodKind: "daily", artistId: "artist", runId: id, provider: "spotify_for_artists", providerArtistId: "A".repeat(22),
  artistName: "Fixture", capturedAt: "2026-02-03T12:00:00Z", dateFrom: "2026-01-30", dateThrough: "2026-02-01", territory: "worldwide",
  metric: "audio_streams", artistTotal: null, acquisition: "signed_in_browser_capture", sourceUrl: "https://example.invalid/artist",
  rows: [{ recordingId: id, title: "Same title", value: 7, sourceUrl: "https://example.invalid/song", daily: values.map((value, i) => ({ date: ["2026-01-30", "2026-01-31", "2026-02-01"][i], value })) }],
});
const options = { from: "2026-01-30", through: "2026-02-01", grain: "month" as const };
describe("provider daily calendar totals", () => {
  it("groups exact days into UTC calendar months and Monday weeks, retaining true zero", () => {
    const result = groupNativeMusicDays([capture()], options);
    expect(result.points.map(point => point.value)).toEqual([2, 5]);
    expect(result.total).toBe(7);
    expect(result.completeSongs).toBe(1);
    expect(musicBucketStart("2026-02-01", "week")).toBe("2026-01-26");
    expect(musicBucketStart("2026-02-02", "week")).toBe("2026-02-02");
  });
  it("does not treat missing songs or missing days as zero or merge identical titles", () => {
    const missing = capture("song-b"); delete missing.rows[0].daily; delete missing.periodKind;
    const result = groupNativeMusicDays([capture(), missing], options);
    expect(result.total).toBeNull(); expect(result.completeSongs).toBe(1); expect(result.songs).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ value: null, knownValue: 2, knownCells: 2, expectedCells: 4 });
    expect(groupNativeMusicDays([capture("song-a", [2, null, 5])], options).total).toBeNull();
  });
  it("uses the latest observation for overlapping daily imports without adding duplicates", () => {
    const latest = capture("song-a", [3, 0, 5]); latest.capturedAt = "2026-02-04T12:00:00Z";
    expect(groupNativeMusicDays([latest, capture()], options).total).toBe(8);
    latest.capturedAt = capture().capturedAt;
    expect(groupNativeMusicDays([latest, capture()], options).total).toBeNull();
  });
});
