import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReleaseSisenseSection, SisenseDateWindow, SisenseSourceShareRow } from "../../server/analytics";
import { formatAnalyticsDate, formatAnalyticsNumber } from "./utils";

const SPOTIFY_COLOR = "var(--chart-3)";
const APPLE_COLOR = "var(--chart-4)";
const TOOLTIP_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  fontSize: "12px",
} as const;

interface Props {
  section: ReleaseSisenseSection;
}

export default function ReleaseSisensePanel({ section }: Props) {
  const { weeklyStreams, topCountries, sourceMix, superfanReach } = section;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Sisense Streaming</h2>
        <p className="text-xs text-muted-foreground">
          Recording-level Sisense exports matched by ISRC. Every figure states its own data window — nothing here is an all-time total.
        </p>
      </div>

      {weeklyStreams && <WeeklyStreamsCard data={weeklyStreams} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {topCountries && <TopCountriesCard data={topCountries} />}
        {superfanReach && <SuperfanReachCard data={superfanReach} />}
      </div>

      {sourceMix && <SourceMixCard data={sourceMix} />}
    </section>
  );
}

function WeeklyStreamsCard({ data }: { data: NonNullable<ReleaseSisenseSection["weeklyStreams"]> }) {
  return (
    <Card
      title="Streams per week"
      windowLabel={`Last 12 weeks · data covers ${windowText(data.window)} · Spotify and Apple plotted separately, never summed`}
    >
      <div className="h-64 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={data.points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="weekStart"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: string) => formatAnalyticsDate(value)}
            />
            <YAxis
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              width={56}
              tickFormatter={(value: number) => formatAnalyticsNumber(value)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(value) => `Week of ${formatAnalyticsDate(String(value))}`}
              formatter={(value, name) => [formatAnalyticsNumber(Number(value)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="spotifyStreams"
              name="Spotify"
              stroke={SPOTIFY_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="appleStreams"
              name="Apple"
              stroke={APPLE_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function TopCountriesCard({ data }: { data: NonNullable<ReleaseSisenseSection["topCountries"]> }) {
  return (
    <Card
      title="Top 5 countries"
      windowLabel={`Share of ${formatAnalyticsNumber(data.totalStreams)} window-total streams (cumulative window, not all-time) · synced ${data.asOf ? formatAnalyticsDate(data.asOf) : "—"}`}
    >
      <div className="h-56 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <BarChart data={data.rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="country"
              width={130}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--muted)" }}
              formatter={(value) => [`${formatAnalyticsNumber(Number(value))} streams`, "Streams"]}
            />
            <Bar dataKey="streams" fill="var(--chart-2)" radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="sharePct"
                position="right"
                fill="var(--muted-foreground)"
                fontSize={11}
                formatter={(value: unknown) => `${Number(value).toFixed(1)}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SuperfanReachCard({ data }: { data: NonNullable<ReleaseSisenseSection["superfanReach"]> }) {
  return (
    <Card
      title="Superfan reach"
      windowLabel={`Cumulative window total — not a daily snapshot · synced ${data.asOf ? formatAnalyticsDate(data.asOf) : "—"}`}
    >
      <div className="flex items-baseline gap-3">
        <p className="text-4xl font-semibold tabular-nums">{formatAnalyticsNumber(data.superfans)}</p>
        <p className="text-sm text-muted-foreground">
          Spotify superfans across {formatAnalyticsNumber(data.cityCount)} cities
        </p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Accumulated over the reporting window — do not read as a per-day count.
      </p>
    </Card>
  );
}

function SourceMixCard({ data }: { data: NonNullable<ReleaseSisenseSection["sourceMix"]> }) {
  return (
    <Card
      title="Source mix"
      windowLabel="How streams arrived (playlist, search, library, algorithmic …) · Spotify and Apple listed separately, never summed"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <SourceShareList
          title={`Spotify · ${windowText(data.spotifyWindow)}`}
          rows={data.spotify}
          barColor={SPOTIFY_COLOR}
        />
        <SourceShareList
          title={`Apple · ${windowText(data.appleWindow)}`}
          rows={data.apple}
          barColor={APPLE_COLOR}
        />
      </div>
    </Card>
  );
}

function SourceShareList({
  title,
  rows,
  barColor,
}: {
  title: string;
  rows: SisenseSourceShareRow[];
  barColor: string;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-sm font-medium mb-3">{title}</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.source} className="flex items-center gap-3">
            <span className="w-28 truncate text-sm" title={row.source}>
              {prettySource(row.source)}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(row.sharePct, 2)}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="w-20 text-right text-sm tabular-nums font-semibold">
              {formatAnalyticsNumber(row.streams)}
            </span>
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
              {row.sharePct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, windowLabel, children }: { title: string; windowLabel: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{windowLabel}</p>
      </div>
      {children}
    </div>
  );
}

function windowText(window: SisenseDateWindow): string {
  if (!window.from || !window.to) return "no dated rows";
  if (window.from === window.to) return formatAnalyticsDate(window.from);
  return `${formatAnalyticsDate(window.from)} – ${formatAnalyticsDate(window.to)}`;
}

function prettySource(source: string): string {
  return source.toLowerCase().replace(/_/g, " ");
}
