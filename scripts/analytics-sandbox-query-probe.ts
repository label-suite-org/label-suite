import {
  listAnalyticsCities,
  listAnalyticsStreamSources,
  listAnalyticsTracksByGrowth,
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

const [tracks, sources, cities, quality] = await Promise.all([
  listAnalyticsTracksByGrowth(orgId, 100),
  listAnalyticsStreamSources(orgId),
  listAnalyticsCities(orgId, 50),
  listAnalyticsDataQuality(orgId),
]);

if (tracks.length !== 5 || tracks.some((row) => row.combinedStreams <= 0)) {
  throw new Error("Analytics sandbox query probe expected five growth rows with combinedStreams > 0.");
}
if (!sources.spotify.length || !sources.apple.length || [...sources.spotify, ...sources.apple].some((row) => row.source === "Unknown")) {
  throw new Error("Analytics sandbox query probe expected named Spotify and Apple source rows.");
}
if (cities.length !== 6 || cities.some((row) => row.streams <= 0)) {
  throw new Error("Analytics sandbox query probe expected six city rows with streams > 0.");
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
