import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { parseSpotifyAudienceTimeline, type SpotifyAudienceRow } from "./spotify-audience-timeline";
import {
  createSpotifyAnalyticsImportService,
  resolveSpotifyPrivateAnalyticsBucket,
  spotifyAudienceArchiveKey,
  type SpotifyFailedImportEvidence,
  type LatestSpotifyAudienceImport,
  type SpotifyImportStore,
  type SpotifyImportTransaction,
  type SpotifySourceArchive,
} from "./spotify-analytics-import";

const headers = "date,listeners,monthly listeners,monthly active listeners,super listeners,streams,playlist adds,saves,followers";
const importedAt = "2026-08-10T12:00:00.000Z";

interface StoredRun {
  id: string;
  orgId: string;
  artistId: string;
  dateRange: string;
  reportingThrough: string;
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
  fileName: string;
  sha256: string;
  byteSize: number;
  rowCount: number;
  headers: string[];
  actualDateRange: string;
  storageBucket: string;
  storageKey: string;
}

interface StoredMetric {
  orgId: string;
  artistId: string;
  persistedRowKey: string;
  row: SpotifyAudienceRow;
}

interface StoredChange {
  orgId: string;
  artistId: string;
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

class StatefulSpotifyStore implements SpotifyImportStore {
  readonly artists = new Map<string, { id: string; name: string }>();
  readonly failedRuns: SpotifyFailedImportEvidence[] = [];
  state: FakeState = { runs: [], files: [], metrics: new Map(), changes: [] };
  findArtistError: Error | null = null;
  upsertRowsError: Error | null = null;
  recordFailedRunError: Error | null = null;

  addArtist(orgId: string, id: string, name: string) {
    this.artists.set(`${orgId}:${id}`, { id, name });
  }

