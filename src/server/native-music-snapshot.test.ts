import { describe, expect, it } from "vitest";
import { nativeCatalogueTotal, parseNativeMusicSnapshot } from "./native-music-snapshot";

const artist = "A".repeat(22);
const recording = "B".repeat(22);
const snapshot = () => ({ version: 1, provider: "spotify_for_artists", providerArtistId: artist, artistName: "Fixture artist",
  capturedAt: "2026-10-26T12:00:00Z", dateFrom: "2026-10-12", dateThrough: "2026-10-24", territory: "worldwide",
  metric: "audio_streams", artistTotal: null, acquisition: "signed_in_browser_capture", sourceUrl: `https://artists.spotify.com/c/artist/${artist}/music/songs`,
  rows: [{ recordingId: recording, title: "Same title", value: 17, sourceUrl: `https://artists.spotify.com/c/artist/${artist}/song/${recording}/stats` }] });
const parse = (value: unknown) => parseNativeMusicSnapshot(new TextEncoder().encode(JSON.stringify(value)));

describe("native music catalogue observations", () => {
  it("retains distinct IDs with identical titles and preserves period scope", () => {
    const input = snapshot();
    input.rows.push({ ...input.rows[0], recordingId: "C".repeat(22), sourceUrl: input.rows[0].sourceUrl.replace(recording, "C".repeat(22)), value: 3 });
    const parsed = parse(input);
    expect(parsed.snapshot.rows).toHaveLength(2);
    expect(parsed.total).toBe(20);
    expect(parsed.snapshot.dateFrom).toBe("2026-10-12");
    expect(parsed.snapshot.metric).toBe("audio_streams");
  });
  it("rejects duplicate identities instead of double-counting releases", () => {
    const input = snapshot(); input.rows.push({ ...input.rows[0], title: "Another release title" });
    expect(() => parse(input)).toThrow(/identity/);
  });
  it("keeps missing observations unknown while retaining measured zero", () => {
    const input = snapshot();
    const unknown = parse({ ...input, rows: [{ ...input.rows[0], value: null }] });
    expect(unknown.total).toBeNull();
    expect(parse({ ...input, rows: [{ ...input.rows[0], value: 0 }] }).total).toBe(0);
    expect(nativeCatalogueTotal([])).toBeNull();
  });
  it("rejects mismatched artist, metric, territory and dates", () => {
    for (const patch of [{ metric: "plays" }, { territory: "US" }, { dateFrom: "2026-10-25" }, { dateThrough: "2026-11-01" },
      { providerArtistId: "D".repeat(22) }, { dateFrom: "2026-02-30" }]) expect(() => parse({ ...snapshot(), ...patch })).toThrow();
  });
  it("imports Apple versions independently with Apple plays semantics", () => {
    const input = { ...snapshot(), provider: "apple_music_for_artists", providerArtistId: "ami:identity:fixture", metric: "plays",
      sourceUrl: "https://artists.apple.com/ui/measure/artist/ami:identity:fixture/your-music/songs",
      rows: [{ recordingId: "12345", title: "Song (Club)", value: 12, sourceUrl: "https://artists.apple.com/ui/measure/artist/ami:identity:fixture/your-music/song/12345" }] };
    expect(parse(input).total).toBe(12);
  });
});
