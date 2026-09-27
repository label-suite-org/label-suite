import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  parseSisenseTrackSnapshot,
} from "./sisense-track-snapshot";
import type {
  ResolvedSisenseTrackRow,
  SisenseTrackPreviewIdentity,
  SisenseTrackPreviewStore,
  SisenseTrackPreviewTrack,
  SisenseTrackSnapshotPreview,
} from "./sisense-track-snapshot-preview";
import {
  createSisenseTrackSnapshotProductionService,
  createSisenseTrackSnapshotService,
  persistSisenseTrackSnapshotRowsSetBased,
  resolveSisenseTrackPrivateAnalyticsBucket,
  sisenseTrackArchiveKey,
  type LatestSisenseTrackSnapshotImport,
  type SisenseTrackSnapshotArchive,
  type SisenseTrackSnapshotFailedEvidence,
  type SisenseTrackSnapshotImportStore,
  type SisenseTrackSnapshotImportTransaction,
} from "./sisense-track-snapshot-import";

const importedAt = "2026-08-11T12:00:00.000Z";
const headers = "track,artist,release,isrc,combined_streams,spotify_streams,combined_views";

interface StoredRun {
  id: string;
  orgId: string;
  artistId: string;
  requestedDateRange: string;
  aggregation: string;
  metadata: Record<string, unknown>;
  status: "running" | "completed";
  inserted: number;
  updated: number;
  unchanged: number;
}

interface StoredFile {
  id: string;
  runId: string;
  orgId: string;
  artistId: string;
  requestedDateRange: string;
  aggregation: string;
  fileName: string;
  sha256: string;
  byteSize: number;
  rowCount: number;
  headers: string[];
  storageBucket: string;
  storageKey: string;
}

interface StoredMetric {
  orgId: string;
  artistId: string;
  requestedDateRange: string;
  aggregation: string;
  row: ResolvedSisenseTrackRow;
  firstSeenRunId: string;
  lastSeenRunId: string;
}

interface StoredChange {
  runId: string;
  identity: string;
  changeType: "insert" | "update";
  previousRawRow: Record<string, string> | null;
  currentRawRow: Record<string, string>;
}

interface FakeState {
  runs: StoredRun[];
  files: StoredFile[];
  metrics: Map<string, StoredMetric>;
  changes: StoredChange[];
}

class StatefulSisenseStore implements SisenseTrackSnapshotImportStore {
  readonly artists = new Map<string, { id: string; name: string }>();
  readonly tracks: Array<SisenseTrackPreviewTrack & { orgId: string }> = [];
  readonly failedRuns: SisenseTrackSnapshotFailedEvidence[] = [];
  state: FakeState = { runs: [], files: [], metrics: new Map(), changes: [] };
  findArtistError: Error | null = null;
  findSuccessfulDuplicateError: Error | null = null;
  recordFileError: Error | null = null;
  upsertRowsError: Error | null = null;
  recordFailedRunError: Error | null = null;
  lockContended = false;
  previewTransactions = 0;
  lockedTransactions = 0;
  upsertCalls = 0;

  addArtist(orgId: string, id: string, name: string) {
    this.artists.set(`${orgId}:${id}`, { id, name });
  }

  addTrack(orgId: string, track: SisenseTrackPreviewTrack) {
    this.tracks.push({ ...track, orgId });
  }

  async withPreviewTransaction<T>(
    orgId: string,
    work: (store: SisenseTrackPreviewStore) => Promise<T>,
  ): Promise<T> {
    this.previewTransactions += 1;
    return work(this.previewStore(orgId));
  }