  async withLockedTransaction<T>(orgId: string, work: (tx: SpotifyImportTransaction) => Promise<T>): Promise<T> {
    const before = structuredClone(this.state);
    try {
      return await work(this.transaction(orgId));
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  async recordFailedRun(input: SpotifyFailedImportEvidence) {
    if (this.recordFailedRunError) throw this.recordFailedRunError;
    this.failedRuns.push(input);
  }

  async listLatest(orgId: string): Promise<LatestSpotifyAudienceImport[]> {
    const completed = this.state.runs.filter((run) => run.orgId === orgId && run.status === "completed");
    const latestByArtist = new Map<string, StoredRun>();
    for (const run of completed) latestByArtist.set(run.artistId, run);
    return [...latestByArtist.values()].map((run) => this.latest(run));
  }

  private transaction(orgId: string): SpotifyImportTransaction {
    return {
      findArtist: async (artistId) => {
        if (this.findArtistError) throw this.findArtistError;
        return this.artists.get(`${orgId}:${artistId}`) ?? null;
      },
      findSuccessfulDuplicate: async ({ artistId, sha256 }) => {
        const file = this.state.files.find((candidate) => candidate.orgId === orgId && candidate.artistId === artistId && candidate.sha256 === sha256);
        if (!file) return null;
        const run = this.state.runs.find((candidate) => candidate.id === file.runId && candidate.status === "completed");
        return run ? this.latest(run) : null;
      },
      createRun: async ({ id, artistId, dateRange, reportingThrough }) => {
        this.state.runs.push({ id, orgId, artistId, dateRange, reportingThrough, status: "running", inserted: 0, updated: 0, unchanged: 0 });
      },
      recordFile: async (input) => {
        this.state.files.push({ ...input, orgId });
      },
      upsertRows: async ({ artistId, rows }) => {
        if (this.upsertRowsError) throw this.upsertRowsError;
        const totals = { inserted: 0, updated: 0, unchanged: 0 };
        for (const row of rows) totals[await this.upsertMetric(orgId, artistId, row)] += 1;
        return totals;
      },
      completeRun: async ({ runId, inserted, updated, unchanged }) => {
        const run = this.state.runs.find((candidate) => candidate.id === runId);
        if (!run) throw new Error("Run not found");
        Object.assign(run, { status: "completed", inserted, updated, unchanged });
      },
    };
  }

  private async upsertMetric(orgId: string, artistId: string, row: SpotifyAudienceRow) {
    const identity = `${orgId}:${artistId}:${row.date}`;
    const previous = this.state.metrics.get(identity);
    const persistedRowKey = `artist:${artistId}:date:${row.date}`;
    if (!previous) {
      this.state.metrics.set(identity, { orgId, artistId, persistedRowKey, row: structuredClone(row) });
      this.state.changes.push({ orgId, artistId, changeType: "insert", previousRawRow: null, currentRawRow: structuredClone(row.rawRow) });
      return "inserted" as const;
    }
    if (previous.row.rowHash === row.rowHash) return "unchanged" as const;
    this.state.metrics.set(identity, { orgId, artistId, persistedRowKey, row: structuredClone(row) });
    this.state.changes.push({
      orgId,
      artistId,
      changeType: "update",
      previousRawRow: structuredClone(previous.row.rawRow),
      currentRawRow: structuredClone(row.rawRow),
    });
    return "updated" as const;
  }

  private latest(run: StoredRun): LatestSpotifyAudienceImport {
    const file = this.state.files.find((candidate) => candidate.runId === run.id);
    const artist = this.artists.get(`${run.orgId}:${run.artistId}`);
    if (!file || !artist) throw new Error("Incomplete fake import evidence");
    return {
      artistId: run.artistId,
      artistName: artist.name,
      runId: run.id,
      fileName: file.fileName,
      sha256: file.sha256,
      rowCount: file.rowCount,
      importedAt,
      reportingThrough: run.reportingThrough,
    };
  }
}

function csv(...rows: string[]) {
  return new TextEncoder().encode(`${headers}\n${rows.join("\n")}\n`);
}

function row(date: string, listeners: number, streams = 5) {
  return `${date},${listeners},2,3,4,${streams},6,7,8`;
}

function maximumRowCsv(): Uint8Array {
  const start = Date.UTC(1900, 0, 1);
  const rows = Array.from({ length: 100_000 }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return [date, "1", "1", "1", "1", "1", "1", "1", "1"].join(",");
  });
  return csv(...rows);
}

function setup(archiveOverride?: SpotifySourceArchive, assertArchiveReady?: () => void) {
  const store = new StatefulSpotifyStore();
  store.addArtist("org-a", "artist-a", "Artist A");
  store.addArtist("org-a", "artist-b", "Artist B");
  store.addArtist("org-b", "artist-a", "Other Artist A");
  store.addArtist("org-b", "artist-cross-tenant", "Cross Tenant Artist");
  const archived: Array<{ orgId: string; artistId: string; sha256: string; bytes: Uint8Array; bucket: string; key: string }> = [];
  const archive: SpotifySourceArchive = archiveOverride ?? (async (input) => {
    const location = {
      bucket: "private",
      key: `${input.orgId}/analytics/spotify-for-artists/${input.artistId}/audience-timeline/${input.sha256}.csv`,
    };
    archived.push({ ...input, ...location });
    return location;
  });
  let id = 0;
  const service = createSpotifyAnalyticsImportService({
    store,
    archive,
    assertArchiveReady,
    now: () => new Date(importedAt),
    randomId: () => `id-${++id}`,
  });
  return { store, archived, service };
}

function input(bytes: Uint8Array, overrides: Partial<{ orgId: string; artistId: string; expectedSha256: string; fileName: string }> = {}) {
  const parsed = parseSpotifyAudienceTimeline(bytes, "Audience timeline.csv");
  return {
    orgId: "org-a",
    artistId: "artist-a",
    expectedSha256: parsed.sha256,
    bytes,
    fileName: "Audience timeline.csv",
    ...overrides,
  };
}

describe("createSpotifyAnalyticsImportService", () => {
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

  it("fails apply before the import transaction when private archive configuration is unavailable", async () => {
    const { service, store, archived } = setup(undefined, () => {
      throw new Error("R2_ANALYTICS_PRIVATE_BUCKET is required");
    });
    const bytes = csv(row("2026-06-24", 1));

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).rejects.toThrow("R2_ANALYTICS_PRIVATE_BUCKET");
    expect(store.state.runs).toHaveLength(0);
    expect(archived).toHaveLength(0);
    expect(store.failedRuns).toEqual([expect.objectContaining({
      artistId: null,
      error: "Spotify audience import failed during private archive",
    })]);
  });

  it("keeps lossy artist-id sanitization collision-safe in deterministic archive keys", () => {
    const sha256 = "a".repeat(64);

    expect(spotifyAudienceArchiveKey("artist/a", sha256)).not.toBe(spotifyAudienceArchiveKey("artist-a", sha256));
    expect(spotifyAudienceArchiveKey("artist-a", sha256)).toBe(`analytics/spotify-for-artists/artist-a/audience-timeline/${sha256}.csv`);
  });

  it("rejects a preview hash mismatch before any write or archive", async () => {
    const { service, store, archived } = setup();
    const bytes = csv(row("2026-06-24", 1));

    await expect(service.applySpotifyAudienceTimeline(input(bytes, { expectedSha256: "0".repeat(64) }))).rejects.toMatchObject({
      message: "Spotify audience preview no longer matches the selected file",
      status: 409,
    });
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("rejects an artist outside the authenticated tenant", async () => {
    const { service, store, archived } = setup();
    const bytes = csv(row("2026-06-24", 1));

    await expect(service.applySpotifyAudienceTimeline(input(bytes, { artistId: "missing" }))).rejects.toBeInstanceOf(HttpError);
    expect(store.state.runs).toHaveLength(0);
    expect(store.failedRuns).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });

  it("records tenant-verification failures without the unverified artist foreign key", async () => {
    const { service, store } = setup();
    store.findArtistError = new Error("postgres://reporter:password@database.internal/analytics refused connection");
    const bytes = csv(row("2026-06-24", 1));

    await expect(service.applySpotifyAudienceTimeline(input(bytes, { artistId: "artist-cross-tenant" }))).rejects.toThrow();
    expect(store.failedRuns).toEqual([expect.objectContaining({
      orgId: "org-a",
      artistId: null,
      error: "Spotify audience import failed during tenant verification",
    })]);
  });

  it("archives provenance and inserts the complete first history", async () => {
    const { service, store, archived } = setup();
    const bytes = csv(row("2026-06-24", 84, 123), row("2026-06-25", 85, 124));
    const parsed = parseSpotifyAudienceTimeline(bytes, "Audience timeline.csv");

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).resolves.toEqual({
      kind: "imported",
      runId: "air_id-1",
      inserted: 2,
      updated: 0,
      unchanged: 0,
      reportingThrough: "2026-06-25",
      latest: {
        artistId: "artist-a",
        artistName: "Artist A",
        runId: "air_id-1",
        fileName: "Audience-timeline.csv",
        sha256: parsed.sha256,
        rowCount: 2,
        importedAt,
        reportingThrough: "2026-06-25",
      },
    });
    expect(archived).toHaveLength(1);
    expect(store.state.files[0]).toMatchObject({
      fileName: "Audience-timeline.csv",
      rowCount: 2,
      actualDateRange: "2026-06-24..2026-06-25",
      storageBucket: "private",
      storageKey: archived[0].key,
    });
    expect([...store.state.metrics.values()].map((metric) => metric.persistedRowKey)).toEqual([
      "artist:artist-a:date:2026-06-24",
      "artist:artist-a:date:2026-06-25",
    ]);
  });

  it("persists the full 100,000-row parser limit through the batched transaction boundary", async () => {
    const { service, store } = setup();
    const bytes = maximumRowCsv();

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).resolves.toMatchObject({
      kind: "imported",
      inserted: 100_000,
      updated: 0,
      unchanged: 0,
    });
    expect(store.state.metrics.size).toBe(100_000);
  }, 15_000);

  it("returns an identical successful hash as a duplicate without another archive or write", async () => {
    const { service, store, archived } = setup();
    const bytes = csv(row("2026-06-24", 84), row("2026-06-25", 85));
    const first = await service.applySpotifyAudienceTimeline(input(bytes));
    const stateBefore = structuredClone(store.state);
    if (first.kind !== "imported") throw new Error("Expected initial Spotify import");

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).resolves.toEqual({
      kind: "duplicate",
      runId: first.runId,
      reportingThrough: "2026-06-25",
      latest: first.latest,
    });
    expect(store.state).toEqual(stateBefore);
    expect(archived).toHaveLength(1);
  });

