import { HttpError } from "./errors";
import type {
  ParsedSisenseTrackRow,
  ParsedSisenseTrackSnapshot,
} from "./sisense-track-snapshot";

const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MAX_AMBIGUITY_SAMPLES = 25;
const MAX_SOURCE_ROW_SAMPLES = 10;
export const SISENSE_TRACK_PREVIEW_BATCH_SIZE = 500;

export interface SisenseTrackPreviewArtist {
  id: string;
  name: string;
}

export interface SisenseTrackPreviewTrack {
  id: string;
  artistId: string;
  isrc: string | null;
  title: string;
  releaseTitle: string | null;
}

export interface SisenseTrackPreviewIdentity {
  trackTitle: string;
  /** Null means title-only matching; the store returns every selected-artist release candidate for that title. */
  releaseTitle: string | null;
}

export interface SisenseTrackPreviewStore {
  findArtist(input: { orgId: string; artistId: string }): Promise<SisenseTrackPreviewArtist | null>;
  findTracksByIsrc(input: { orgId: string; artistId: string; isrcs: string[] }): Promise<SisenseTrackPreviewTrack[]>;
  findTracksByIdentity(input: {
    orgId: string;
    artistId: string;
    identities: SisenseTrackPreviewIdentity[];
  }): Promise<SisenseTrackPreviewTrack[]>;
}

export interface SisenseTrackSnapshotPreviewInput {
  orgId: string;
  artistId: string;
  parsed: ParsedSisenseTrackSnapshot;
}

export interface ResolvedSisenseTrackRow extends ParsedSisenseTrackRow {
  trackId: string | null;
  matchStatus: "matched" | "unmatched";
  persistedRowKey: string;
}

export interface SisenseTrackSnapshotPreviewAmbiguity {
  identity: string;
  sourceRows: number[];
  reason: string;
}

export class SisenseTrackSnapshotPreviewAmbiguityError extends HttpError {
  constructor(
    public readonly ambiguities: SisenseTrackSnapshotPreviewAmbiguity[],
    public readonly totalAmbiguityCount: number,
  ) {
    super("Sisense snapshot preview has identity ambiguities", 409);
    this.name = "SisenseTrackSnapshotPreviewAmbiguityError";
  }
}

export interface SisenseTrackSnapshotPreview {
  kind: "preview";
  artistId: string;
  artistName: string;
  fileName: string;
  sha256: string;
  requestedDateRange: string;
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
  counts: {
    sourceRows: number;
    uniqueTracks: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    exactDuplicates: number;
  };
  totals: { combinedStreams: number; combinedViews: number };
  rows: ResolvedSisenseTrackRow[];
  ambiguities: SisenseTrackSnapshotPreviewAmbiguity[];
}

function normalize(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedIsrc(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return ISRC_PATTERN.test(normalized) ? normalized : null;
}

function sourceKey(artistId: string, sourceIdentity: string): string {
  return `artist:${artistId}:source:${sourceIdentity.replace(/^source:/, "")}`;
}

function safeSourceIdentity(row: ParsedSisenseTrackRow): string {
  return `source:${row.sourceIdentity.replace(/^source:/, "")}`;
}

function safeIsrcIdentity(isrc: string): string {
  return `isrc:${isrc}`;
}

function identityKey(identity: SisenseTrackPreviewIdentity): string {
  return JSON.stringify([identity.trackTitle, identity.releaseTitle]);
}

function rowIdentity(row: ParsedSisenseTrackRow): SisenseTrackPreviewIdentity {
  return {
    trackTitle: normalize(row.trackTitle),
    releaseTitle: row.releaseTitle === null ? null : normalize(row.releaseTitle),
  };
}

interface AmbiguityCollector {
  totalAmbiguityCount: number;
  samples: SisenseTrackSnapshotPreviewAmbiguity[];
  seenIdentities: Set<string>;
  samplesByIdentity: Map<string, SisenseTrackSnapshotPreviewAmbiguity>;
}

function mergeSourceRows(current: number[], incoming: number[]): number[] {
  return [...new Set([...current, ...incoming])]
    .sort((left, right) => left - right)
    .slice(0, MAX_SOURCE_ROW_SAMPLES);
}

function addAmbiguity(
  collector: AmbiguityCollector,
  ambiguity: SisenseTrackSnapshotPreviewAmbiguity,
): void {
  const existing = collector.samplesByIdentity.get(ambiguity.identity);
  if (existing) {
    existing.sourceRows = mergeSourceRows(existing.sourceRows, ambiguity.sourceRows);
    existing.reason = existing.reason.localeCompare(ambiguity.reason) <= 0 ? existing.reason : ambiguity.reason;
    return;
  }
  if (collector.seenIdentities.has(ambiguity.identity)) return;

  collector.seenIdentities.add(ambiguity.identity);
  collector.totalAmbiguityCount += 1;
  if (collector.samples.length < MAX_AMBIGUITY_SAMPLES) {
    const sample = {
      ...ambiguity,
      sourceRows: mergeSourceRows([], ambiguity.sourceRows),
    };
    collector.samples.push(sample);
    collector.samplesByIdentity.set(sample.identity, sample);
  }
}

function throwAmbiguities(collector: AmbiguityCollector): never {
  throw new SisenseTrackSnapshotPreviewAmbiguityError(collector.samples, collector.totalAmbiguityCount);
}

function uniqueTracks(tracks: SisenseTrackPreviewTrack[]): SisenseTrackPreviewTrack[] {
  return [...new Map(tracks.map((track) => [track.id, track])).values()];
}

function groupedTracks(
  tracks: SisenseTrackPreviewTrack[],
  keyForTrack: (track: SisenseTrackPreviewTrack) => string | null,
): Map<string, SisenseTrackPreviewTrack[]> {
  const grouped = new Map<string, SisenseTrackPreviewTrack[]>();
  for (const track of tracks) {
    const key = keyForTrack(track);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), track]);
  }
  return grouped;
}

