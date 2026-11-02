import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NativeMusicCatalogue } from "../../server/native-music-import";
import { groupNativeMusicDays, nativeMusicSongs, type MusicGrain } from "../../lib/native-music-history";

const format = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-US");
export default function NativeMusicHistory({ captures }: { captures: NativeMusicCatalogue[] }) {
  const daily = captures.filter(capture => capture.periodKind === "daily");
  const hasBothPlatforms = new Set(captures.map(capture => capture.provider)).size === 2;
  const first = daily.map(capture => capture.dateFrom!).sort()[0];
  const last = daily.map(capture => capture.dateThrough!).sort().at(-1);
  const recentFrom = last ? new Date(Date.parse(last) - 27 * 86_400_000).toISOString().slice(0, 10) : "";
  const [from, setFrom] = useState(first && first > recentFrom ? first : recentFrom);
  const [through, setThrough] = useState(last ?? "");
  const [grain, setGrain] = useState<MusicGrain>("day");
  const [provider, setProvider] = useState("");
  const [song, setSong] = useState("");
  const scoped = useMemo(() => captures.filter(capture => !provider || capture.provider === provider), [captures, provider]);
  const songs = useMemo(() => nativeMusicSongs(scoped), [scoped]);
  const result = useMemo(() => {
    if (!first || !last || !from || !through || from > through) return null;
    const days = (Date.parse(through) - Date.parse(from)) / 86_400_000;
    if (!Number.isFinite(days) || days < 0 || days > 10000) return null;
    return groupNativeMusicDays(scoped, { from, through, grain, song: song || undefined });
  }, [scoped, first, last, from, through, grain, song]);
  if (!daily.length) return null;
  return <section className="space-y-4 rounded-lg border p-5" aria-label="Song history">
    <h2 className="text-2xl font-semibold">Song history</h2>
    <p className="text-sm text-muted-foreground">Daily observations from Spotify and Apple. Weeks start Monday; months and years follow the calendar in UTC. Missing observations remain gaps.</p>
    <p className="text-sm text-muted-foreground">Captured dates: {first}–{last}. Coverage differs by song and platform.</p>
    <div className="flex flex-wrap gap-3">
      <label>Platform <select value={provider} onChange={event => { setProvider(event.target.value); setSong(""); }} className="rounded border bg-transparent p-2">
        <option value="">{hasBothPlatforms ? "Spotify + Apple" : "Available platforms"}</option><option value="spotify_for_artists">Spotify</option><option value="apple_music_for_artists">Apple Music</option>
      </select></label>
      <label>Song <select value={song} onChange={event => setSong(event.target.value)} className="max-w-full rounded border bg-transparent p-2">
        <option value="">All songs</option>{songs.map(item => <option key={item.key} value={item.key}>{item.title} · {item.provider === "spotify_for_artists" ? "Spotify" : "Apple"}</option>)}
      </select></label>
      <label>Group by <select value={grain} onChange={event => setGrain(event.target.value as MusicGrain)} className="rounded border bg-transparent p-2">
        <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option>
      </select></label>
      <label>From <input type="date" value={from} min={first} max={last} onChange={event => setFrom(event.target.value)} className="rounded border bg-transparent p-2" /></label>
      <label>Through <input type="date" value={through} min={first} max={last} onChange={event => setThrough(event.target.value)} className="rounded border bg-transparent p-2" /></label>
    </div>
    {result ? <>
      <p className="text-3xl font-semibold tabular-nums">{format(result.total)}</p>
      <p className="text-sm">{result.completeSongs} of {result.songs.length} song histories cover every selected day. {result.total === null ? "A combined total needs complete coverage for the selected songs." : "Total plays across the selected songs and platforms."}</p>
      <div className="h-64" aria-label="Plays over time">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={result.points}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="from" /><YAxis /><Tooltip />
          <Line type="linear" dataKey="value" name="Plays" stroke="currentColor" dot={false} connectNulls={false} />
        </LineChart></ResponsiveContainer>
      </div>
      <details><summary className="cursor-pointer font-medium">Daily, weekly and monthly values</summary>
        <table className="w-full text-sm"><thead><tr><th className="text-left">Period</th><th className="text-right">Plays</th><th className="text-right">Observed song-days</th></tr></thead>
          <tbody>{result.points.map(point => <tr key={point.from} className="border-t"><th className="py-2 text-left font-normal">{point.from}{point.through !== point.from ? ` – ${point.through}` : ""}</th><td className="text-right">{format(point.value)}</td><td className="text-right">{point.knownCells}/{point.expectedCells}</td></tr>)}</tbody>
        </table>
      </details>
      <table className="w-full text-sm"><thead><tr><th className="text-left">Song</th><th className="text-left">Platform</th><th className="text-right">Selected period</th></tr></thead>
        <tbody>{[...result.songs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).map(item => <tr key={item.key} className="border-t"><th className="py-2 text-left font-normal">{item.title}</th><td>{item.provider === "spotify_for_artists" ? "Spotify" : "Apple"}</td><td className="text-right tabular-nums">{format(item.value)}</td></tr>)}</tbody>
      </table>
    </> : <p role="status">Choose a valid date range.</p>}
  </section>;
}
