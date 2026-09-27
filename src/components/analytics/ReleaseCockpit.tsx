"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  ReleaseCockpit,
  ReleaseCockpitPeriodSummary,
  ReleaseCockpitTrackRow,
  ReleaseCockpitPlaylistRow,
  ReleaseCockpitShazamRow,
} from "../../server/analytics-command-center-core";
import { analyticsGrowthClass, formatAnalyticsPercent } from "./utils";

import { Button } from "@/components/ui/button";
interface Props {
  cockpit: ReleaseCockpit;
}

export default function ReleaseCockpitView({ cockpit }: Props) {
  const [periodKey, setPeriodKey] = useState(cockpit.defaultPeriod);
  const selectedPeriod = useMemo(
    () => cockpit.periods.find((period) => period.key === periodKey) ?? cockpit.periods[0],
    [cockpit.periods, periodKey],
  );

  return (
    <section className="space-y-8">
      {/* Hero KPI strip */}
      <div className="space-y-7 border-b border-[var(--border)] pb-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Release cockpit</p>
            <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight">{cockpit.releaseTitle}</h1>
            <p className="mt-3 text-sm md:text-base text-[var(--muted-foreground)]">
              {cockpit.artistName ?? "—"} · {cockpit.format ?? "—"} · {cockpit.releaseDate ?? "No date"} · {cockpit.trackCount} tracks
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {cockpit.periods.map((period) => (
              <Button
                key={period.key}
                type="button"
                onClick={() => setPeriodKey(period.key)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  selectedPeriod.key === period.key
                    ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                    : "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {period.key === "all" ? "All" : period.key.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <HeroMetric
            label="Period streams"
            value={formatNumber(selectedPeriod.streamTotal)}
            delta={selectedPeriod.changePct}
            meta={periodWindow(selectedPeriod)}
            strong
          />
          <HeroMetric label="Tracks" value={formatNumber(cockpit.trackCount)} meta="On this release" />
          <HeroMetric label="Top track" value={cockpit.leaderboard[0]?.trackTitle ?? "—"} delta={cockpit.leaderboard[0]?.streamsGrowth ?? null} meta={cockpit.leaderboard[0] ? `${formatNumber(cockpit.leaderboard[0].combinedStreams)} streams` : "No data"} />
          <HeroMetric label="Top city" value={selectedPeriod.topCity?.city ?? "—"} meta={selectedPeriod.topCity ? `${formatNumber(selectedPeriod.topCity.streams)} streams` : "No city data"} />
          <HeroMetric label="Top source" value={selectedPeriod.topSource ? `${titleCase(selectedPeriod.topSource.platform)} · ${selectedPeriod.topSource.source}` : "—"} meta={selectedPeriod.topSource ? `${formatAnalyticsPercent(selectedPeriod.topSource.sharePct)} share` : "No source data"} />
        </div>
      </div>

      {/* Insight cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {selectedPeriod.insights.map((insight) => <InsightCard key={insight.label} insight={insight} />)}
      </div>

      {/* Daily trend + Source mix */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <Panel title="Daily streams trend" eyebrow={periodWindow(selectedPeriod)} description="Spotify and Apple combined for this release.">
          <TrendChart period={selectedPeriod} />
        </Panel>
        <Panel title="Source mix" eyebrow="Channel split" description="Where this release's streams come from.">
          <SourceMix rows={selectedPeriod.topSources} total={selectedPeriod.streamTotal} />
        </Panel>
      </div>

      {/* Track leaderboard + Top cities + Playlists */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Track leaderboard" eyebrow="Performance ranking" description="All tracks on this release ranked by streams.">
          <TrackLeaderboard rows={cockpit.leaderboard} />
        </Panel>
        <Panel title="Top cities" eyebrow="Geo performance" description="Cities with strongest stream concentration for this release.">
          <CityList rows={selectedPeriod.topCities.slice(0, 8)} />
        </Panel>
        <Panel title="Top playlists" eyebrow={`${cockpit.topPlaylistCount} total`} description="Playlists driving this release.">
          <PlaylistList rows={cockpit.topPlaylists.slice(0, 8)} />
        </Panel>
      </div>

      {/* Shazam signals */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Shazam signals" eyebrow="Offline/curiosity demand" description="Cities where people are actively identifying these tracks.">
          <ShazamList rows={cockpit.shazams} />
        </Panel>
        <Panel title="Data window" eyebrow="Freshness" description="When this data was last seen.">
          <div className="space-y-3 text-sm">
            <MiniStat label="Data from" value={cockpit.dataWindow.from ? formatDate(cockpit.dataWindow.from) : "—"} />
            <MiniStat label="Data to" value={cockpit.dataWindow.to ? formatDate(cockpit.dataWindow.to) : "—"} />
            <MiniStat label="Playlists found" value={formatNumber(cockpit.topPlaylistCount)} />
            <MiniStat label="Cities found" value={formatNumber(selectedPeriod.topCities.length)} />
          </div>
        </Panel>
      </div>
    </section>
  );
}

function HeroMetric({
  label, value, delta, meta, strong = false,
}: { label: string; value: string; delta?: number | null; meta?: string; strong?: boolean }) {
  return (
    <div className="bg-muted/18 p-4">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-2 truncate font-semibold tracking-tight ${strong ? "text-3xl" : "text-xl"}`} title={value}>{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && delta !== null && (
          <span className={`font-semibold ${analyticsGrowthClass(delta)}`}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "·"} {formatAnalyticsPercent(Math.abs(delta))}</span>
        )}
        {meta && <span className="text-[var(--muted-foreground)] truncate">{meta}</span>}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: ReleaseCockpitPeriodSummary["insights"][number] }) {
  const toneClass = insight.tone === "good"
    ? "bg-emerald-50/55 text-emerald-950 dark:bg-emerald-950/18 dark:text-emerald-100"
    : insight.tone === "watch"
      ? "bg-amber-50/55 text-amber-950 dark:bg-amber-950/18 dark:text-amber-100"
      : "bg-muted/18 text-[var(--foreground)]";
  return (
    <article className={`p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.16em] opacity-70">{insight.label}</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-tight">{insight.title}</h3>
        <span className="shrink-0 bg-white/60 px-2 py-1 text-sm font-semibold tabular-nums dark:bg-black/20">{insight.metric}</span>
      </div>
      <p className="mt-3 text-sm opacity-80">{insight.detail}</p>
      <p className="mt-4 text-sm font-medium">→ {insight.action}</p>
    </article>
  );
}

function Panel({ title, eyebrow, description, children }: { title: string; eyebrow: string; description: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-5">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function TrendChart({ period }: { period: ReleaseCockpitPeriodSummary }) {
  const max = Math.max(...period.dailyTrend.map((point) => point.total), 1);
  const sampled = period.dailyTrend.length > 70
    ? period.dailyTrend.filter((_, i) => i % Math.ceil(period.dailyTrend.length / 70) === 0)
    : period.dailyTrend;
  if (!sampled.length) return <Empty>No trend rows for this period.</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex h-64 items-end gap-1 border-b border-l border-[var(--border)] px-2 pt-6">
        {sampled.map((point) => (
          <div key={point.date} className="group relative flex min-w-0 flex-1 items-end justify-center">
            <div
              className="w-full rounded-t bg-[var(--foreground)]/75 transition group-hover:bg-[var(--foreground)]"
              style={{ height: `${Math.max((point.total / max) * 100, 2)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--popover,var(--card))] px-2 py-1 text-xs shadow group-hover:block whitespace-nowrap">
              {point.date}: {formatNumber(point.total)} streams
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <MiniStat label="Avg/day" value={formatNumber(Math.round(period.streamTotal / Math.max(period.dailyTrend.length, 1)))} />
        <MiniStat label="Best day" value={formatNumber(Math.max(...period.dailyTrend.map((p) => p.total), 0))} />
        <MiniStat label="Days" value={formatNumber(period.dailyTrend.length)} />
      </div>
    </div>
  );
}

function SourceMix({ rows, total }: { rows: { source: string; platform: string; streams: number; sharePct: number }[]; total: number }) {
  if (!rows.length) return <Empty>No source rows for this period.</Empty>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((row) => (
        <div key={`${row.platform}-${row.source}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate"><span className="text-[var(--muted-foreground)]">{titleCase(row.platform)}</span> · {row.source}</span>
            <span className="font-semibold tabular-nums">{formatNumber(row.streams)}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--muted)]">
            <div className="h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(total ? (row.streams / total) * 100 : 0, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrackLeaderboard({ rows }: { rows: ReleaseCockpitTrackRow[] }) {
  if (!rows.length) return <Empty>No track data.</Empty>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={row.trackTitle}>
              {row.position !== null && <span className="text-[var(--muted-foreground)] mr-2">{row.position}.</span>}
              {row.trackTitle}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">{formatNumber(row.combinedStreams)} streams</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">{formatNumber(row.combinedStreams)}</p>
            <p className={`text-xs font-medium ${analyticsGrowthClass(row.streamsGrowth)}`}>
              {row.streamsGrowth === null ? "—" : `${row.streamsGrowth >= 0 ? "+" : ""}${formatAnalyticsPercent(row.streamsGrowth)}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CityList({ rows }: { rows: { city: string; streams: number }[] }) {
  if (!rows.length) return <Empty>No city data.</Empty>;
  const max = Math.max(...rows.map((r) => r.streams), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.city}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate" title={row.city}>{row.city}</span>
            <span className="font-semibold tabular-nums">{formatNumber(row.streams)}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--muted)]">
            <div className="h-2 rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.max((row.streams / max) * 100, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaylistList({ rows }: { rows: ReleaseCockpitPlaylistRow[] }) {
  if (!rows.length) return <Empty>No playlist data.</Empty>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.playlistName} className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={row.playlistName}>{row.playlistName}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{row.ownerId ?? "unknown owner"}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">{formatNumber(row.streams)}</p>
            <p className="text-xs text-[var(--muted-foreground)]">pos {row.latestPosition ?? "—"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShazamList({ rows }: { rows: ReleaseCockpitShazamRow[] }) {
  if (!rows.length) return <Empty>No Shazam data.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.city} className="rounded-2xl border border-[var(--border)] p-3">
          <p className="truncate text-sm font-medium" title={row.city}>{row.city}</p>
          {row.trackTitle && <p className="text-xs text-[var(--muted-foreground)]">{row.trackTitle}</p>}
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(row.shazams)}</p>
          <p className="text-xs text-[var(--muted-foreground)]">Shazams</p>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)]/60 p-3">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">{children}</p>;
}

function periodWindow(period: ReleaseCockpitPeriodSummary): string {
  if (!period.from || !period.to) return period.label;
  return `${period.label} · ${formatDate(period.from)}–${formatDate(period.to)}`;
}

function formatDate(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return value.slice(0, 10);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
