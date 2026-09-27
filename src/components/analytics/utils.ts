// Pure formatting helpers — safe to import in client components (no DB/drizzle/dotenv).
// Lives separately from src/server/analytics.ts because that file imports the DB
// pool (via `./../lib/db`), which pulls dotenv into the client bundle.

export function formatAnalyticsDate(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatAnalyticsLongDate(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "Waiting for import";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAnalyticsNumber(value: number): string {
  return value.toLocaleString();
}

export function formatAnalyticsPercent(value: number | null): string {
  if (value === null) return "—";
  return (value * 100).toFixed(1) + "%";
}

export function analyticsGrowthClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value < 0) return "text-red-600 dark:text-red-400";
  if (value > 0) return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function widgetTitle(widgetKey: string): string {
  const titles: Record<string, string> = {
    "tracks-by-growth-rate": "Tracks by Growth",
    "spotify-superfans-active-streams-city": "Spotify Cities",
    "spotify-demographics-passion-indicators": "Spotify Demographics",
    "spotify-streams-source": "Spotify Sources",
    "apple-streams-source": "Apple Sources",
    "spotify-playlist-listings": "Spotify Playlists",
    "shazams-city": "Shazams by City",
    "passion-indicator-benchmarks-genre": "Genre Benchmarks",
  };
  if (titles[widgetKey]) return titles[widgetKey];
  return widgetKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
