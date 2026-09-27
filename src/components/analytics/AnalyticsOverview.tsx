import { useMemo } from "react";
import type { AnalyticsWidgetSummary } from "../../server/analytics";
import { formatAnalyticsNumber, formatAnalyticsLongDate } from "./utils";

interface Props {
  totalRows: number;
  totalWidgets: number;
  totalLinkedTracks: number;
  lastSeenAt: Date | null;
  widgets: AnalyticsWidgetSummary[];
}

export default function AnalyticsOverview({
  totalRows,
  totalWidgets,
  totalLinkedTracks,
  lastSeenAt,
  widgets,
}: Props) {
  const maxRowCount = useMemo(
    () => Math.max(...widgets.map((w) => w.rowCount), 1),
    [widgets],
  );

  return (
    <section className="space-y-8">
      {/* KPI row — the most important thing on the page */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Analytics rows" value={formatAnalyticsNumber(totalRows)} />
        <KpiCard label="Widgets" value={formatAnalyticsNumber(totalWidgets)} />
        <KpiCard label="Linked tracks" value={formatAnalyticsNumber(totalLinkedTracks)} />
        <KpiCard
          label="Last synced"
          value={lastSeenAt ? formatAnalyticsLongDate(lastSeenAt) : "—"}
        />
      </div>

      {/* Widget source breakdown — secondary, quieter */}
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted-foreground)]">Sources · CSV history first, live sync below</p>
        <div className="space-y-3">
          {widgets.map((widget) => {
            const pct = maxRowCount > 0 ? (widget.rowCount / maxRowCount) * 100 : 0;
            return (
              <div key={widget.widgetKey} className="flex items-center gap-3">
                <span
                  className="w-44 truncate text-sm text-[var(--foreground)]"
                  title={widget.widgetKey}
                >
                  {widgetTitle(widget.widgetKey)}
                </span>
                <div className="flex-1 h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor: "var(--chart-1)",
                    }}
                  />
                </div>
                <span className="w-24 text-right text-sm tabular-nums font-semibold">
                  {formatAnalyticsNumber(widget.rowCount)}
                </span>
                <span className="w-16 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                  {widget.trackCount > 0 ? `${widget.trackCount} trk` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-3xl font-semibold leading-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}

function widgetTitle(widgetKey: string): string {
  const titles: Record<string, string> = {
    "tracks-by-growth-rate": "Tracks by Growth",
    "csv-track-totals": "CSV Track Totals",
    "csv-daily-source-mix": "CSV Daily Source Mix",
    "csv-geo-superfans": "CSV Geo Superfans",
    "csv-demographics": "CSV Demographics",
    "csv-playlists": "CSV Playlists",
    "csv-shazams-city": "CSV Shazams by City",
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
