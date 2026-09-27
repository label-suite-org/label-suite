import { createHash } from "node:crypto";
import { HttpError } from "./errors";

export const SISENSE_TRACK_SOURCE = "sisense";
export const SISENSE_TRACK_WIDGET = "tracks-by-growth-rate";
export const SISENSE_TRACK_MAX_BYTES = 5 * 1024 * 1024;
export const SISENSE_TRACK_MAX_ROWS = 100_000;
export const SISENSE_TRACK_MAX_COLUMNS = 256;
export const SISENSE_TRACK_MAX_HEADER_LENGTH = 256;
export const SISENSE_TRACK_MAX_CELL_LENGTH = 64 * 1024;

const aliases = {
  trackTitle: ["track_title", "track", "track_name", "title"],
  primaryArtist: ["primary_artist", "artist", "artist_name", "main_artist"],
  releaseTitle: ["release_title", "release", "album"],
  isrc: ["isrc", "track_isrc", "recording_isrc"],
  spotify_streams: ["spotify_streams"],
  apple_streams: ["apple_streams"],
  amazon_streams: ["amazon_streams"],
  pandora_streams: ["pandora_streams"],
  combined_streams: ["combined_streams", "streams"],
  streams_growth: ["streams_growth", "growth"],
  youtube_views: ["youtube_views"],
  tiktok_views: ["tiktok_views"],
  combined_views: ["combined_views", "views"],
  views_growth: ["views_growth", "views_delta"],
} as const;

type AliasKey = keyof typeof aliases;
type CumulativeMetric = Exclude<AliasKey, "trackTitle" | "primaryArtist" | "releaseTitle" | "isrc" | "streams_growth" | "views_growth">;
type GrowthMetric = "streams_growth" | "views_growth";
const platformOrViewMetricKeys = [
  "spotify_streams", "apple_streams", "amazon_streams", "pandora_streams",
  "youtube_views", "tiktok_views", "combined_views",
] as const;

export interface SisenseTrackPeriod {
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
}

export interface SisenseTrackMetrics {
  combined_streams: number;
  spotify_streams?: number;
  apple_streams?: number;
  amazon_streams?: number;
  pandora_streams?: number;
  streams_growth?: number;
  youtube_views?: number;
  tiktok_views?: number;
  combined_views?: number;
  views_growth?: number;
}

export interface ParsedSisenseTrackRow {
  sourceRow: number;
  trackTitle: string;
  primaryArtist: string;
  releaseTitle: string | null;
  isrc: string | null;
  metrics: SisenseTrackMetrics;
  rawRow: Record<string, string>;
  rowHash: string;
  sourceIdentity: string;
}

export interface ParsedSisenseTrackSnapshot {
  fileName: string;
  sha256: string;
  byteSize: number;
  headers: string[];
  reportingFrom: string;
  reportingThrough: string;
  requestedDateRange: string;
  aggregation: string;
  sourceRowCount: number;
  exactDuplicateCount: number;
  rows: ParsedSisenseTrackRow[];
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let afterClosingQuote = false;
  let atFieldStart = true;

  const appendToField = (value: string) => {
    if (field.length + value.length > SISENSE_TRACK_MAX_CELL_LENGTH) {
      throw new HttpError(
        `Sisense CSV cells must not exceed ${SISENSE_TRACK_MAX_CELL_LENGTH} characters`,
        413,
      );
    }
    field += value;
  };

  const pushField = () => {
    if (record.length >= SISENSE_TRACK_MAX_COLUMNS) {
      throw new HttpError(`Sisense CSV exceeds ${SISENSE_TRACK_MAX_COLUMNS} columns`, 413);
    }
    record.push(field);
    field = "";
  };