function resolveCandidates(
  candidates: SisenseTrackPreviewTrack[],
  artistId: string,
  identity: string,
  sourceRow: number,
  ambiguities: AmbiguityCollector,
): SisenseTrackPreviewTrack | null | undefined {
  const outsideScope = candidates.filter((track) => track.artistId !== artistId);
  if (outsideScope.length > 0) {
    addAmbiguity(ambiguities, { identity, sourceRows: [sourceRow], reason: "Canonical track is outside the selected artist scope" });
    return undefined;
  }
  const scoped = uniqueTracks(candidates);
  if (scoped.length > 1) {
    addAmbiguity(ambiguities, { identity, sourceRows: [sourceRow], reason: "Identity resolves to multiple canonical tracks" });
    return undefined;
  }
  return scoped[0] ?? null;
}

async function findTracksByIsrcBatches(
  store: SisenseTrackPreviewStore,
  input: Pick<SisenseTrackSnapshotPreviewInput, "orgId" | "artistId">,
  isrcs: string[],
): Promise<SisenseTrackPreviewTrack[]> {
  const tracks: SisenseTrackPreviewTrack[] = [];
  for (let start = 0; start < isrcs.length; start += SISENSE_TRACK_PREVIEW_BATCH_SIZE) {
    tracks.push(...await store.findTracksByIsrc({
      orgId: input.orgId,
      artistId: input.artistId,
      isrcs: isrcs.slice(start, start + SISENSE_TRACK_PREVIEW_BATCH_SIZE),
    }));
  }
  return tracks;
}

async function findTracksByIdentityBatches(
  store: SisenseTrackPreviewStore,
  input: Pick<SisenseTrackSnapshotPreviewInput, "orgId" | "artistId">,
  identities: SisenseTrackPreviewIdentity[],
): Promise<SisenseTrackPreviewTrack[]> {
  const tracks: SisenseTrackPreviewTrack[] = [];
  for (let start = 0; start < identities.length; start += SISENSE_TRACK_PREVIEW_BATCH_SIZE) {
    tracks.push(...await store.findTracksByIdentity({
      orgId: input.orgId,
      artistId: input.artistId,
      identities: identities.slice(start, start + SISENSE_TRACK_PREVIEW_BATCH_SIZE),
    }));
  }
  return tracks;
}

function resolvedCanonicalRow(
  row: ParsedSisenseTrackRow,
  artistId: string,
  track: SisenseTrackPreviewTrack,
): ResolvedSisenseTrackRow {
  return {
    ...row,
    trackId: track.id,
    matchStatus: "matched",
    persistedRowKey: `artist:${artistId}:track:${track.id}`,
  };
}

function resolvedSourceRow(row: ParsedSisenseTrackRow, artistId: string): ResolvedSisenseTrackRow {
  return {
    ...row,
    trackId: null,
    matchStatus: "unmatched",
    persistedRowKey: sourceKey(artistId, row.sourceIdentity),
  };
}

function safeAdd(total: number, value: number): number {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) {
    throw new HttpError("Sisense snapshot totals exceed safe integer range", 400);
  }
  return total + value;
}

function totals(rows: ResolvedSisenseTrackRow[]): SisenseTrackSnapshotPreview["totals"] {
  return rows.reduce((result, row) => ({
    combinedStreams: safeAdd(result.combinedStreams, row.metrics.combined_streams),
    combinedViews: safeAdd(result.combinedViews, row.metrics.combined_views ?? 0),
  }), { combinedStreams: 0, combinedViews: 0 });
}