  async withLockedTransaction<T>(
    orgId: string,
    work: (tx: SisenseTrackSnapshotImportTransaction) => Promise<T>,
  ): Promise<T> {
    this.lockedTransactions += 1;
    if (this.lockContended) {
      throw new HttpError("Sisense analytics import is already running", 409, "SISENSE_TRACK_LOCKED");
    }
    const before = structuredClone(this.state);
    try {
      return await work(this.transaction(orgId));
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  async recordFailedRun(input: SisenseTrackSnapshotFailedEvidence): Promise<void> {
    if (this.recordFailedRunError) throw this.recordFailedRunError;
    this.failedRuns.push(structuredClone(input));
  }

  async listLatestByArtist(orgId: string): Promise<LatestSisenseTrackSnapshotImport[]> {
    const latestByArtist = new Map<string, StoredRun>();
    for (const run of this.state.runs) {
      if (run.orgId === orgId && run.status === "completed") latestByArtist.set(run.artistId, run);
    }
    return [...latestByArtist.values()].map((run) => this.latest(run));
  }

  previewStore(orgId: string): SisenseTrackPreviewStore {
    return {
      findArtist: async ({ orgId: requestedOrgId, artistId }) => {
        if (this.findArtistError) throw this.findArtistError;
        if (requestedOrgId !== orgId) throw new Error("preview escaped transaction tenant");
        return this.artists.get(`${orgId}:${artistId}`) ?? null;
      },
      findTracksByIsrc: async ({ orgId: requestedOrgId, artistId, isrcs }) => {
        if (requestedOrgId !== orgId) throw new Error("ISRC lookup escaped transaction tenant");
        return this.tracks.filter((track) => (
          track.orgId === orgId
          && track.artistId === artistId
          && track.isrc !== null
          && isrcs.includes(track.isrc.replace(/[^a-z0-9]/gi, "").toUpperCase())
        ));
      },
      findTracksByIdentity: async ({ orgId: requestedOrgId, artistId, identities }) => {
        if (requestedOrgId !== orgId) throw new Error("identity lookup escaped transaction tenant");
        return this.tracks.filter((track) => track.orgId === orgId
          && track.artistId === artistId
          && identities.some((identity) => matchesIdentity(track, identity)));
      },
    };
  }

  transaction(orgId: string): SisenseTrackSnapshotImportTransaction {
    return {
      ...this.previewStore(orgId),
      findSuccessfulDuplicate: async ({ artistId, requestedDateRange, aggregation, sha256 }) => {
        if (this.findSuccessfulDuplicateError) throw this.findSuccessfulDuplicateError;
        const file = this.state.files.find((candidate) => (
          candidate.orgId === orgId
          && candidate.artistId === artistId
          && candidate.requestedDateRange === requestedDateRange
          && candidate.aggregation === aggregation
          && candidate.sha256 === sha256
        ));
        if (!file) return null;
        const run = this.state.runs.find((candidate) => candidate.id === file.runId && candidate.status === "completed");
        return run ? this.latest(run) : null;
      },
      findLatestSuccessful: async ({ artistId }) => {
        const runs = this.state.runs.filter((candidate) => (
          candidate.orgId === orgId
          && candidate.artistId === artistId
          && candidate.status === "completed"
        ));
        const latest = runs.at(-1);
        return latest ? this.latest(latest) : null;
      },
      createRun: async ({ id, artistId, requestedDateRange, aggregation, metadata }) => {
        this.state.runs.push({
          id,
          orgId,
          artistId,
          requestedDateRange,
          aggregation,
          metadata: structuredClone(metadata),
          status: "running",
          inserted: 0,
          updated: 0,
          unchanged: 0,
        });
      },
      recordFile: async (input) => {
        if (this.recordFileError) throw this.recordFileError;
        this.state.files.push({ ...structuredClone(input), orgId });
      },
      upsertRows: async ({ runId, artistId, requestedDateRange, aggregation, rows }) => {
        this.upsertCalls += 1;
        if (this.upsertRowsError) throw this.upsertRowsError;
        const counts = { inserted: 0, updated: 0, unchanged: 0 };
        for (const row of rows) {
          const identity = metricIdentity(orgId, artistId, requestedDateRange, aggregation, row.persistedRowKey);
          const previous = this.state.metrics.get(identity);
          if (!previous) {
            this.state.metrics.set(identity, {
              orgId,
              artistId,
              requestedDateRange,
              aggregation,
              row: structuredClone(row),
              firstSeenRunId: runId,
              lastSeenRunId: runId,
            });
            this.state.changes.push({
              runId,
              identity,
              changeType: "insert",
              previousRawRow: null,
              currentRawRow: structuredClone(row.rawRow),
            });
            counts.inserted += 1;
          } else if (previous.row.rowHash === row.rowHash) {
            previous.lastSeenRunId = runId;
            counts.unchanged += 1;
          } else {
            this.state.changes.push({
              runId,
              identity,
              changeType: "update",
              previousRawRow: structuredClone(previous.row.rawRow),
              currentRawRow: structuredClone(row.rawRow),
            });
            previous.row = structuredClone(row);
            previous.lastSeenRunId = runId;
            counts.updated += 1;
          }
        }
        return counts;
      },
      completeRun: async ({ runId, inserted, updated, unchanged }) => {
        const run = this.state.runs.find((candidate) => candidate.id === runId);
        if (!run) throw new Error("run not found");
        Object.assign(run, { status: "completed", inserted, updated, unchanged });
      },
    };
  }

  private latest(run: StoredRun): LatestSisenseTrackSnapshotImport {
    const file = this.state.files.find((candidate) => candidate.runId === run.id);
    const artist = this.artists.get(`${run.orgId}:${run.artistId}`);
    if (!file || !artist) throw new Error("incomplete fake import evidence");
    const metadata = run.metadata as {
      reporting_from: string;
      reporting_through: string;
      counts: SisenseTrackSnapshotPreview["counts"];
      totals: SisenseTrackSnapshotPreview["totals"];
    };
    return {
      artistId: artist.id,
      artistName: artist.name,
      runId: run.id,
      fileName: file.fileName,
      sha256: file.sha256,
      rowCount: file.rowCount,
      importedAt,
      reportingFrom: metadata.reporting_from,
      reportingThrough: metadata.reporting_through,
      requestedDateRange: run.requestedDateRange,
      aggregation: run.aggregation,
      counts: metadata.counts,
      totals: metadata.totals,
    };
  }
}

function normalize(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function matchesIdentity(track: SisenseTrackPreviewTrack, identity: SisenseTrackPreviewIdentity): boolean {
  return normalize(track.title) === identity.trackTitle
    && (identity.releaseTitle === null || normalize(track.releaseTitle) === identity.releaseTitle);
}

function metricIdentity(
  orgId: string,
  artistId: string,
  requestedDateRange: string,
  aggregation: string,
  rowKey: string,
): string {
  return [orgId, artistId, requestedDateRange, aggregation, rowKey].join(":");
}

function csv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode(`${headers}\n${rows.join("\n")}\n`);
}

function row(input: {
  title: string;
  artist?: string;
  release?: string;
  isrc?: string;
  streams: number;
  spotify?: number;
  views?: number;
}): string {
  return [
    input.title,
    input.artist ?? "Artist A",
    input.release ?? "Release A",
    input.isrc ?? "",
    input.streams,
    input.spotify ?? input.streams,
    input.views ?? 0,
  ].join(",");
}

function baseBytes(streams = 100): Uint8Array {
  return csv(
    row({ title: "Track One", isrc: "DKABC2600001", streams, views: 10 }),
    row({ title: "Mystery", streams: 50, views: 5 }),
  );
}

function setup(options: {
  archive?: SisenseTrackSnapshotArchive;
  assertArchiveReady?: () => void;
} = {}) {
  const store = new StatefulSisenseStore();
  store.addArtist("org-a", "artist-a", "Artist A");
  store.addArtist("org-a", "artist-a-copy", "Artist A");
  store.addArtist("org-a", "artist-b", "Artist B");
  store.addArtist("org-b", "artist-a", "Other Artist A");
  store.addArtist("org-b", "artist-same", "Artist A");
  store.addTrack("org-a", {
    id: "track-a",
    artistId: "artist-a",
    isrc: "DKABC2600001",
    title: "Track One",
    releaseTitle: "Release A",
  });
  const archived: Array<{
    orgId: string;
    artistId: string;
    requestedDateRange: string;
    aggregation: string;
    sha256: string;
    bytes: Uint8Array;
    bucket: string;
    key: string;
  }> = [];
  const archive: SisenseTrackSnapshotArchive = options.archive ?? (async (input) => {
    const result = {
      bucket: "private-analytics",
      key: `${input.orgId}/${sisenseTrackArchiveKey(input.artistId, input.requestedDateRange, input.sha256)}`,
    };
    archived.push({ ...input, ...result });
    return result;
  });
  let id = 0;
  const service = createSisenseTrackSnapshotService({
    store,
    archive,
    assertArchiveReady: options.assertArchiveReady,
    now: () => new Date(importedAt),
    randomId: () => `id-${++id}`,
  });
  return { store, archived, service };
}

function previewInput(bytes: Uint8Array, overrides: Partial<{
  orgId: string;
  artistId: string;
  reportingFrom: string;
  reportingThrough: string;
  aggregation: string;
  fileName: string;
}> = {}) {
  return {
    orgId: "org-a",
    artistId: "artist-a",
    reportingFrom: "2026-08-01",
    reportingThrough: "2026-08-08",
    aggregation: "Daily",
    bytes,
    fileName: "Tracks by Growth Rate.csv",
    ...overrides,
  };
}

function applyInput(bytes: Uint8Array, overrides: Partial<ReturnType<typeof previewInput> & {
  expectedSha256: string;
  expectedPreviewFingerprint: string;
  includeUnmatched: boolean;
}> = {}) {
  const base = previewInput(bytes, overrides);
  const parsed = parseSisenseTrackSnapshot(bytes, base.fileName, base);
  return {
    ...base,
    expectedSha256: parsed.sha256,
    expectedPreviewFingerprint: "0".repeat(64),
    includeUnmatched: true,
    ...overrides,
  };
}

async function boundApplyInput(
  service: ReturnType<typeof createSisenseTrackSnapshotService>,
  bytes: Uint8Array,
  overrides: Partial<ReturnType<typeof applyInput>> = {},
) {
  const input = applyInput(bytes, overrides);
  const preview = await service.preview(input);
  return {
    ...input,
    expectedPreviewFingerprint: preview.previewFingerprint,
  };
}

async function applyBound(
  service: ReturnType<typeof createSisenseTrackSnapshotService>,
  bytes: Uint8Array,
  overrides: Partial<ReturnType<typeof applyInput>> = {},
) {
  return service.apply(await boundApplyInput(service, bytes, overrides));
}

function productionDatabaseDouble(store: StatefulSisenseStore) {
  const dialect = new PgDialect();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let transactions = 0;
  const tx = {
    execute: async (statement: never) => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (query.sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: true }] };
      return { rows: [] };
    },
  };
  const database = {
    transaction: async <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => {
      transactions += 1;
      const before = structuredClone(store.state);
      try {
        return await work(tx);
      } catch (error) {
        store.state = before;
        throw error;
      }
    },
  };
  return { database, queries, transactionCount: () => transactions };
}