  const finishRecord = () => {
    pushField();
    records.push(record);
    record = [];
    atFieldStart = true;
    afterClosingQuote = false;
    if (records.length > SISENSE_TRACK_MAX_ROWS + 1) {
      throw new HttpError(`Sisense CSV exceeds ${SISENSE_TRACK_MAX_ROWS} data rows`, 413);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendToField('"');
          index += 1;
        } else {
          quoted = false;
          afterClosingQuote = true;
        }
      } else {
        appendToField(character);
      }
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        pushField();
        atFieldStart = true;
        afterClosingQuote = false;
      } else if (character === "\n") {
        finishRecord();
      } else if (character === "\r" && text[index + 1] === "\n") {
        finishRecord();
        index += 1;
      } else {
        throw new HttpError("Invalid CSV: unexpected character after closing quote", 400);
      }
    } else if (character === '"') {
      if (!atFieldStart) throw new HttpError("Invalid CSV: unexpected quote", 400);
      quoted = true;
      atFieldStart = false;
    } else if (character === ",") {
      pushField();
      atFieldStart = true;
    } else if (character === "\n") {
      finishRecord();
    } else if (character === "\r" && text[index + 1] === "\n") {
      finishRecord();
      index += 1;
    } else {
      appendToField(character);
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
  return sanitized || "sisense-tracks-by-growth-rate.csv";
}

