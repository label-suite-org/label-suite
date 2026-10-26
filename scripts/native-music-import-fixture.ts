import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { importNativeMusicSnapshot, listNativeMusicCatalogues } from "../src/server/native-music-import";
import { parseNativeMusicSnapshot } from "../src/server/native-music-snapshot";
import { assertDisposableMigratedAnalyticsFixtureTarget } from "./sisense-fixture-safety";

assertDisposableMigratedAnalyticsFixtureTarget({ databaseUrl: process.env.ANALYTICS_FIXTURE_DB_URL,
  fixtureDb: process.env.ANALYTICS_FIXTURE_DB, fixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
const pool = new Pool({ connectionString: process.env.ANALYTICS_FIXTURE_DB_URL });
const database = drizzle(pool, { schema });
const orgId = `fixture-native-${randomUUID()}`;
const artistId = `fixture-artist-${randomUUID()}`;
const nativeArtist = "A".repeat(22);
const sourceUrl = `https://artists.spotify.com/c/artist/${nativeArtist}/music/songs`;
const row = (recordingId: string, value: number | null) => ({ recordingId, title: "Same title", value,
  sourceUrl: `https://artists.spotify.com/c/artist/${nativeArtist}/song/${recordingId}/stats` });
const capture = (capturedAt: string, rows: ReturnType<typeof row>[]) => ({
  version: 1, provider: "spotify_for_artists", providerArtistId: nativeArtist, artistName: "Fixture Artist",
  capturedAt, dateFrom: "2026-01-01", dateThrough: "2026-01-02", territory: "worldwide", metric: "audio_streams",
  artistTotal: null, acquisition: "signed_in_browser_capture", sourceUrl, rows,
});
let archived = 0;
const dependencies = { database: async () => database, archive: async () => {
  archived += 1; return { bucket: "fixture-private", key: `fixture/${archived}.json` };
} };
const input = (snapshot: ReturnType<typeof capture>) => {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return { orgId, artistId, bytes, fileName: "native.json", expectedSha256: parseNativeMusicSnapshot(bytes).sha256 };
};
try {
  await pool.query('insert into label_suite.orgs (id,name,slug) values ($1,$1,$1)', [orgId]);
  await pool.query('insert into label_suite.artists (id,org_id,name,spotify_id) values ($1,$2,$1,$3)', [artistId, orgId, nativeArtist]);
  const first = input(capture("2026-01-03T12:00:00Z", [row("B".repeat(22), 7), row("C".repeat(22), 0)]));
  await assert.rejects(importNativeMusicSnapshot({ ...first, expectedSha256: "wrong" }, dependencies), /preview no longer matches/);
  await assert.rejects(importNativeMusicSnapshot({ ...first, orgId: "other-org" }, dependencies), /Artist not found/);
  assert.equal(archived, 0);
  assert.equal((await importNativeMusicSnapshot(first, dependencies)).kind, "imported");
  assert.equal((await importNativeMusicSnapshot(first, dependencies)).kind, "duplicate");
  assert.equal(archived, 1);
  assert.equal((await listNativeMusicCatalogues(orgId, artistId, database))[0].rows.length, 2);
  assert.deepEqual(await listNativeMusicCatalogues("other-org", artistId, database), []);

  const newer = input(capture("2026-01-04T12:00:00Z", [row("B".repeat(22), null)]));
  await importNativeMusicSnapshot(newer, dependencies);
  // An old file uploaded last must not replace the newer observation, nor may
  // a song absent from the new capture survive through merged membership.
  await importNativeMusicSnapshot(input(capture("2026-01-02T12:00:00Z", [row("D".repeat(22), 99)])), dependencies);
  const latest = (await listNativeMusicCatalogues(orgId, artistId, database))[0];
  assert.equal(latest.capturedAt, "2026-01-04T12:00:00Z");
  assert.deepEqual(latest.rows, [row("B".repeat(22), null)]);
  assert.equal(Number((await pool.query('select count(*) from label_suite.analytics_metric_rows where org_id=$1', [orgId])).rows[0].count), 4);

  await pool.query('delete from label_suite.analytics_metric_rows where org_id=$1 and last_seen_run_id=$2', [orgId, latest.runId]);
  await assert.rejects(listNativeMusicCatalogues(orgId, artistId, database), /catalogue is incomplete/);
  console.log("PASS native catalogue import: identity, tenant isolation, preview binding, deduplication, immutable runs, latest observation, null/zero and incomplete read rejection");
} finally {
  for (const table of ["analytics_metric_changes", "analytics_metric_rows", "analytics_import_files", "analytics_import_runs", "artists", "orgs"]) {
    await pool.query(`delete from label_suite.${table} where ${table === "orgs" ? "id" : "org_id"}=$1`, [orgId]);
  }
  await pool.end();
}
