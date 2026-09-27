import { SANDBOX_FIXTURE_VERSION } from "./analytics-sandbox-config";

export { SANDBOX_FIXTURE_VERSION } from "./analytics-sandbox-config";

export const SANDBOX_ID_PREFIX = "sandbox-v1-";

const FIXED_TIMESTAMP = "2026-07-15T08:00:00.000Z";
const REPORTING_DATE_RANGE = "2026-07-01 through 2026-07-14";
const REPORTING_AGGREGATION = "Daily";
const artists = ["North Window", "Paper Lantern", "Salt Index"];
const releases = ["Tide Lines", "Still Signal", "Amber Rooms"];
const tracks = ["Low Current", "Glass Maps", "Soft Relay", "Night Index", "After Weather"];
const SANDBOX_WIDGET_KEYS = [
  "apple-streams-source",
  "passion-indicator-benchmarks-genre",
  "spotify-demographics-passion-indicators",
  "spotify-playlist-listings",
  "spotify-streams-source",
  "spotify-superfans-active-streams-city",
  "tracks-by-growth-rate",
] as const;

export interface AnalyticsSandboxArtist {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsSandboxRelease {
  id: string;
  org_id: string;
  title: string;
  artist_id: string;
  release_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsSandboxTrack {
  id: string;
  org_id: string;
  title: string;
  release_id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsSandboxImportRun {
  id: string;
  org_id: string;
  source: "sisense";
  artist_id: null;
  release_id: null;
  track_id: null;
  mode: "sync";
  requested_date_range: string;
  requested_aggregation: string;
  status: "completed";
  started_at: string;
  completed_at: string;
  files_downloaded: number;
  rows_imported: number;
  rows_inserted: number;
  rows_updated: number;
  rows_unchanged: number;
  error: null;
  metadata: {
    sandbox_fixture: typeof SANDBOX_FIXTURE_VERSION;
    completeness: {
      version: 2;
      expectedWidgetKeys: string[];
      downloadedWidgetKeys: string[];
      observedEmptyWidgets: [];
      skippedWidgets: [];
      state: "complete";
    };
  };
}

export interface AnalyticsSandboxMetricRow {
  id: string;
  org_id: string;
  source: "sisense";
  widget_key: string;
  artist_id: string | null;
  release_id: string | null;
  track_id: string | null;
  row_key: string;
  row_hash: string;
  requested_date_range: string;
  requested_aggregation: string;
  dimensions: Record<string, string | null> & { _sandbox_fixture: typeof SANDBOX_FIXTURE_VERSION };
  metrics: Record<string, number | null>;
  raw_row: Record<string, string | null>;
  first_seen_run_id: string;
  last_seen_run_id: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AnalyticsSandboxFixture {
  version: typeof SANDBOX_FIXTURE_VERSION;
  artists: AnalyticsSandboxArtist[];
  releases: AnalyticsSandboxRelease[];
  tracks: AnalyticsSandboxTrack[];
  importRuns: AnalyticsSandboxImportRun[];
  metricRows: AnalyticsSandboxMetricRow[];
}

export function buildAnalyticsSandboxFixture(orgId: string): AnalyticsSandboxFixture {
  const fixtureArtists = artists.map((name, index) => ({
    id: sandboxId(orgId, `artist-${index + 1}`),
    org_id: orgId,
    name,
    created_at: FIXED_TIMESTAMP,
    updated_at: FIXED_TIMESTAMP,
  }));
  const fixtureReleases = releases.map((title, index) => ({
    id: sandboxId(orgId, `release-${index + 1}`),
    org_id: orgId,
    title,
    artist_id: fixtureArtists[index]!.id,
    release_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    status: "released",
    created_at: FIXED_TIMESTAMP,
    updated_at: FIXED_TIMESTAMP,
  }));
  const fixtureTracks = tracks.map((title, index) => {
    const releaseIndex = Math.floor(index / 2);
    return {
      id: sandboxId(orgId, `track-${index + 1}`),
      org_id: orgId,
      title,
      release_id: fixtureReleases[releaseIndex]!.id,
      position: (index % 2) + 1,
      created_at: FIXED_TIMESTAMP,
      updated_at: FIXED_TIMESTAMP,
    };
  });
  const runId = sandboxId(orgId, "import-run-1");
  const metricRows = [
    ...buildDailySourceRows(orgId, runId),
    ...fixtureTracks.map((track, index) => metricRow({
      id: sandboxId(orgId, `growth-${index + 1}`),
      orgId,
      runId,
      widgetKey: "tracks-by-growth-rate",
      rowKey: `track-${index + 1}`,
      artistId: fixtureArtists[Math.floor(index / 2)]!.id,
      releaseId: track.release_id,
      trackId: track.id,
      dimensions: {
        track_title: track.title,
        release_title: fixtureReleases[Math.floor(index / 2)]!.title,
        primary_artist: fixtureArtists[Math.floor(index / 2)]!.name,
      },
      metrics: buildGrowthMetrics(index),
    })),
    ...["Copenhagen", "Aarhus", "Berlin", "London", "Stockholm", "Amsterdam"].map((city, index) => metricRow({
      id: sandboxId(orgId, `city-${index + 1}`),
      orgId,
      runId,
      widgetKey: "spotify-superfans-active-streams-city",
      rowKey: `city-${index + 1}`,
      artistId: fixtureArtists[index % fixtureArtists.length]!.id,
      releaseId: null,
      trackId: null,
      dimensions: { city, country: ["Denmark", "Denmark", "Germany", "United Kingdom", "Sweden", "Netherlands"][index]! },
      metrics: { streams: 360 + (index * 47), listeners: 24 + (index * 5) },
    })),
    ...["18-24", "25-34", "35-44", "45-54"].map((ageBand, index) => metricRow({
      id: sandboxId(orgId, `demographic-${index + 1}`),
      orgId,
      runId,
      widgetKey: "spotify-demographics-passion-indicators",
      rowKey: `age-${index + 1}`,
      artistId: null,
      releaseId: null,
      trackId: null,
      dimensions: { age_band: ageBand, listener_type: "superfan" },
      metrics: { passion_index: 48 + (index * 8), listeners: 220 + (index * 41) },
    })),
    ...["Lantern Route", "Quiet Coordinates", "Window Seat", "Afterglow Index"].map((playlist, index) => metricRow({
      id: sandboxId(orgId, `playlist-${index + 1}`),
      orgId,
      runId,
      widgetKey: "spotify-playlist-listings",
      rowKey: `playlist-${index + 1}`,
      artistId: fixtureArtists[index % fixtureArtists.length]!.id,
      releaseId: fixtureReleases[index % fixtureReleases.length]!.id,
      trackId: fixtureTracks[index]!.id,
      dimensions: { playlist_name: playlist, curator_type: index % 2 === 0 ? "editorial" : "algorithmic" },
      metrics: { playlist_position: 12 + (index * 7), followers: 1200 + (index * 340) },
    })),
    ...["Ambient", "Indie", "Electronic"].map((genre, index) => metricRow({
      id: sandboxId(orgId, `genre-${index + 1}`),
      orgId,
      runId,
      widgetKey: "passion-indicator-benchmarks-genre",
      rowKey: `genre-${index + 1}`,
      artistId: null,
      releaseId: null,
      trackId: null,
      dimensions: { genre },
      metrics: { benchmark_score: 52 + (index * 9), audience_size: 1400 + (index * 650) },
    })),
  ];

  return {
    version: SANDBOX_FIXTURE_VERSION,
    artists: fixtureArtists,
    releases: fixtureReleases,
    tracks: fixtureTracks,
    importRuns: [{
      id: runId,
      org_id: orgId,
      source: "sisense",
      artist_id: null,
      release_id: null,
      track_id: null,
      mode: "sync",
      requested_date_range: REPORTING_DATE_RANGE,
      requested_aggregation: REPORTING_AGGREGATION,
      status: "completed",
      started_at: FIXED_TIMESTAMP,
      completed_at: FIXED_TIMESTAMP,
      files_downloaded: 0,
      rows_imported: metricRows.length,
      rows_inserted: metricRows.length,
      rows_updated: 0,
      rows_unchanged: 0,
      error: null,
      metadata: {
        sandbox_fixture: SANDBOX_FIXTURE_VERSION,
        completeness: {
          version: 2,
          expectedWidgetKeys: [...SANDBOX_WIDGET_KEYS],
          downloadedWidgetKeys: [...SANDBOX_WIDGET_KEYS],
          observedEmptyWidgets: [],
          skippedWidgets: [],
          state: "complete",
        },
      },
    }],
    metricRows,
  };
}

function buildDailySourceRows(orgId: string, runId: string): AnalyticsSandboxMetricRow[] {
  const sources = [
    { platform: "Spotify", source: "Algorithmic", source_type: "algorithmic", widget_key: "spotify-streams-source" },
    { platform: "Spotify", source: "Editorial", source_type: "editorial", widget_key: "spotify-streams-source" },
    { platform: "Apple Music", source: "Editorial", source_type: "editorial", widget_key: "apple-streams-source" },
    { platform: "Apple Music", source: "Direct", source_type: "direct", widget_key: "apple-streams-source" },
  ];
  const dates = Array.from({ length: 14 }, (_value, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);

  return sources.flatMap((source, sourceIndex) => dates.map((date, dateIndex) => metricRow({
    id: sandboxId(orgId, `daily-${sourceIndex + 1}-${dateIndex + 1}`),
    orgId,
    runId,
    widgetKey: source.widget_key,
    rowKey: `${source.platform.toLowerCase().replaceAll(" ", "-")}-${source.source_type}-${date}`,
    artistId: null,
    releaseId: null,
    trackId: null,
    dimensions: { date, _col0: date, platform: source.platform, source: source.source, source_type: source.source_type },
    metrics: { streams: 1000 + (sourceIndex * 175) + (dateIndex * 19) },
  })));
}

function buildGrowthMetrics(index: number): Record<string, number> {
  const spotifyStreams = 500 + (index * 75);
  const appleStreams = 250 + (index * 40);
  const amazonStreams = 100 + (index * 20);
  const pandoraStreams = 50 + (index * 10);
  const youtubeViews = 650 + (index * 90);
  const tiktokViews = 350 + (index * 65);

  return {
    combined_streams: spotifyStreams + appleStreams + amazonStreams + pandoraStreams,
    spotify_streams: spotifyStreams,
    apple_streams: appleStreams,
    amazon_streams: amazonStreams,
    pandora_streams: pandoraStreams,
    streams_growth: 4 + (index * 3),
    youtube_views: youtubeViews,
    tiktok_views: tiktokViews,
    combined_views: youtubeViews + tiktokViews,
    views_growth: 5 + (index * 2),
  };
}

function metricRow(input: {
  id: string;
  orgId: string;
  runId: string;
  widgetKey: string;
  rowKey: string;
  artistId: string | null;
  releaseId: string | null;
  trackId: string | null;
  dimensions: Record<string, string | null>;
  metrics: Record<string, number | null>;
}): AnalyticsSandboxMetricRow {
  const dimensions: AnalyticsSandboxMetricRow["dimensions"] = {
    ...input.dimensions,
    _sandbox_fixture: SANDBOX_FIXTURE_VERSION,
  };
  return {
    id: input.id,
    org_id: input.orgId,
    source: "sisense",
    widget_key: input.widgetKey,
    artist_id: input.artistId,
    release_id: input.releaseId,
    track_id: input.trackId,
    row_key: input.rowKey,
    row_hash: sandboxId(input.orgId, `hash-${input.rowKey}`),
    requested_date_range: REPORTING_DATE_RANGE,
    requested_aggregation: REPORTING_AGGREGATION,
    dimensions,
    metrics: input.metrics,
    raw_row: {
      ...Object.fromEntries(Object.entries(dimensions)),
      ...Object.fromEntries(Object.entries(input.metrics).map(([key, value]) => [key, value === null ? null : String(value)])),
    },
    first_seen_run_id: input.runId,
    last_seen_run_id: input.runId,
    first_seen_at: FIXED_TIMESTAMP,
    last_seen_at: FIXED_TIMESTAMP,
  };
}

function sandboxId(orgId: string, suffix: string): string {
  return `${SANDBOX_ID_PREFIX}${orgId}:${suffix}`;
}
