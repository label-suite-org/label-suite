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
import type {
  ArtistSisenseSection,
  SisenseCitySuperfansRow,
  SisenseDailyMetricPoint,
  SisenseDateWindow,
} from "../../server/analytics";
import { formatAnalyticsDate, formatAnalyticsNumber, formatAnalyticsPercent } from "./utils";

const SPOTIFY_COLOR = "var(--chart-3)";
const APPLE_COLOR = "var(--chart-4)";
const TOOLTIP_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  fontSize: "12px",
} as const;

interface Props {
  section: ArtistSisenseSection;
}

export default function ArtistSisensePanel({ section }: Props) {
  const { followersDaily, monthlyListenersDaily, superfansByCity, demographics, crossPlatformStreams } = section;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Sisense Audience</h2>
        <p className="text-xs text-muted-foreground">
          Sisense rows matched to this artist by name and import scope. Every figure states its own data window — nothing here is an all-time total.
        </p>
      </div>

      {followersDaily && (
        <DailyMetricCard
          title="Followers over time"
          windowLabel={`Daily · last 12 months · data covers ${windowText(followersDaily.window)}`}
          points={followersDaily.points}
          name="Followers"
          color="var(--chart-1)"
        />
      )}

      {monthlyListenersDaily && (
        <DailyMetricCard
          title="Monthly listeners (MAL) over time"
          windowLabel={`Daily · last 12 months · data covers ${windowText(monthlyListenersDaily.window)} · volatile, event-driven — spikes reflect releases and playlisting, not steady growth`}
          points={monthlyListenersDaily.points}
          name="Monthly listeners"
          color="var(--chart-5)"
        />
      )}

      {crossPlatformStreams && <CrossPlatformCard data={crossPlatformStreams} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {superfansByCity && <SuperfansByCityCard data={superfansByCity} />}
        {demographics && <DemographicsCard data={demographics} />}
      </div>
    </section>
  );
}

function DailyMetricCard({
  title,
  windowLabel,
  points,
  name,
  color,
}: {
  title: string;
  windowLabel: string;
  points: SisenseDailyMetricPoint[];
  name: string;
  color: string;
}) {
  return (
    <Card title={title} windowLabel={windowLabel}>
      <div className="h-64 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
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
              labelFormatter={(value) => formatAnalyticsDate(String(value))}
              formatter={(value) => [formatAnalyticsNumber(Number(value)), name]}
            />
            <Line type="monotone" dataKey="value" name={name} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CrossPlatformCard({ data }: { data: NonNullable<ArtistSisenseSection["crossPlatformStreams"]> }) {
  return (
    <Card
      title="Cross-platform streams"
      windowLabel={`Daily · data covers ${windowText(data.window)} (capped at last 12 months) · Spotify and Apple shown separately — never summed`}
    >
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Spotify · window total</p>
          <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: SPOTIFY_COLOR }}>
            {formatAnalyticsNumber(data.spotifyTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Apple · window total</p>
          <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: APPLE_COLOR }}>
            {formatAnalyticsNumber(data.appleTotal)}
          </p>
        </div>
      </div>
      <div className="h-64 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={data.points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
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
              labelFormatter={(value) => formatAnalyticsDate(String(value))}
              formatter={(value, name) => [formatAnalyticsNumber(Number(value)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="spotifyStreams"
              name="Spotify"
              stroke={SPOTIFY_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="appleStreams"
              name="Apple"
              stroke={APPLE_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SuperfansByCityCard({ data }: { data: NonNullable<ArtistSisenseSection["superfansByCity"]> }) {
  return (
    <Card
      title="Superfans by city — top 10"
      windowLabel={`Cumulative window total, not a daily snapshot · synced ${data.asOf ? formatAnalyticsDate(data.asOf) : "—"}`}
    >
      <div className="h-72 w-full" style={{ minWidth: 1, minHeight: 1 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <BarChart data={data.rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="city"
              width={130}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--muted)" }}
              formatter={(value, _name, item) => [
                `${formatAnalyticsNumber(Number(value))} superfans`,
                (item?.payload as SisenseCitySuperfansRow | undefined)?.country ?? "Superfans",
              ]}
            />
            <Bar dataKey="superfans" fill="var(--chart-2)" radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="superfans"
                position="right"
                fill="var(--muted-foreground)"
                fontSize={11}
                formatter={(value: unknown) => formatAnalyticsNumber(Number(value))}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DemographicsCard({ data }: { data: NonNullable<ArtistSisenseSection["demographics"]> }) {
  return (
    <Card
      title="Demographics — gender × age"
      windowLabel={`Streams per segment · cumulative window total · synced ${data.asOf ? formatAnalyticsDate(data.asOf) : "—"}`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-2 pr-3 text-left font-normal">Age</th>
              {data.genders.map((gender) => (
                <th key={gender} className="pb-2 pr-3 text-right font-normal capitalize">
                  {gender}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((row) => (
              <tr key={row.age}>
                <td className="py-2 pr-3 font-medium">{row.age}</td>
                {row.cells.map((cell) => (
                  <td key={cell.gender} className="py-2 pr-3 text-right tabular-nums align-top">
                    {cell.streams === null ? "—" : formatAnalyticsNumber(cell.streams)}
                    {cell.completionRate !== null && (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatAnalyticsPercent(cell.completionRate)} completion
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
