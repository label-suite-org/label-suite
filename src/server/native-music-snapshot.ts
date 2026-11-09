import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./errors";

export const NATIVE_MUSIC_WIDGET = "native-song-catalogue";
export const NATIVE_MUSIC_MAX_BYTES = 5 * 1024 * 1024;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const date = z.iso.date();
const snapshotSchema = z.object({
  version: z.literal(1),
  // Absent in existing dated captures. Never infer lifetime from a long window.
  periodKind: z.enum(["all_time", "daily"]).optional(),
  provider: z.enum(["spotify_for_artists", "apple_music_for_artists"]),
  providerArtistId: z.string().min(1).max(100),
  artistName: z.string().min(1).max(300),
  capturedAt: z.iso.datetime(),
  dateFrom: date.nullable(),
  dateThrough: date.nullable(),
  territory: z.literal("worldwide"),
  metric: z.enum(["audio_streams", "plays"]),
  artistTotal: count,
  acquisition: z.literal("signed_in_browser_capture"),
  sourceUrl: z.url(),
  rows: z.array(z.object({
    recordingId: z.string().min(1).max(100),
    title: z.string().min(1).max(500),
    value: count,
    sourceUrl: z.url(),
    daily: z.array(z.object({ date, value: count }).strict()).min(1).max(10000).optional(),
  }).strict()).min(1).max(10000),
}).strict();

export type NativeMusicSnapshot = z.infer<typeof snapshotSchema>;

export function nativeCatalogueTotal(rows: NativeMusicSnapshot["rows"]): number | null {
  if (!rows.length || rows.some((row) => row.value === null)) return null;
  const total = rows.reduce((sum, row) => sum + row.value!, 0);
  return Number.isSafeInteger(total) ? total : null;
}

/** A provider observation; lifetime scope must be explicitly present in its source. */
export function parseNativeMusicSnapshot(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > NATIVE_MUSIC_MAX_BYTES) throw new HttpError("Native music snapshot exceeds the file size limit", 400);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError("Native music snapshot must be UTF-8 JSON", 400); }
  const result = snapshotSchema.safeParse(data);
  if (!result.success) throw new HttpError("Native music snapshot has invalid fields", 400);
  const snapshot = result.data;
  if ((snapshot.periodKind !== "all_time" && (!snapshot.dateFrom || !snapshot.dateThrough)) ||
      (snapshot.dateFrom && snapshot.dateThrough && snapshot.dateFrom > snapshot.dateThrough) ||
      (snapshot.dateThrough && snapshot.dateThrough > snapshot.capturedAt.slice(0, 10))) {
    throw new HttpError("Native music snapshot has invalid reporting dates", 400);
  }
  const spotify = snapshot.provider === "spotify_for_artists";
  const host = spotify ? "artists.spotify.com" : "artists.apple.com";
  if (!(spotify ? /^[A-Za-z0-9]{22}$/ : /^ami:identity:[A-Za-z0-9]+$/).test(snapshot.providerArtistId) ||
      (spotify && snapshot.artistTotal !== null)) {
    throw new HttpError("Native artist identity or rollup scope is invalid", 400);
  }
  const artistPath = spotify ? `/c/artist/${snapshot.providerArtistId}/` : `/ui/measure/artist/${snapshot.providerArtistId}/`;
  const source = new URL(snapshot.sourceUrl);
  if (source.protocol !== "https:" || source.host !== host || source.username || source.password ||
      !source.pathname.startsWith(artistPath) || snapshot.metric !== (spotify ? "audio_streams" : "plays")) {
    throw new HttpError("Native music snapshot scope does not match its provider", 400);
  }
  const ids = new Set<string>();
  for (const row of snapshot.rows) {
    const url = new URL(row.sourceUrl);
    const validId = spotify ? /^[A-Za-z0-9]{22}$/.test(row.recordingId) : /^\d+$/.test(row.recordingId);
    const songPath = spotify
      ? `${artistPath}song/${row.recordingId}/stats`
      : `/ui/measure/artist/${snapshot.providerArtistId}/your-music/song/${row.recordingId}`;
    if (!validId || ids.has(row.recordingId) || url.protocol !== "https:" || url.host !== host ||
        url.username || url.password || url.pathname !== songPath) {
      throw new HttpError("Native music snapshot contains a duplicate or invalid recording identity", 400);
    }
    ids.add(row.recordingId);
    if ((snapshot.periodKind === "daily") !== (row.daily !== undefined)) {
      throw new HttpError("Daily observations require explicit daily capture scope", 400);
    }
    if (row.daily) {
      const dates = new Set<string>();
      for (const point of row.daily) {
        if (dates.has(point.date) || point.date < snapshot.dateFrom! || point.date > snapshot.dateThrough!) {
          throw new HttpError("Daily observations contain duplicate or out-of-window dates", 400);
        }
        dates.add(point.date);
      }
      const expectedDays = (Date.parse(snapshot.dateThrough!) - Date.parse(snapshot.dateFrom!)) / 86400000 + 1;
      if (dates.size === expectedDays && row.daily.every(point => point.value !== null)) {
        const sum = row.daily.reduce((total, point) => total + point.value!, 0);
        if (!Number.isSafeInteger(sum) || sum !== row.value) {
          throw new HttpError("Daily observations do not reconcile with the song period total", 400);
        }
      }
    }
  }
  return { snapshot, sha256: createHash("sha256").update(bytes).digest("hex"), total: nativeCatalogueTotal(snapshot.rows) };
}
