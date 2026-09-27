"use client";

import type { AnalyticsTrackGrowthRow } from "../../server/analytics";
import { formatAnalyticsNumber, formatAnalyticsPercent, analyticsGrowthClass } from "./utils";
import { SortableTable } from "./SortableTable";

interface Props {
  rows: AnalyticsTrackGrowthRow[];
}

function GrowthCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  const isUp = value > 0;
  const isDown = value < 0;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${analyticsGrowthClass(value)}`}>
      {isUp ? "↑" : isDown ? "↓" : "·"}
      {formatAnalyticsPercent(Math.abs(value))}
    </span>
  );
}

export default function TracksByGrowthTable({ rows }: Props) {
  if (!rows.length) {
    return (
      <section>
        <p className="text-sm text-[var(--muted-foreground)]">No track growth data available.</p>
      </section>
    );
  }

  const totalStreams = rows.reduce((s, r) => s + (r.combinedStreams ?? 0), 0);
  const totalViews = rows.reduce((s, r) => s + (r.combinedViews ?? 0), 0);
  const growthValues = rows.map((r) => r.streamsGrowth).filter((v): v is number => v !== null);
  const growingTracks = growthValues.filter((v) => v > 0).length;
  const decliningTracks = growthValues.filter((v) => v < 0).length;
  const avgGrowth = growthValues.length > 0
    ? growthValues.reduce((a, b) => a + b, 0) / growthValues.length
    : null;

  return (
    <section className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        Cumulative track totals from the imported Sisense CSV. Growth rates are the Sisense-provided fields, not recalculated locally.
      </p>
      {/* Summary strip — the primary scan target */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Streams" value={formatAnalyticsNumber(totalStreams)} />
        <SummaryCard label="Views" value={formatAnalyticsNumber(totalViews)} />
        <SummaryCard
          label="Avg growth"
          value={<GrowthCell value={avgGrowth} />}
          meta={growingTracks > 0 || decliningTracks > 0 ? `↑ ${growingTracks} · ↓ ${decliningTracks}` : undefined}
        />
        <SummaryCard label="Catalog" value={String(rows.length)} meta="tracks" />
      </div>

      <SortableTable
        rows={rows}
        defaultSort="combinedStreams"
        rowKey={(r) => r.id}
        columns={[
          {
            key: "trackTitle",
            label: "Track",
            sortable: false,
            formatter: (r) => (
              <div className="min-w-0">
                <p className="text-sm leading-snug truncate" title={r.trackTitle}>{r.trackTitle}</p>
                {r.releaseTitle && (
                  <p className="text-xs text-[var(--muted-foreground)] truncate">{r.releaseTitle}</p>
                )}
              </div>
            ),
          },
          {
            key: "primaryArtist",
            label: "Artist",
            sortable: false,
            formatter: (r) => (
              <span className="text-sm text-[var(--muted-foreground)]">{r.primaryArtist ?? "—"}</span>
            ),
          },
          {
            key: "combinedStreams",
            label: "Streams",
            align: "right",
            formatter: (r) => (
              <span className="font-semibold tabular-nums">{formatAnalyticsNumber(r.combinedStreams)}</span>
            ),
          },
          {
            key: "streamsGrowth",
            label: "Growth",
            align: "right",
            formatter: (r) => <GrowthCell value={r.streamsGrowth} />,
          },
          {
            key: "spotifyStreams",
            label: "Spotify",
            align: "right",
            formatter: (r) => <span className="tabular-nums">{formatAnalyticsNumber(r.spotifyStreams)}</span>,
          },
          {
            key: "appleStreams",
            label: "Apple",
            align: "right",
            formatter: (r) => <span className="tabular-nums">{formatAnalyticsNumber(r.appleStreams)}</span>,
          },
          {
            key: "combinedViews",
            label: "Views",
            align: "right",
            formatter: (r) => <span className="tabular-nums">{formatAnalyticsNumber(r.combinedViews)}</span>,
          },
          {
            key: "viewsGrowth",
            label: "Views Δ",
            align: "right",
            formatter: (r) => <GrowthCell value={r.viewsGrowth} />,
          },
        ]}
      />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: React.ReactNode;
  meta?: string;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-1 text-2xl font-semibold leading-tight tabular-nums">
        {value}
      </div>
      {meta && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{meta}</p>}
    </div>
  );
}