export async function previewSisenseTrackSnapshot(
  store: SisenseTrackPreviewStore,
  input: SisenseTrackSnapshotPreviewInput,
): Promise<SisenseTrackSnapshotPreview> {
  const artist = await store.findArtist({ orgId: input.orgId, artistId: input.artistId });
  if (!artist) throw new HttpError("Artist not found in active organization", 404);

  const ambiguities: AmbiguityCollector = {
    totalAmbiguityCount: 0,
    samples: [],
    seenIdentities: new Set(),
    samplesByIdentity: new Map(),
  };
  const sourceRows = input.parsed.rows;
  for (const row of sourceRows) {
    if (normalize(row.primaryArtist) !== normalize(artist.name)) {
      addAmbiguity(ambiguities, {
        identity: safeSourceIdentity(row),
        sourceRows: [row.sourceRow],
        reason: "Primary artist does not match the selected artist",
      });
    }
  }
  if (ambiguities.totalAmbiguityCount > 0) throwAmbiguities(ambiguities);

  const isrcByRow = new Map<number, string | null>(sourceRows.map((row) => [row.sourceRow, normalizedIsrc(row.isrc)]));
  const isrcs = [...new Set([...isrcByRow.values()].filter((isrc): isrc is string => isrc !== null))];
  const isrcCandidates = isrcs.length > 0
    ? await findTracksByIsrcBatches(store, input, isrcs)
    : [];
  const tracksByIsrc = groupedTracks(isrcCandidates, (track) => normalizedIsrc(track.isrc));

  const resolvedBySourceRow = new Map<number, ResolvedSisenseTrackRow>();
  const fallbackRows: ParsedSisenseTrackRow[] = [];
  for (const row of sourceRows) {
    const isrc = isrcByRow.get(row.sourceRow)!;
    if (!isrc) {
      fallbackRows.push(row);
      continue;
    }
    const track = resolveCandidates(
      tracksByIsrc.get(isrc) ?? [], input.artistId, safeIsrcIdentity(isrc), row.sourceRow, ambiguities,
    );
    if (track === undefined) continue;
    if (track) resolvedBySourceRow.set(row.sourceRow, resolvedCanonicalRow(row, input.artistId, track));
    else fallbackRows.push(row);
  }
  if (ambiguities.totalAmbiguityCount > 0) throwAmbiguities(ambiguities);

  const identities = [...new Map(fallbackRows.map((row) => {
    const identity = rowIdentity(row);
    return [identityKey(identity), identity];
  })).values()];
  const identityCandidates = identities.length > 0
    ? await findTracksByIdentityBatches(store, input, identities)
    : [];
  const tracksByTitle = groupedTracks(identityCandidates, (track) => normalize(track.title));

  for (const row of fallbackRows) {
    const identity = rowIdentity(row);
    const titleCandidates = tracksByTitle.get(identity.trackTitle) ?? [];
    const candidates = identity.releaseTitle === null
      ? titleCandidates
      : titleCandidates.filter((track) => normalize(track.releaseTitle) === identity.releaseTitle);
    const track = resolveCandidates(
      candidates, input.artistId, safeSourceIdentity(row), row.sourceRow, ambiguities,
    );
    if (track === undefined) continue;
    resolvedBySourceRow.set(row.sourceRow, track
      ? resolvedCanonicalRow(row, input.artistId, track)
      : resolvedSourceRow(row, input.artistId));
  }
  if (ambiguities.totalAmbiguityCount > 0) throwAmbiguities(ambiguities);

  const collisions = new Map<string, { sourceRows: number[]; count: number }>();
  for (const row of resolvedBySourceRow.values()) {
    const collision = collisions.get(row.persistedRowKey) ?? { sourceRows: [], count: 0 };
    collision.count += 1;
    if (collision.sourceRows.length < MAX_SOURCE_ROW_SAMPLES) collision.sourceRows.push(row.sourceRow);
    collisions.set(row.persistedRowKey, collision);
  }
  for (const [identity, collision] of collisions) {
    if (collision.count > 1) {
      addAmbiguity(ambiguities, {
        identity,
        sourceRows: collision.sourceRows,
        reason: "Conflicting rows resolve to the same identity",
      });
    }
  }
  if (ambiguities.totalAmbiguityCount > 0) throwAmbiguities(ambiguities);

  const rows = sourceRows.map((row) => resolvedBySourceRow.get(row.sourceRow)!);
  const matched = rows.filter((row) => row.matchStatus === "matched").length;
  return {
    kind: "preview",
    artistId: artist.id,
    artistName: artist.name,
    fileName: input.parsed.fileName,
    sha256: input.parsed.sha256,
    requestedDateRange: input.parsed.requestedDateRange,
    reportingFrom: input.parsed.reportingFrom,
    reportingThrough: input.parsed.reportingThrough,
    aggregation: input.parsed.aggregation,
    counts: {
      sourceRows: input.parsed.sourceRowCount,
      uniqueTracks: rows.length,
      matched,
      unmatched: rows.length - matched,
      ambiguous: 0,
      exactDuplicates: input.parsed.exactDuplicateCount,
    },
    totals: totals(rows),
    rows,
    ambiguities: ambiguities.samples,
  };
}
