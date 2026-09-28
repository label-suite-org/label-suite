import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { persistSisenseTrackSnapshotRowsSetBased, resolveSisenseTrackPrivateAnalyticsBucket, sisenseTrackArchiveKey } from "./sisense-track-snapshot-import";
import type { ResolvedSisenseTrackRow } from "./sisense-track-snapshot-preview";
const importedAt = "2026-08-11T12:00:00.000Z";

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

describe("production set-based Sisense persistence", () => {
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
