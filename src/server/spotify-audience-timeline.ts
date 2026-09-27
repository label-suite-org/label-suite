import { createHash } from "node:crypto";
import { HttpError } from "./errors";

export const SPOTIFY_AUDIENCE_SOURCE = "spotify_for_artists";
export const SPOTIFY_AUDIENCE_WIDGET = "audience-timeline";
export const SPOTIFY_AUDIENCE_AGGREGATION = "Daily";
export const SPOTIFY_AUDIENCE_RANGE = "all_available_history";
export const SPOTIFY_AUDIENCE_MAX_BYTES = 5 * 1024 * 1024;
export const SPOTIFY_AUDIENCE_MAX_ROWS = 100_000;

export const SPOTIFY_AUDIENCE_HEADERS = [
  "date", "listeners", "monthly listeners", "monthly active listeners",
  "super listeners", "streams", "playlist adds", "saves", "followers",
] as const;

export interface SpotifyAudienceMetrics {
  listeners: number;
  monthly_listeners: number;
  monthly_active_listeners: number;
  super_listeners: number;
  streams: number;
  playlist_adds: number;
  saves: number;
  followers: number;
}

export interface SpotifyAudienceRow {
  date: string;
  rowKey: string;
  rowHash: string;
  metrics: SpotifyAudienceMetrics;
  rawRow: Record<string, string>;
}

export interface SpotifyAudienceTimelinePreview {
  fileName: string;
  sha256: string;
  byteSize: number;
  headers: string[];
  rowCount: number;
  dateFrom: string;
  dateThrough: string;
  canonicalRange: typeof SPOTIFY_AUDIENCE_RANGE;
  rows: SpotifyAudienceRow[];
}

const metricHeaders = {
  listeners: "listeners",
  monthly_listeners: "monthly listeners",
  monthly_active_listeners: "monthly active listeners",
  super_listeners: "super listeners",
  streams: "streams",
  playlist_adds: "playlist adds",
  saves: "saves",
  followers: "followers",
} as const satisfies Record<keyof SpotifyAudienceMetrics, typeof SPOTIFY_AUDIENCE_HEADERS[number]>;

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;

  const finishRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
    atFieldStart = true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (!atFieldStart) throw new HttpError("Invalid CSV: unexpected quote", 400);
      quoted = true;
      atFieldStart = false;
    } else if (character === ",") {
      record.push(field);
      field = "";
      atFieldStart = true;
    } else if (character === "\n") {
      finishRecord();
    } else if (character === "\r" && text[index + 1] === "\n") {
      finishRecord();
      index += 1;
    } else {
      field += character;
      atFieldStart = false;
    }
  }

  if (quoted) throw new HttpError("Invalid CSV: unclosed quoted field", 400);
  if (field.length > 0 || record.length > 0) finishRecord();
  return records;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized ? sanitized : "spotify-audience-timeline.csv";
}

function parseMetric(value: string, header: string, rowNumber: number): number {
  if (!/^\d+$/.test(value)) {
    throw new HttpError(`${header} must be a non-negative whole number at row ${rowNumber}`, 400);
  }
  const metric = Number(value);
  if (!Number.isSafeInteger(metric)) {
    throw new HttpError(`${header} must be a non-negative whole number at row ${rowNumber}`, 400);
  }
  return metric;
}

function assertHeaders(headers: string[]): void {
  if (new Set(headers).size !== headers.length) {
    throw new HttpError("Spotify for Artists headers must be unique", 415);
  }
  const expected = new Set<string>(SPOTIFY_AUDIENCE_HEADERS);
  if (headers.length !== expected.size || headers.some((header) => !expected.has(header))) {
    throw new HttpError("Unsupported Spotify for Artists headers", 415);
  }
}

export function parseSpotifyAudienceTimeline(bytes: Uint8Array, fileName: string): SpotifyAudienceTimelinePreview {
  if (bytes.byteLength > SPOTIFY_AUDIENCE_MAX_BYTES) {
    throw new HttpError("Spotify for Artists CSV exceeds 5 MiB", 413);
  }
  if (bytes.includes(0)) throw new HttpError("Spotify for Artists CSV contains NUL bytes", 415);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError("Spotify for Artists CSV must be valid UTF-8", 415);
  }
  if (text.startsWith("\uFEFF")) text = text.slice(1);

  const records = parseCsvRecords(text);
  if (records.length === 0) throw new HttpError("Spotify for Artists CSV is empty", 400);

  const headers = records[0].map((header) => header.trim());
  assertHeaders(headers);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const dataRecords = records.slice(1);
  if (dataRecords.length > SPOTIFY_AUDIENCE_MAX_ROWS) {
    throw new HttpError(`Spotify for Artists CSV exceeds ${SPOTIFY_AUDIENCE_MAX_ROWS} data rows`, 413);
  }

  const dates = new Set<string>();
  const rows = dataRecords.map((record, index) => {
    const rowNumber = index + 2;
    if (record.length !== headers.length) {
      throw new HttpError(`Expected ${headers.length} columns at row ${rowNumber}`, 400);
    }
    const rawRow = Object.fromEntries(headers.map((header, column) => [header, record[column]]));
    const date = rawRow.date;
    if (!validIsoDate(date)) throw new HttpError(`date must be a valid ISO date at row ${rowNumber}`, 400);
    if (dates.has(date)) throw new HttpError(`Duplicate date at row ${rowNumber}`, 400);
    dates.add(date);

    const metrics: SpotifyAudienceMetrics = {
      listeners: parseMetric(rawRow[metricHeaders.listeners], metricHeaders.listeners, rowNumber),
      monthly_listeners: parseMetric(rawRow[metricHeaders.monthly_listeners], metricHeaders.monthly_listeners, rowNumber),
      monthly_active_listeners: parseMetric(rawRow[metricHeaders.monthly_active_listeners], metricHeaders.monthly_active_listeners, rowNumber),
      super_listeners: parseMetric(rawRow[metricHeaders.super_listeners], metricHeaders.super_listeners, rowNumber),
      streams: parseMetric(rawRow[metricHeaders.streams], metricHeaders.streams, rowNumber),
      playlist_adds: parseMetric(rawRow[metricHeaders.playlist_adds], metricHeaders.playlist_adds, rowNumber),
      saves: parseMetric(rawRow[metricHeaders.saves], metricHeaders.saves, rowNumber),
      followers: parseMetric(rawRow[metricHeaders.followers], metricHeaders.followers, rowNumber),
    };
    const rowHash = createHash("sha256").update(JSON.stringify({ date, metrics })).digest("hex");
    return { date, rowKey: `artist-date:${date}`, rowHash, metrics, rawRow };
  });

  const orderedDates = rows.map((row) => row.date).sort();
  return {
    fileName: sanitizeFileName(fileName),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    headers,
    rowCount: rows.length,
    dateFrom: orderedDates[0] ?? "",
    dateThrough: orderedDates.at(-1) ?? "",
    canonicalRange: SPOTIFY_AUDIENCE_RANGE,
    rows,
  };
}
