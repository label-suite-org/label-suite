#!/usr/bin/env npx tsx
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CSV_DIR = path.resolve(process.env.SISENSE_CSV_DIR || process.env.HOME || "/Users/malthe", process.env.SISENSE_CSV_DIR ? "" : "Downloads");

type CsvRow = Record<string, string>;

const FILES = {
  tracks: "TracksbyGrowthRate_2026-7-5_1457.csv",
  spotifySource: "SpotifyStreamsbySource_2026-7-5_1457.csv",
  appleSource: "AppleStreamsbySource_2026-7-5_1456.csv",
  demographics: "SpotifyDemographicsbyPassionIndicators_2026-7-5_1458.csv",
  superfansCity: "SpotifySuperfansActiveStreamsbyCity_2026-7-5_1458.csv",
  playlists: "SpotifyPlaylistListings_2026-7-5_1457.csv",
  shazamsCity: "ShazamsbyCity_2026-7-5_1456.csv",
};

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseInt0(value: string | undefined): number {
  return Math.trunc(parseNumber(value) ?? 0);
}

function parseNumeric(value: string | undefined): number | null {
  return parseNumber(value);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function parseCsv(fileName: string): Promise<CsvRow[]> {
  const filePath = path.join(CSV_DIR, fileName);
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const rows: CsvRow[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line).map((v) => v.replace(/^"|"$/g, ""));
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

const setupSql = `
CREATE SCHEMA IF NOT EXISTS label_suite;

DROP MATERIALIZED VIEW IF EXISTS label_suite.shazams_city CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.top_playlists CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.demographics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.track_totals CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.geo_superfans CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.monthly_source_mix CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.weekly_source_mix CASCADE;
DROP MATERIALIZED VIEW IF EXISTS label_suite.daily_source_mix CASCADE;

CREATE TABLE IF NOT EXISTS label_suite.staging_tracks_cumulative (
  id serial PRIMARY KEY,
  track_title text NOT NULL,
  primary_artist text,
  spotify_streams bigint,
  apple_streams bigint,
  amazon_streams bigint,
  pandora_streams bigint,
  combined_streams bigint,
  streams_growth numeric,
  youtube_views bigint,
  tiktok_views bigint,
  combined_views bigint,
  views_growth numeric,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_spotify_streams_source (
  id serial PRIMARY KEY,
  date date NOT NULL,
  source text NOT NULL,
  streams bigint NOT NULL DEFAULT 0,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_apple_streams_source (
  id serial PRIMARY KEY,
  date date NOT NULL,
  source_of_stream text NOT NULL,
  streams bigint NOT NULL DEFAULT 0,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_spotify_demographics (
  id serial PRIMARY KEY,
  gender text,
  age_group text,
  active_stream_rate numeric,
  average_completion_rate numeric,
  average_streams_per_user numeric,
  streams bigint NOT NULL DEFAULT 0,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_spotify_superfans_city (
  id serial PRIMARY KEY,
  city text NOT NULL,
  country text,
  superfans bigint NOT NULL DEFAULT 0,
  active_streams bigint NOT NULL DEFAULT 0,
  streams bigint NOT NULL DEFAULT 0,
  active_stream_rate numeric,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_spotify_playlists (
  id serial PRIMARY KEY,
  playlist_name text,
  playlist_source_uri text,
  playlist_owner_id text,
  latest_position int,
  streams bigint NOT NULL DEFAULT 0,
  average_completion_rate numeric,
  average_streams_per_user numeric,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_suite.staging_shazams_city (
  id serial PRIMARY KEY,
  city text NOT NULL,
  state text,
  country text,
  shazams bigint NOT NULL DEFAULT 0,
  imported_at timestamptz DEFAULT now()
);

TRUNCATE TABLE
  label_suite.staging_tracks_cumulative,
  label_suite.staging_spotify_streams_source,
  label_suite.staging_apple_streams_source,
  label_suite.staging_spotify_demographics,
  label_suite.staging_spotify_superfans_city,
  label_suite.staging_spotify_playlists,
  label_suite.staging_shazams_city
RESTART IDENTITY;
`;

const viewsSql = `
CREATE MATERIALIZED VIEW label_suite.daily_source_mix AS
SELECT date, 'spotify'::text AS platform, source, sum(streams)::bigint AS streams
FROM label_suite.staging_spotify_streams_source
GROUP BY date, source
UNION ALL
SELECT date, 'apple'::text AS platform, source_of_stream AS source, sum(streams)::bigint AS streams
FROM label_suite.staging_apple_streams_source
GROUP BY date, source_of_stream;
CREATE INDEX idx_daily_source_mix_date ON label_suite.daily_source_mix(date);
CREATE INDEX idx_daily_source_mix_platform_source ON label_suite.daily_source_mix(platform, source);

CREATE MATERIALIZED VIEW label_suite.weekly_source_mix AS
SELECT platform, source, sum(streams)::bigint AS streams,
  (sum(streams) * 100.0 / nullif(sum(sum(streams)) OVER (PARTITION BY platform), 0))::numeric AS pct
FROM label_suite.daily_source_mix
WHERE date >= (SELECT max(date) FROM label_suite.daily_source_mix) - interval '7 days'
GROUP BY platform, source
ORDER BY platform, streams DESC;

CREATE MATERIALIZED VIEW label_suite.monthly_source_mix AS
SELECT platform, source, sum(streams)::bigint AS streams,
  (sum(streams) * 100.0 / nullif(sum(sum(streams)) OVER (PARTITION BY platform), 0))::numeric AS pct
FROM label_suite.daily_source_mix
WHERE date >= (SELECT max(date) FROM label_suite.daily_source_mix) - interval '30 days'
GROUP BY platform, source
ORDER BY platform, streams DESC;

CREATE MATERIALIZED VIEW label_suite.geo_superfans AS
SELECT city, country, superfans, streams, active_streams, active_stream_rate,
  row_number() OVER (ORDER BY superfans DESC, streams DESC) AS rank_global,
  row_number() OVER (PARTITION BY country ORDER BY superfans DESC, streams DESC) AS rank_country
FROM label_suite.staging_spotify_superfans_city
WHERE superfans > 0
ORDER BY superfans DESC, streams DESC;
CREATE INDEX idx_geo_superfans_country ON label_suite.geo_superfans(country);
CREATE INDEX idx_geo_superfans_city ON label_suite.geo_superfans(city);

CREATE MATERIALIZED VIEW label_suite.track_totals AS
SELECT track_title, primary_artist, spotify_streams, apple_streams, amazon_streams, pandora_streams,
  combined_streams, streams_growth, youtube_views, tiktok_views, combined_views, views_growth,
  imported_at AS last_seen_at
FROM label_suite.staging_tracks_cumulative
WHERE coalesce(combined_streams, 0) > 0
ORDER BY combined_streams DESC;
CREATE INDEX idx_track_totals_combined ON label_suite.track_totals(combined_streams DESC);

CREATE MATERIALIZED VIEW label_suite.demographics AS
SELECT gender, age_group, streams, active_stream_rate, average_completion_rate, average_streams_per_user,
  imported_at AS last_seen_at
FROM label_suite.staging_spotify_demographics
WHERE streams > 0
ORDER BY streams DESC;

CREATE MATERIALIZED VIEW label_suite.top_playlists AS
SELECT playlist_name, playlist_source_uri, playlist_owner_id, latest_position, streams,
  average_completion_rate, average_streams_per_user, imported_at AS last_seen_at
FROM label_suite.staging_spotify_playlists
WHERE streams > 0
ORDER BY streams DESC
LIMIT 100;

CREATE MATERIALIZED VIEW label_suite.shazams_city AS
SELECT city, state, country, shazams, imported_at AS last_seen_at
FROM label_suite.staging_shazams_city
WHERE shazams > 0
ORDER BY shazams DESC;
`;

async function insertRows(client: pg.PoolClient) {
  const tracks = await parseCsv(FILES.tracks);
  for (const row of tracks) {
    await client.query(
      `INSERT INTO label_suite.staging_tracks_cumulative
       (track_title, primary_artist, spotify_streams, apple_streams, amazon_streams, pandora_streams, combined_streams, streams_growth, youtube_views, tiktok_views, combined_views, views_growth)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.track_title, row.primary_artist || null, parseInt0(row.spotify_streams), parseInt0(row.apple_streams), parseInt0(row.amazon_streams), parseInt0(row.pandora_streams), parseInt0(row.combined_streams), parseNumeric(row.streams_growth), parseInt0(row.youtube_views), parseInt0(row.tiktok_views), parseInt0(row.combined_views), parseNumeric(row.views_growth)],
    );
  }
  console.log(`tracks-by-growth: ${tracks.length} rows`);

  const spotifySource = await parseCsv(FILES.spotifySource);
  for (const row of spotifySource) {
    await client.query(
      `INSERT INTO label_suite.staging_spotify_streams_source (date, source, streams) VALUES ($1,$2,$3)`,
      [row._col0, row.source || "Unknown", parseInt0(row.streams)],
    );
  }
  console.log(`spotify-streams-source: ${spotifySource.length} rows`);

  const appleSource = await parseCsv(FILES.appleSource);
  for (const row of appleSource) {
    await client.query(
      `INSERT INTO label_suite.staging_apple_streams_source (date, source_of_stream, streams) VALUES ($1,$2,$3)`,
      [row._col0, row.source_of_stream || "Unknown", parseInt0(row.streams)],
    );
  }
  console.log(`apple-streams-source: ${appleSource.length} rows`);

  const demographics = await parseCsv(FILES.demographics);
  for (const row of demographics) {
    await client.query(
      `INSERT INTO label_suite.staging_spotify_demographics (gender, age_group, active_stream_rate, average_completion_rate, average_streams_per_user, streams)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.gender || null, row.age || null, parseNumeric(row.active_stream_rate), parseNumeric(row.average_completion_rate), parseNumeric(row.average_streams_per_user), parseInt0(row.streams)],
    );
  }
  console.log(`spotify-demographics: ${demographics.length} rows`);

  const superfans = await parseCsv(FILES.superfansCity);
  for (const row of superfans) {
    await client.query(
      `INSERT INTO label_suite.staging_spotify_superfans_city (city, country, superfans, active_streams, streams, active_stream_rate)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.city || "Unknown", row.country || null, parseInt0(row.superfans), parseInt0(row.active_streams), parseInt0(row.streams), parseNumeric(row.active_stream_rate)],
    );
  }
  console.log(`spotify-superfans-city: ${superfans.length} rows`);

  const playlists = await parseCsv(FILES.playlists);
  for (const row of playlists) {
    await client.query(
      `INSERT INTO label_suite.staging_spotify_playlists (playlist_name, playlist_source_uri, playlist_owner_id, latest_position, streams, average_completion_rate, average_streams_per_user)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.playlist__name || null, row.playlist__source_uri || null, row.playlist__owner_id || null, parseNumber(row.latest_position), parseInt0(row.streams), parseNumeric(row.average_completion_rate), parseNumeric(row.average_streams_per_user)],
    );
  }
  console.log(`spotify-playlists: ${playlists.length} rows`);

  const shazams = await parseCsv(FILES.shazamsCity);
  for (const row of shazams) {
    await client.query(
      `INSERT INTO label_suite.staging_shazams_city (city, state, country, shazams) VALUES ($1,$2,$3,$4)`,
      [row.city || "Unknown", row.state || null, row.country || null, parseInt0(row.shazams)],
    );
  }
  console.log(`shazams-city: ${shazams.length} rows`);
}

async function verify(client: pg.PoolClient) {
  const checks = await client.query(`
    SELECT 'track_totals' AS name, count(*)::int AS rows, coalesce(sum(combined_streams),0)::bigint AS total FROM label_suite.track_totals
    UNION ALL SELECT 'daily_source_mix', count(*)::int, coalesce(sum(streams),0)::bigint FROM label_suite.daily_source_mix
    UNION ALL SELECT 'geo_superfans', count(*)::int, coalesce(sum(superfans),0)::bigint FROM label_suite.geo_superfans
    UNION ALL SELECT 'top_playlists', count(*)::int, coalesce(sum(streams),0)::bigint FROM label_suite.top_playlists
    UNION ALL SELECT 'shazams_city', count(*)::int, coalesce(sum(shazams),0)::bigint FROM label_suite.shazams_city
  `);
  console.table(checks.rows);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = await pool.connect();
  try {
    console.log(`Importing Sisense CSVs from ${CSV_DIR}`);
    await client.query("BEGIN");
    await client.query(setupSql);
    await insertRows(client);
    await client.query(viewsSql);
    await verify(client);
    await client.query("COMMIT");
    console.log("✅ Sisense CSV import + materialized views complete");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Sisense CSV import failed");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
