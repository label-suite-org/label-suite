import type { AnalyticsSourceRow } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

interface Props {
  spotify: AnalyticsSourceRow[];
  apple: AnalyticsSourceRow[];
}

export default function SpotifySourceBreakdown({ spotify, apple }: Props) {
  return (
    <section className="space-y-6">
      <p className="text-xs text-[var(--muted-foreground)]">
        Last 30 days from the imported Sisense source CSVs. Spotify and Apple are kept separate.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <SourceList title="Spotify" rows={spotify} barColor="var(--chart-3)" />
        <SourceList title="Apple" rows={apple} barColor="var(--chart-4)" />
      </div>
    </section>
  );
}

function SourceList({
  title,
  rows,
  barColor,
}: {
  title: string;
  rows: AnalyticsSourceRow[];
  barColor: string;
}) {
  const maxStreams = Math.max(...rows.map((r) => r.streams), 1);

  if (!rows.length) {
    return (
      <div>
        <p className="text-sm font-medium mb-2">{title}</p>
        <p className="text-xs text-[var(--muted-foreground)]">No source data available.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium mb-3">{title}</p>
      <div className="space-y-3">
        {rows.map((row, i) => {
          const pct = (row.streams / maxStreams) * 100;
          return (
            <div key={`${row.source}-${i}`} className="flex items-center gap-3">
              <span
                className="w-32 truncate text-sm"
                title={row.source}
              >
                {row.source}
              </span>
              <div className="flex-1 h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: barColor }}
                />
              </div>
              <span className="w-24 text-right text-sm tabular-nums font-semibold">
                {formatAnalyticsNumber(row.streams)}
              </span>
              <span className="w-16 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                {row.trackCount > 0 ? `${row.trackCount} trk` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