  it.each([
    "upload https://private.example/source.csv failed with token=secret",
    "postgres://reporter:password@database.internal/analytics refused connection",
    "s3://confidential-bucket/org-a/source.csv could not be written",
  ])("preserves the original caller error while storing only an allowlisted failure category for %s", async (dependencyMessage) => {
    const archive = async () => { throw new Error(dependencyMessage); };
    const { service, store } = setup(archive);
    const bytes = csv(row("2026-06-24", 84));

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).rejects.toThrow(dependencyMessage);
    expect(store.state.runs).toHaveLength(0);
    expect(store.state.files).toHaveLength(0);
    expect(store.state.metrics.size).toBe(0);
    expect(store.failedRuns).toEqual([expect.objectContaining({
      error: "Spotify audience import failed during private archive",
    })]);
    expect(JSON.stringify(store.failedRuns)).not.toContain(dependencyMessage);
  });

  it("preserves the normalized-persistence caller error when failed-evidence persistence also fails", async () => {
    const dependencyError = new Error("normalized persistence dependency failed");
    const { service, store, archived } = setup();
    store.upsertRowsError = dependencyError;
    store.recordFailedRunError = new Error("failed-evidence dependency failed");
    const bytes = csv(row("2026-06-24", 84));

    const thrown = await service.applySpotifyAudienceTimeline(input(bytes)).catch((error: unknown) => error);

    expect(thrown).toBe(dependencyError);
    expect(store.failedRuns).toHaveLength(0);
    expect(store.state.runs).toHaveLength(0);
    expect(store.state.files).toHaveLength(0);
    expect(store.state.metrics.size).toBe(0);
    expect(archived).toHaveLength(1);
  });