function productionAdapterDouble(store: StatefulSisenseStore) {
  const calls = { preview: 0, import: 0, failed: 0, latest: 0 };
  return {
    calls,
    adapter: {
      previewStore: (_tx: unknown, orgId: string) => {
        calls.preview += 1;
        return store.previewStore(orgId);
      },
      importTransaction: (_tx: unknown, orgId: string) => {
        calls.import += 1;
        return store.transaction(orgId);
      },
      recordFailedRun: async (_tx: unknown, input: SisenseTrackSnapshotFailedEvidence) => {
        calls.failed += 1;
        await store.recordFailedRun(input);
      },
      listLatestByArtist: async (_tx: unknown, orgId: string) => {
        calls.latest += 1;
        return store.listLatestByArtist(orgId);
      },
    },
  };
}

describe("Sisense track snapshot private archive", () => {
  it("requires a dedicated private analytics bucket distinct from public media", () => {
    expect(() => resolveSisenseTrackPrivateAnalyticsBucket({})).toThrow("R2_ANALYTICS_PRIVATE_BUCKET");
    expect(resolveSisenseTrackPrivateAnalyticsBucket({
      R2_ANALYTICS_PRIVATE_BUCKET: "private-analytics",
      R2_BUCKET: "public-media",
    })).toBe("private-analytics");
    expect(() => resolveSisenseTrackPrivateAnalyticsBucket({
      R2_ANALYTICS_PRIVATE_BUCKET: "shared",
      R2_BUCKET: "shared",
    })).toThrow("must be distinct from R2_BUCKET");
  });

  it("keeps lossy artist segments collision-safe and scopes equal bytes by range", () => {
    const sha256 = "a".repeat(64);
    expect(sisenseTrackArchiveKey("artist/a", "2026-08-01 to 2026-08-08", sha256))
      .not.toBe(sisenseTrackArchiveKey("artist-a", "2026-08-01 to 2026-08-08", sha256));
    expect(sisenseTrackArchiveKey("artist-a", "2026-08-01 to 2026-08-08", sha256))
      .not.toBe(sisenseTrackArchiveKey("artist-a", "2026-08-02 to 2026-08-08", sha256));
    expect(sisenseTrackArchiveKey("artist-a", "2026-08-01 to 2026-08-08", sha256))
      .toMatch(/^analytics\/sisense\/artist-a\/tracks-by-growth-rate\/[a-f0-9]{16}\/a{64}\.csv$/);
  });
});

