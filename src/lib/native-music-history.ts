import type { NativeMusicCatalogue } from "../server/native-music-import";

export type MusicGrain = "day" | "week" | "month" | "year";
export const musicSongKey = (artistId: string, provider: string, recordingId: string) => `${artistId}:${provider}:${recordingId}`;
const dayMS = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Calendar buckets in UTC. Weeks start Monday; clipped edge buckets retain their actual dates. */
export function musicBucketStart(date: string, grain: MusicGrain): string {
  const value = new Date(`${date}T00:00:00Z`);
  if (grain === "week") value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  if (grain === "month") value.setUTCDate(1);
  if (grain === "year") { value.setUTCMonth(0); value.setUTCDate(1); }
  return iso(value.getTime());
}

export function nativeMusicSongs(captures: NativeMusicCatalogue[]) {
  const songs = new Map<string, { key: string; artistId: string; provider: string; recordingId: string; title: string }>();
  // Current catalogue membership is the expected denominator. A one-song daily
  // sample must never be presented as the artist's complete daily total.
  const catalogues = captures.filter(capture => capture.periodKind !== "daily");
  for (const capture of [...catalogues, ...captures.filter(capture => capture.periodKind === "daily")]) {
    for (const song of capture.rows) {
      const key = musicSongKey(capture.artistId, capture.provider, song.recordingId);
      if (!songs.has(key)) songs.set(key, { key, artistId: capture.artistId, provider: capture.provider, recordingId: song.recordingId, title: song.title });
    }
  }
  return [...songs.values()];
}

export function groupNativeMusicDays(captures: NativeMusicCatalogue[], options: {
  from: string; through: string; grain: MusicGrain; song?: string;
}) {
  const start = Date.parse(`${options.from}T00:00:00Z`), end = Date.parse(`${options.through}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 10000 * dayMS) throw new Error("Invalid music history range");
  const songs = nativeMusicSongs(captures).filter(song => !options.song || song.key === options.song);
  const values = new Map<string, { observedAt: number; value: number | null }>();
  for (const capture of captures.filter(item => item.periodKind === "daily")) {
    for (const song of capture.rows) {
      const songKey = musicSongKey(capture.artistId, capture.provider, song.recordingId);
      for (const point of song.daily ?? []) {
        const key = `${songKey}:${point.date}`, old = values.get(key), observedAt = Date.parse(capture.capturedAt);
        if (!old || observedAt > old.observedAt) values.set(key, { observedAt, value: point.value });
        else if (observedAt === old.observedAt && old.value !== point.value) old.value = null;
      }
    }
  }
  const buckets = new Map<string, { from: string; through: string; value: number | null; knownValue: number; knownCells: number; expectedCells: number }>();
  const songTotals = songs.map(song => ({ ...song, value: 0 as number | null, knownDays: 0, expectedDays: (end - start) / dayMS + 1 }));
  for (let time = start; time <= end; time += dayMS) {
    const date = iso(time), bucketKey = musicBucketStart(date, options.grain);
    const bucket = buckets.get(bucketKey) ?? { from: date, through: date, value: songs.length ? 0 : null, knownValue: 0, knownCells: 0, expectedCells: 0 };
    bucket.through = date;
    for (const song of songTotals) {
      const value = values.get(`${song.key}:${date}`)?.value;
      bucket.expectedCells += 1;
      if (value === undefined || value === null) { bucket.value = null; song.value = null; }
      else {
        bucket.knownCells += 1; bucket.knownValue += value; song.knownDays += 1;
        if (bucket.value !== null) bucket.value += value;
        if (song.value !== null) song.value += value;
      }
    }
    if (!Number.isSafeInteger(bucket.knownValue)) throw new Error("Music history total exceeds supported precision");
    buckets.set(bucketKey, bucket);
  }
  const points = [...buckets.values()];
  const total = points.length && points.every(point => point.value !== null) ? points.reduce((sum, point) => sum + point.value!, 0) : null;
  if (total !== null && !Number.isSafeInteger(total)) throw new Error("Music history total exceeds supported precision");
  return { points, songs: songTotals, total, completeSongs: songTotals.filter(song => song.knownDays === song.expectedDays).length };
}
