import {
  listAnalyticsCities,
  listAnalyticsCommandCenter,
  listAnalyticsStreamSources,
  listAnalyticsTracksByGrowth,
  listAnalyticsWidgetRows,
} from "../src/server/analytics";
import { listAnalyticsDataQuality } from "../src/server/analytics-data-quality";

const orgId = process.env.ANALYTICS_SANDBOX_ORG_ID;
if (!process.env.DATABASE_URL || !orgId) {
  throw new Error("Analytics sandbox query probe requires DATABASE_URL and ANALYTICS_SANDBOX_ORG_ID.");
}

const expectedWidgetKeys = [
  "apple-streams-source",
  "passion-indicator-benchmarks-genre",
  "spotify-demographics-passion-indicators",
  "spotify-playlist-listings",
  "spotify-streams-source",
  "spotify-superfans-active-streams-city",
  "tracks-by-growth-rate",
];

const [tracks, sources, cities, quality, playlists, command] = await Promise.all([
  listAnalyticsTracksByGrowth(orgId, 100),
  listAnalyticsStreamSources(orgId),
  listAnalyticsCities(orgId, 50),
  listAnalyticsDataQuality(orgId),
  listAnalyticsWidgetRows(orgId, "spotify-playlist-listings"),
  listAnalyticsCommandCenter(orgId),
]);

if (tracks.length !== 5 || tracks.some((row) => row.combinedStreams <= 0)) {
  throw new Error("Analytics sandbox query probe expected five growth rows with combinedStreams > 0.");
}
if (!sources.spotify.length || !sources.apple.length || [...sources.spotify, ...sources.apple].some((row) => row.source === "Unknown")) {
  throw new Error("Analytics sandbox query probe expected named Spotify and Apple source rows.");
}
const expectedDailyStreams = 77616;
if (command.periods.find((period) => period.key === "all")?.streamTotal !== expectedDailyStreams
  || [...sources.spotify, ...sources.apple].reduce((sum, row) => sum + row.streams, 0) !== expectedDailyStreams) {
  throw new Error("Analytics daily totals must retain history without counting older copies of the same observation.");
}
if (cities.length !== 6 || cities.some((row) => row.streams <= 0)) {
  throw new Error("Analytics sandbox query probe expected six city rows with streams > 0.");
}
if (!playlists.length || playlists.some((row) => row.label.startsWith("Obsolete"))) {
  throw new Error("Analytics sandbox query probe must exclude obsolete playlist snapshots.");
}
if (
  quality.health.coverage !== "complete"
  || !quality.currentRun
  || JSON.stringify(quality.currentRun.expectedWidgetKeys) !== JSON.stringify(expectedWidgetKeys)
  || JSON.stringify(quality.currentRun.downloadedWidgetKeys) !== JSON.stringify(expectedWidgetKeys)
) {
  throw new Error("Analytics sandbox query probe expected complete evidence for all fixture widgets.");
}

console.log("analytics sandbox real-query probe passed");