  it("retains uploaded private-file provenance when later database work rolls back", async () => {
    const { service, store, archived } = setup();
    store.upsertRowsError = new Error("metric persistence failed");
    const bytes = csv(row("2026-06-24", 84), row("2026-06-25", 85));
    const parsed = parseSpotifyAudienceTimeline(bytes, "Audience timeline.csv");

    await expect(service.applySpotifyAudienceTimeline(input(bytes))).rejects.toThrow("metric persistence failed");

    expect(store.state.runs).toHaveLength(0);
    expect(store.state.files).toHaveLength(0);
    expect(store.state.metrics.size).toBe(0);
    expect(archived).toHaveLength(1);
    expect(store.failedRuns).toEqual([{
      runId: "air_id-3",
      fileId: "aif_id-4",
      orgId: "org-a",
      artistId: "artist-a",
      fileName: "Audience-timeline.csv",
      sha256: parsed.sha256,
      byteSize: bytes.byteLength,
      rowCount: 2,
      headers: headers.split(","),
      actualDateRange: "2026-06-24..2026-06-25",
      reportingThrough: "2026-06-25",
      archivedFile: {
        storageBucket: "private",
        storageKey: archived[0].key,
      },
      error: "Spotify audience import failed during metric persistence",
    }]);
  });

  it("updates corrected overlap, preserves absent dates, and appends previous/current raw evidence", async () => {
    const { service, store } = setup();
    const first = csv(row("2026-06-24", 84), row("2026-06-25", 85), row("2026-06-26", 86));
    const corrected = csv(row("2026-06-24", 184), row("2026-06-25", 85));
    await service.applySpotifyAudienceTimeline(input(first));

    await expect(service.applySpotifyAudienceTimeline(input(corrected))).resolves.toMatchObject({
      kind: "imported",
      inserted: 0,
      updated: 1,
      unchanged: 1,
      reportingThrough: "2026-06-25",
    });
    expect(store.state.metrics.size).toBe(3);
    const update = store.state.changes.find((change) => change.changeType === "update");
    expect(update).toMatchObject({
      previousRawRow: { date: "2026-06-24", listeners: "84" },
      currentRawRow: { date: "2026-06-24", listeners: "184" },
    });
  });

  it("keeps another artist and another organization isolated while listing latest imports", async () => {
    const { service, store } = setup();
    const base = csv(row("2026-06-24", 10));
    await service.applySpotifyAudienceTimeline(input(base));
    await service.applySpotifyAudienceTimeline(input(csv(row("2026-06-24", 20)), { artistId: "artist-b" }));
    await service.applySpotifyAudienceTimeline(input(csv(row("2026-06-24", 30)), { orgId: "org-b" }));
    await service.applySpotifyAudienceTimeline(input(csv(row("2026-06-24", 11))));

    expect(store.state.metrics.size).toBe(3);
    expect(store.state.metrics.get("org-a:artist-b:2026-06-24")?.row.metrics.listeners).toBe(20);
    expect(store.state.metrics.get("org-b:artist-a:2026-06-24")?.row.metrics.listeners).toBe(30);
    await expect(service.listLatestSpotifyAudienceImports("org-a")).resolves.toEqual([
      expect.objectContaining({ artistId: "artist-a", reportingThrough: "2026-06-24" }),
      expect.objectContaining({ artistId: "artist-b", reportingThrough: "2026-06-24" }),
    ]);
  });
});