function normalizedIdentityPart(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceIdentity(primaryArtist: string, trackTitle: string, releaseTitle: string | null): string {
  const normalized = [primaryArtist, trackTitle, releaseTitle].map(normalizedIdentityPart);
  return `source:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

function parseCumulativeMetric(value: string, key: CumulativeMetric, rowNumber: number): number {
  if (!/^\d+$/.test(value)) {
    throw new HttpError(`${key} must be a non-negative whole number at row ${rowNumber}`, 400);
  }
  const metric = Number(value);
  if (!Number.isSafeInteger(metric)) {
    throw new HttpError(`${key} must be a non-negative whole number at row ${rowNumber}`, 400);
  }
  return metric;
}

function parseGrowthMetric(value: string, key: GrowthMetric, rowNumber: number): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new HttpError(`${key} must be a finite decimal at row ${rowNumber}`, 400);
  }
  const metric = Number(value);
  if (!Number.isFinite(metric)) {
    throw new HttpError(`${key} must be a finite decimal at row ${rowNumber}`, 400);
  }
  return metric;
}

function headerKey(header: string): string {
  return header.trim().toLowerCase();
}

function resolveHeaders(headers: string[]): Map<AliasKey, string> {
  if (headers.some((header) => header.length > SISENSE_TRACK_MAX_HEADER_LENGTH)) {
    throw new HttpError(
      `Sisense CSV header names must not exceed ${SISENSE_TRACK_MAX_HEADER_LENGTH} characters`,
      413,
    );
  }
  const knownAliases = new Map<string, AliasKey>();
  for (const [key, values] of Object.entries(aliases) as Array<[AliasKey, readonly string[]]>) {
    for (const value of values) knownAliases.set(value, key);
  }

  const resolved = new Map<AliasKey, string>();
  const seen = new Set<string>();
  for (const header of headers) {
    const normalized = headerKey(header);
    if (!normalized || seen.has(normalized)) {
      throw new HttpError("Sisense Tracks by Growth Rate headers must be unique", 415);
    }
    seen.add(normalized);
    const key = knownAliases.get(normalized);
    if (!key) continue;
    if (resolved.has(key)) throw new HttpError("Unsupported Sisense Tracks by Growth Rate headers", 415);
    resolved.set(key, header);
  }

  if (!resolved.has("trackTitle") || !resolved.has("primaryArtist") || !resolved.has("combined_streams")) {
    throw new HttpError("Unsupported Sisense Tracks by Growth Rate headers", 415);
  }
  if (!platformOrViewMetricKeys.some((key) => resolved.has(key))) {
    throw new HttpError("Unsupported Sisense Tracks by Growth Rate headers", 415);
  }
  return resolved;
}

function requiredValue(rawRow: Record<string, string>, header: string, rowNumber: number): string {
  const value = rawRow[header].trim();
  if (!value) throw new HttpError(`${headerKey(header)} is required at row ${rowNumber}`, 400);
  return value;
}

export function validateSisenseTrackPeriod(input: unknown): SisenseTrackPeriod {
  if (!input || typeof input !== "object") throw new HttpError("Sisense reporting period is required", 400);
  const value = input as Record<string, unknown>;
  if (typeof value.reportingFrom !== "string" || !validIsoDate(value.reportingFrom)) {
    throw new HttpError("reportingFrom must be a valid ISO date", 400);
  }
  if (typeof value.reportingThrough !== "string" || !validIsoDate(value.reportingThrough)) {
    throw new HttpError("reportingThrough must be a valid ISO date", 400);
  }
  if (value.reportingFrom > value.reportingThrough) {
    throw new HttpError("reportingFrom must not be after reportingThrough", 400);
  }
  if (value.aggregation !== undefined && (typeof value.aggregation !== "string" || !value.aggregation.trim())) {
    throw new HttpError("aggregation must be a non-empty string", 400);
  }
  return {
    reportingFrom: value.reportingFrom,
    reportingThrough: value.reportingThrough,
    aggregation: typeof value.aggregation === "string" ? value.aggregation.trim() : "Daily",
  };
}

export function parseSisenseTrackSnapshot(
  bytes: Uint8Array,
  fileName: string,
  periodInput: unknown,
): ParsedSisenseTrackSnapshot {
  if (bytes.byteLength > SISENSE_TRACK_MAX_BYTES) {
    throw new HttpError("Sisense CSV exceeds 5 MiB", 413);
  }
  if (bytes.includes(0)) throw new HttpError("Sisense CSV contains NUL bytes", 415);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError("Sisense CSV must be valid UTF-8", 415);
  }
  if (text.startsWith("\uFEFF")) text = text.slice(1);

  const records = parseCsvRecords(text);
  if (records.length === 0) throw new HttpError("Sisense CSV is empty", 400);

  const headers = records[0];
  const headerMap = resolveHeaders(headers);
  const dataRecords = records.slice(1);
  const period = validateSisenseTrackPeriod(periodInput);
  const exactRows = new Set<string>();
  let exactDuplicateCount = 0;
  const rows: ParsedSisenseTrackRow[] = [];

  for (const [index, record] of dataRecords.entries()) {
    const sourceRow = index + 2;
    if (record.length !== headers.length) {
      throw new HttpError(`Expected ${headers.length} columns at row ${sourceRow}`, 400);
    }
    const rawRow = Object.fromEntries(headers.map((header, column) => [header, record[column]]));
    const trackTitle = requiredValue(rawRow, headerMap.get("trackTitle")!, sourceRow);
    const primaryArtist = requiredValue(rawRow, headerMap.get("primaryArtist")!, sourceRow);
    const releaseHeader = headerMap.get("releaseTitle");
    const isrcHeader = headerMap.get("isrc");
    const releaseTitle = releaseHeader ? rawRow[releaseHeader].trim() || null : null;
    const isrc = isrcHeader ? rawRow[isrcHeader].trim() || null : null;
    const metrics = {} as SisenseTrackMetrics;

    for (const [key, header] of headerMap.entries()) {
      if (key === "trackTitle" || key === "primaryArtist" || key === "releaseTitle" || key === "isrc") continue;
      const rawValue = rawRow[header].trim();
      if (!rawValue && key !== "combined_streams") continue;
      if (key === "streams_growth" || key === "views_growth") {
        metrics[key] = parseGrowthMetric(rawValue, key, sourceRow);
      } else {
        metrics[key] = parseCumulativeMetric(rawValue, key, sourceRow);
      }
    }
    if (!platformOrViewMetricKeys.some((key) => metrics[key] !== undefined)) {
      throw new HttpError(`A platform or view metric is required at row ${sourceRow}`, 400);
    }

    const normalizedSourceIdentity = sourceIdentity(primaryArtist, trackTitle, releaseTitle);
    const rowHash = createHash("sha256").update(JSON.stringify(rawRow)).digest("hex");
    const dedupeKey = `${normalizedSourceIdentity}:${rowHash}`;
    if (exactRows.has(dedupeKey)) {
      exactDuplicateCount += 1;
      continue;
    }
    exactRows.add(dedupeKey);
    rows.push({ sourceRow, trackTitle, primaryArtist, releaseTitle, isrc, metrics, rawRow, rowHash, sourceIdentity: normalizedSourceIdentity });
  }

  return {
    fileName: sanitizeFileName(fileName),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    headers,
    reportingFrom: period.reportingFrom,
    reportingThrough: period.reportingThrough,
    requestedDateRange: `${period.reportingFrom} to ${period.reportingThrough}`,
    aggregation: period.aggregation,
    sourceRowCount: dataRecords.length,
    exactDuplicateCount,
    rows,
  };
}