describe("createSisenseTrackSnapshotService", () => {
  it("previews inside the active tenant without writes or private upload", async () => {
    const { service, store, archived } = setup();
    const input = previewInput(baseBytes());

    const preview = await service.preview(input);
    expect(preview).toMatchObject({
      kind: "preview",
      artistId: "artist-a",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      counts: { uniqueTracks: 2, matched: 1, unmatched: 1 },
    });
    expect(preview).toMatchObject({ previewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(service.preview(input)).resolves.toMatchObject({
      previewFingerprint: preview.previewFingerprint,
    });
    expect(store.previewTransactions).toBe(2);
    expect(store.lockedTransactions).toBe(0);
    expect(store.state.runs).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("returns a bounded public preview without private resolved rows or raw evidence", async () => {
    const { service } = setup();
    const bytes = csv(...Array.from({ length: 2_000 }, (_, index) => row({
      title: `Unmatched Track ${index}`,
      streams: index,
    })));

    const preview = await service.preview(previewInput(bytes));
    const serialized = JSON.stringify(preview);

    expect(preview).not.toHaveProperty("rows");
    expect(preview).not.toHaveProperty("ambiguities");
    expect(preview).toMatchObject({
      counts: { uniqueTracks: 2_000, matched: 0, unmatched: 2_000, ambiguous: 0 },
      identitySamples: {
        total: 2_000,
        truncated: true,
        items: expect.any(Array),
      },
    });
    expect(preview.identitySamples.items.length).toBeLessThanOrEqual(20);
    expect(serialized).not.toContain("rawRow");
    expect(serialized).not.toContain("rowHash");
    expect(serialized).not.toContain("Unmatched Track 1999");
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(25_000);
  });

  it("archives exact private provenance and inserts the first snapshot", async () => {
    const { service, store, archived } = setup();
    const bytes = baseBytes();
    const preview = await service.preview(previewInput(bytes));

    await expect(service.apply({
      ...applyInput(bytes),
      expectedSha256: preview.sha256,
      expectedPreviewFingerprint: preview.previewFingerprint,
    })).resolves.toEqual({
      kind: "imported",
      runId: "air_id-1",
      inserted: 2,
      updated: 0,
      unchanged: 0,
      latest: {
        artistId: "artist-a",
        artistName: "Artist A",
        runId: "air_id-1",
        fileName: "Tracks-by-Growth-Rate.csv",
        sha256: preview.sha256,
        rowCount: 2,
        importedAt,
        reportingFrom: "2026-08-01",
        reportingThrough: "2026-08-08",
        requestedDateRange: "2026-08-01 to 2026-08-08",
        aggregation: "Daily",
        counts: preview.counts,
        totals: preview.totals,
      },
    });
    expect(archived).toEqual([expect.objectContaining({
      orgId: "org-a",
      artistId: "artist-a",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      aggregation: "Daily",
      sha256: preview.sha256,
      bytes,
      bucket: "private-analytics",
    })]);
    expect(store.state.files[0]).toMatchObject({
      storageBucket: "private-analytics",
      storageKey: archived[0].key,
      requestedDateRange: "2026-08-01 to 2026-08-08",
      aggregation: "Daily",
      sha256: preview.sha256,
    });
    expect(store.state.runs[0].metadata).toEqual({
      export_type: "tracks_by_growth_rate",
      reporting_from: "2026-08-01",
      reporting_through: "2026-08-08",
      observed_at: importedAt,
      counts: preview.counts,
      totals: preview.totals,
    });
  });

  it("records raw source-row provenance when exact duplicate rows collapse", async () => {
    const { service, store } = setup();
    const duplicate = row({ title: "Track One", isrc: "DKABC2600001", streams: 100, views: 10 });
    const bytes = csv(duplicate, duplicate);

    await expect(applyBound(service, bytes)).resolves.toMatchObject({
      kind: "imported",
      inserted: 1,
      latest: { rowCount: 2, counts: { sourceRows: 2, uniqueTracks: 1, exactDuplicates: 1 } },
    });
    expect(store.state.files[0]).toMatchObject({ rowCount: 2 });
  });

  it("rejects a changed file hash before tenant lookup, write, or archive", async () => {
    const { service, store, archived } = setup();
    const input = await boundApplyInput(service, baseBytes());

    await expect(service.apply({
      ...input,
      expectedSha256: "0".repeat(64),
    })).rejects.toMatchObject({ status: 409 });
    expect(store.lockedTransactions).toBe(0);
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("re-verifies the selected artist inside the authenticated tenant", async () => {
    const { service, store, archived } = setup();
    const bytes = baseBytes();
    const valid = await boundApplyInput(service, bytes);

    await expect(service.apply({ ...valid, artistId: "missing" })).rejects.toMatchObject({ status: 404 });
    await expect(service.apply({ ...valid, orgId: "org-b", artistId: "artist-a" })).rejects.toMatchObject({ status: 409 });
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("requires an explicit acknowledgement when the recomputed preview contains unmatched rows", async () => {
    const { service, store, archived } = setup();
    const input = await boundApplyInput(service, baseBytes(), { includeUnmatched: false });

    await expect(service.apply(input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("unmatched"),
    });
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it.each([
    ["reporting period", { reportingFrom: "2026-07-01", reportingThrough: "2026-07-31" }],
    ["aggregation", { aggregation: "Weekly" }],
    ["artist", { artistId: "artist-a-copy" }],
    ["authenticated organization", { orgId: "org-b", artistId: "artist-same" }],
  ])("rejects a stale preview fingerprint after the %s changes", async (_label, change) => {
    const { service, store, archived } = setup();
    const input = await boundApplyInput(service, baseBytes());

    await expect(service.apply({ ...input, ...change })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("preview"),
    });
    expect(store.state.runs).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("rejects a stale preview when catalog resolution changes unmatched context", async () => {
    const { service, store, archived } = setup();
    const input = await boundApplyInput(service, baseBytes());
    store.addTrack("org-a", {
      id: "track-mystery",
      artistId: "artist-a",
      isrc: null,
      title: "Mystery",
      releaseTitle: "Release A",
    });

    await expect(service.apply(input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("preview"),
    });
    expect(store.state.runs).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it.each([undefined, "not-a-fingerprint", "A".repeat(64)])(
    "rejects malformed required preview fingerprint %s before the locked transaction",
    async (expectedPreviewFingerprint) => {
      const { service, store, archived } = setup();
      const input = await boundApplyInput(service, baseBytes());

      await expect(service.apply({
        ...input,
        expectedPreviewFingerprint,
      } as never)).rejects.toMatchObject({ status: 400 });
      expect(store.lockedTransactions).toBe(0);
      expect(store.state.runs).toHaveLength(0);
      expect(archived).toHaveLength(0);
    },
  );

  it("deduplicates only the same artist, range, aggregation, and hash", async () => {
    const { service, store, archived } = setup();
    const bytes = baseBytes();
    const first = await applyBound(service, bytes);
    if (first.kind !== "imported") throw new Error("Expected initial Sisense import");

    await expect(applyBound(service, bytes)).resolves.toEqual({
      kind: "duplicate",
      runId: first.runId,
      latest: first.latest,
    });
    await expect(applyBound(service, bytes, {
      reportingFrom: "2026-07-01",
      reportingThrough: "2026-07-31",
    })).resolves.toMatchObject({ kind: "imported", inserted: 2 });
    await expect(applyBound(service, bytes, { aggregation: "Weekly" })).resolves.toMatchObject({
      kind: "imported",
      inserted: 2,
    });
    expect(store.state.runs).toHaveLength(3);
    expect(store.state.metrics.size).toBe(6);
    expect(archived).toHaveLength(3);
  });

  it("keeps the duplicate run identity separate from newer authoritative latest evidence", async () => {
    const { service, store, archived } = setup();
    const olderBytes = baseBytes(100);
    const newerBytes = baseBytes(110);
    const older = await applyBound(service, olderBytes);
    const newer = await applyBound(service, newerBytes);

    await expect(applyBound(service, olderBytes)).resolves.toMatchObject({
      kind: "duplicate",
      runId: older.runId,
      latest: { runId: newer.runId, sha256: expect.not.stringMatching(/^$/) },
    });
    expect(store.state.runs).toHaveLength(2);
    expect(archived).toHaveLength(2);
  });

  it("updates corrections, advances unchanged membership, and leaves omitted evidence untouched", async () => {
    const { service, store } = setup();
    const initial = baseBytes(100);
    const correction = csv(
      row({ title: "Track One", isrc: "DKABC2600001", streams: 100, views: 10 }),
      row({ title: "New Track", streams: 25, views: 2 }),
    );
    const first = await applyBound(service, initial);
    const missingIdentity = [...store.state.metrics.entries()]
      .find(([, metric]) => metric.row.trackTitle === "Mystery")!;

    const second = await applyBound(service, correction);

    expect(first).toMatchObject({ kind: "imported", inserted: 2 });
    expect(second).toMatchObject({ kind: "imported", inserted: 1, updated: 0, unchanged: 1 });
    expect(store.state.metrics.size).toBe(3);
    const unchanged = [...store.state.metrics.values()].find((metric) => metric.row.trackTitle === "Track One");
    expect(unchanged).toMatchObject({ firstSeenRunId: first.runId, lastSeenRunId: second.runId });
    expect(store.state.metrics.get(missingIdentity[0])?.lastSeenRunId).toBe(first.runId);
    expect(store.state.changes).toHaveLength(3);
    expect(store.state.changes.every((change) => change.changeType === "insert")).toBe(true);
  });

  it("records only insert/update changes when a present identity is corrected", async () => {
    const { service, store } = setup();
    await applyBound(service, baseBytes(100));

    await expect(applyBound(service, baseBytes(110))).resolves.toMatchObject({
      kind: "imported",
      inserted: 0,
      updated: 1,
      unchanged: 1,
    });
    expect(store.state.changes.map((change) => change.changeType)).toEqual(["insert", "insert", "update"]);
    expect(store.state.changes[2]).toMatchObject({
      previousRawRow: { combined_streams: "100" },
      currentRawRow: { combined_streams: "110" },
    });
  });

  it("returns latest successful evidence by artist without crossing tenants", async () => {
    const { service } = setup();
    await applyBound(service, baseBytes());
    const artistBBytes = csv(row({ title: "Artist B Track", artist: "Artist B", streams: 10 }));
    await applyBound(service, artistBBytes, { artistId: "artist-b" });

    await expect(service.listLatestByArtist("org-a")).resolves.toEqual([
      expect.objectContaining({ artistId: "artist-a" }),
      expect.objectContaining({ artistId: "artist-b" }),
    ]);
    await expect(service.listLatestByArtist("org-b")).resolves.toEqual([]);
  });

  it("returns lock contention without upload or durable validation noise", async () => {
    const { service, store, archived } = setup();
    const input = await boundApplyInput(service, baseBytes());
    store.lockContended = true;

    await expect(service.apply(input)).rejects.toMatchObject({ status: 409 });
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("checks private archive readiness before parsing or opening a transaction", async () => {
    const { service, store, archived } = setup({
      assertArchiveReady: () => { throw new Error("R2_ANALYTICS_PRIVATE_BUCKET is required"); },
    });
    const input = await boundApplyInput(service, baseBytes());

    await expect(service.apply({
      ...input,
      bytes: new Uint8Array([0]),
    })).rejects.toThrow("R2_ANALYTICS_PRIVATE_BUCKET");
    expect(store.lockedTransactions).toBe(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("retains exact private provenance after post-upload database rollback", async () => {
    const { service, store, archived } = setup();
    store.upsertRowsError = new Error("postgres://reporter:secret@db.internal failed");
    const bytes = baseBytes();
    const parsed = parseSisenseTrackSnapshot(bytes, "Tracks by Growth Rate.csv", previewInput(bytes));

    await expect(applyBound(service, bytes)).rejects.toMatchObject({
      status: 500,
      message: "Sisense track snapshot import failed during metric persistence",
    });
    expect(store.state.runs).toHaveLength(0);
    expect(store.state.files).toHaveLength(0);
    expect(store.state.metrics.size).toBe(0);
    expect(archived).toHaveLength(1);
    expect(store.failedRuns).toEqual([{
      runId: "air_id-3",
      fileId: "aif_id-4",
      orgId: "org-a",
      artistId: "artist-a",
      fileName: "Tracks-by-Growth-Rate.csv",
      sha256: parsed.sha256,
      byteSize: bytes.byteLength,
      rowCount: 2,
      headers: headers.split(","),
      requestedDateRange: "2026-08-01 to 2026-08-08",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      aggregation: "Daily",
      counts: { sourceRows: 2, uniqueTracks: 2, matched: 1, unmatched: 1, ambiguous: 0, exactDuplicates: 0 },
      totals: { combinedStreams: 150, combinedViews: 15 },
      archivedFile: {
        storageBucket: "private-analytics",
        storageKey: archived[0].key,
      },
      error: "Sisense track snapshot import failed during metric persistence",
    }]);
  });

  it.each([
    "upload https://private.example/source.csv failed with token=secret",
    "postgres://reporter:password@database.internal/analytics refused connection",
    "s3://confidential-bucket/org-a/source.csv could not be written",
  ])("persists only an allowlisted failure category for infrastructure error %s", async (dependencyMessage) => {
    const { service, store } = setup({
      archive: async () => { throw new Error(dependencyMessage); },
    });

    await expect(applyBound(service, baseBytes())).rejects.toMatchObject({
      status: 500,
      message: "Sisense track snapshot import failed during private archive",
    });
    expect(store.failedRuns).toEqual([expect.objectContaining({
      artistId: "artist-a",
      archivedFile: null,
      error: "Sisense track snapshot import failed during private archive",
    })]);
    expect(JSON.stringify(store.failedRuns)).not.toContain(dependencyMessage);
  });

  it.each([
    ["preview", 409, "tenant verification", false, false],
    ["duplicate", 422, "duplicate check", false, false],
    ["archive", 409, "private archive", false, false],
    ["archive", 422, "private archive", false, false],
    ["file", 409, "file provenance", true, false],
    ["file", 422, "file provenance", true, false],
    ["upsert", 409, "metric persistence", true, false],
    ["upsert", 422, "metric persistence", true, false],
    ["upsert", 409, "metric persistence", true, true],
  ] as const)(
    "contains dependency HttpError during %s (%i)",
    async (dependency, status, failurePhase, hasArchivedFile, failedWriterFails) => {
      const sensitiveMessage = `${dependency} rejected s3://private-bucket/key?token=secret`;
      const { service, store } = setup({
        archive: dependency === "archive"
          ? async () => { throw new HttpError(sensitiveMessage, status); }
          : undefined,
      });
      const input = await boundApplyInput(service, baseBytes());
      if (dependency === "preview") store.findArtistError = new HttpError(sensitiveMessage, status);
      if (dependency === "duplicate") {
        store.findSuccessfulDuplicateError = new HttpError(sensitiveMessage, status);
      }
      if (dependency === "file") store.recordFileError = new HttpError(sensitiveMessage, status);
      if (dependency === "upsert") store.upsertRowsError = new HttpError(sensitiveMessage, status);
      if (failedWriterFails) {
        store.recordFailedRunError = new HttpError("failed evidence contains password=secret-too", 422);
      }

      const thrown = await service.apply(input).catch((error: unknown) => error);

      expect(thrown).toMatchObject({
        status: 500,
        message: `Sisense track snapshot import failed during ${failurePhase}`,
      });
      expect(String(thrown)).not.toContain(sensitiveMessage);
      expect(String(thrown)).not.toContain("secret-too");
      expect(store.state.runs).toHaveLength(0);
      expect(store.state.files).toHaveLength(0);
      if (failedWriterFails) {
        expect(store.failedRuns).toHaveLength(0);
      } else {
        expect(store.failedRuns).toEqual([expect.objectContaining({
          artistId: dependency === "preview" ? null : "artist-a",
          archivedFile: hasArchivedFile
            ? expect.objectContaining({ storageBucket: "private-analytics" })
            : null,
          error: `Sisense track snapshot import failed during ${failurePhase}`,
        })]);
        expect(JSON.stringify(store.failedRuns)).not.toContain(sensitiveMessage);
      }
    },
  );

  it("preserves the phase-safe error when failed evidence writing throws synchronously", async () => {
    const { service, store } = setup();
    const input = await boundApplyInput(service, baseBytes());
    store.upsertRowsError = new HttpError("upsert exposed token=dependency-secret", 422);
    let failedEvidenceAttempts = 0;
    store.recordFailedRun = () => {
      failedEvidenceAttempts += 1;
      throw new HttpError("failed writer exposed password=writer-secret", 409);
    };

    const thrown = await service.apply(input).catch((error: unknown) => error);

    expect(failedEvidenceAttempts).toBe(1);
    expect(thrown).toMatchObject({
      status: 500,
      message: "Sisense track snapshot import failed during metric persistence",
    });
    expect(String(thrown)).not.toContain("dependency-secret");
    expect(String(thrown)).not.toContain("writer-secret");
    expect(store.state.runs).toHaveLength(0);
    expect(store.state.files).toHaveLength(0);
  });
});

describe("production set-based Sisense persistence", () => {
  it("composes tenant context, source lock, duplicate, and latest paths through the production adapter", async () => {
    const store = new StatefulSisenseStore();
    store.addArtist("org-a", "artist-a", "Artist A");
    store.addTrack("org-a", {
      id: "track-a",
      artistId: "artist-a",
      isrc: "DKABC2600001",
      title: "Track One",
      releaseTitle: "Release A",
    });
    const database = productionDatabaseDouble(store);
    const adapter = productionAdapterDouble(store);
    let archives = 0;
    let id = 0;
    const service = createSisenseTrackSnapshotProductionService({
      database: database.database,
      archive: async ({ orgId, artistId, requestedDateRange, sha256 }) => {
        archives += 1;
        return {
          bucket: "private-analytics",
          key: `${orgId}/${sisenseTrackArchiveKey(artistId, requestedDateRange, sha256)}`,
        };
      },
      now: () => new Date(importedAt),
      randomId: () => `production-${++id}`,
      adapter: adapter.adapter,
    });
    const bytes = baseBytes();
    const preview = await service.preview(previewInput(bytes));
    const input = {
      ...applyInput(bytes),
      expectedPreviewFingerprint: preview.previewFingerprint,
    };

    const first = await service.apply(input);
    await expect(service.apply(input)).resolves.toMatchObject({ kind: "duplicate", runId: first.runId });
    await expect(service.listLatestByArtist("org-a")).resolves.toEqual([
      expect.objectContaining({ artistId: "artist-a", runId: first.runId }),
    ]);

    expect(archives).toBe(1);
    expect(database.transactionCount()).toBe(4);
    expect(adapter.calls).toEqual({ preview: 1, import: 2, failed: 0, latest: 1 });
    expect(database.queries.filter((query) => query.sql.includes("set_config('app.current_org_id'"))).toHaveLength(4);
    expect(database.queries.filter((query) => query.sql.includes("pg_try_advisory_xact_lock"))).toHaveLength(2);
    expect(database.queries.flatMap((query) => query.params)).toContain("label-suite:org-a:sisense");
  });

  it("uses a separate tenant/lock transaction for sanitized failed evidence", async () => {
    const store = new StatefulSisenseStore();
    store.addArtist("org-a", "artist-a", "Artist A");
    const database = productionDatabaseDouble(store);
    const adapter = productionAdapterDouble(store);
    let id = 0;
    const service = createSisenseTrackSnapshotProductionService({
      database: database.database,
      archive: async () => {
        throw new Error("s3://secret-bucket/key token=private");
      },
      now: () => new Date(importedAt),
      randomId: () => `production-${++id}`,
      adapter: adapter.adapter,
    });
    const bytes = baseBytes();
    const preview = await service.preview(previewInput(bytes));

    await expect(service.apply({
      ...applyInput(bytes),
      expectedPreviewFingerprint: preview.previewFingerprint,
    })).rejects.toMatchObject({
      status: 500,
      message: "Sisense track snapshot import failed during private archive",
    });

    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toEqual([expect.objectContaining({
      error: "Sisense track snapshot import failed during private archive",
    })]);
    expect(JSON.stringify(store.failedRuns)).not.toContain("secret-bucket");
    expect(database.transactionCount()).toBe(3);
    expect(adapter.calls).toEqual({ preview: 1, import: 1, failed: 1, latest: 0 });
    expect(database.queries.filter((query) => query.sql.includes("set_config('app.current_org_id'"))).toHaveLength(3);
    expect(database.queries.some((query) => (
      query.sql.includes("pg_advisory_xact_lock")
      && !query.sql.includes("pg_try_advisory_xact_lock")
    ))).toBe(true);
  });

  it("passes 10,000 rows through one JSONB recordset statement", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index): ResolvedSisenseTrackRow => ({
      sourceRow: index + 2,
      trackTitle: `Track ${index}`,
      primaryArtist: "Artist A",
      releaseTitle: "Release A",
      isrc: null,
      metrics: { combined_streams: index, spotify_streams: index },
      rawRow: { track: `Track ${index}`, combined_streams: String(index) },
      rowHash: index.toString(16).padStart(64, "0"),
      sourceIdentity: `source:${index.toString(16).padStart(64, "0")}`,
      trackId: null,
      matchStatus: "unmatched",
      persistedRowKey: `artist:artist-a:source:${index}`,
    }));
    let statement: unknown;
    let executeCalls = 0;
    const tx = {
      execute: async (query: unknown) => {
        executeCalls += 1;
        statement = query;
        return { rows: [{ inserted: 10_000, updated: 0, unchanged: 0 }] };
      },
    };

    await expect(persistSisenseTrackSnapshotRowsSetBased(tx, {
      orgId: "org-a",
      runId: "run-a",
      artistId: "artist-a",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      aggregation: "Daily",
      rows,
      observedAt: new Date(importedAt),
    })).resolves.toEqual({ inserted: 10_000, updated: 0, unchanged: 0 });
    expect(executeCalls).toBe(1);

    const query = new PgDialect().sqlToQuery(statement as never);
    expect(query.sql.match(/jsonb_to_recordset/g)).toHaveLength(1);
    const payload = query.params
      .filter((value): value is string => typeof value === "string" && value.startsWith("["))
      .map((value) => JSON.parse(value) as unknown[])
      .find((value) => value.length === 10_000);
    expect(payload).toHaveLength(10_000);
    expect(query.sql).toContain("last_seen_run_id");
    expect(query.sql).toContain("previous.row_hash is not distinct from staged.row_hash");
  });
});
