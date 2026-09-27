export type AnalyticsPlatform = "spotify" | "apple";

export interface AnalyticsCommandFilter {
  artistId?: string;
  releaseId?: string;
  platforms?: AnalyticsPlatform[];
}

export function normalizeAnalyticsFilter(
  filter: AnalyticsCommandFilter | undefined,
  availableReleaseIds: readonly string[],
): AnalyticsCommandFilter | undefined {
  if (!filter?.artistId || !filter.releaseId || availableReleaseIds.includes(filter.releaseId)) {
    return filter;
  }

  return { ...filter, releaseId: undefined };
}

export interface FilterOption {
  id: string;
  label: string;
}

export type AnalyticsPeriodKey = "7d" | "30d" | "90d" | "all";

export interface CommandDailySourceRow {
  date: string | Date;
  platform: string | null;
  source: string | null;
  streams: number | string | null;
}

export interface CommandTrackRow {
  id: string;
  trackTitle: string;
  primaryArtist: string | null;
  combinedStreams: number;
  spotifyStreams: number;
  appleStreams: number;
  streamsGrowth: number | null;
  combinedViews: number;
  viewsGrowth: number | null;
}

export interface CommandCityRow {
  city: string;
  streams: number;
  listeners: number | null;
  trackCount: number;
}

export interface CommandPlaylistRow {
  id: string;
  label: string;
  metrics: Record<string, number | null>;
  dimensions: Record<string, string | null>;
  lastSeenAt: Date | string | null;
}

export interface CommandShazamRow {
  id: string;
  label: string;
  metrics: Record<string, number | null>;
  dimensions: Record<string, string | null>;
  lastSeenAt: Date | string | null;
}

export interface CommandWidgetSummary {
  widgetKey: string;
  rowCount: number;
  trackCount: number;
  lastSeenAt: Date | string | null;
}

export interface CommandRunRow {
  status: string;
  completedAt: Date | string | null;
  rowsImported: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  filesDownloaded: number;
  error: string | null;
}

export interface BuildAnalyticsCommandCenterInput {
  dailySources: CommandDailySourceRow[];
  tracks: CommandTrackRow[];
  cities: CommandCityRow[];
  playlists: CommandPlaylistRow[];
  shazams: CommandShazamRow[];
  widgets: CommandWidgetSummary[];
  runHistory: CommandRunRow[];
  totalRows: number;
  totalWidgets: number;
  totalLinkedTracks: number;
  lastSeenAt: Date | string | null;
  filter?: AnalyticsCommandFilter;
  availableArtists?: FilterOption[];
  availableReleases?: FilterOption[];
}

export interface AnalyticsTrendPoint {
  date: string;
  spotify: number;
  apple: number;
  total: number;
  cumulative: number;
}

export interface AnalyticsTrendState {
  kind: "valid" | "empty" | "invalid" | "insufficient";
  points: number;
  invalidRows: number;
  totalRows: number;
}

export interface AnalyticsSourceMixRow {
  source: string;
  platform: string;
  streams: number;
  sharePct: number;
}

export interface AnalyticsInsightCard {
  label: string;
  title: string;
  metric: string;
  detail: string;
  action: string;
  tone: "good" | "watch" | "neutral";
}

/** The dashboard must reserve a visible slot for import-health intervention. */
export function selectDashboardAnalyticsCards<T extends { key: string }>(cards: readonly T[], limit = 3): T[] {
  if (limit <= 0) return [];
  const dataHealth = cards.find((card) => card.key === "analytics-data-health");
  if (!dataHealth) return cards.slice(0, limit);
  return [...cards.filter((card) => card.key !== "analytics-data-health").slice(0, limit - 1), dataHealth];
}

export interface AnalyticsCommandPeriodSummary {
  key: AnalyticsPeriodKey;
  label: string;
  from: string | null;
  to: string | null;
  streamTotal: number;
  previousStreamTotal: number | null;
  changePct: number | null;
  trendState: AnalyticsTrendState;
  dailyTrend: AnalyticsTrendPoint[];
  topSources: AnalyticsSourceMixRow[];
  topSource: AnalyticsSourceMixRow | null;
  insights: AnalyticsInsightCard[];
}

export interface AnalyticsCommandCenter {
  defaultPeriod: AnalyticsPeriodKey;
  dataWindow: { from: string | null; to: string | null };
  periods: AnalyticsCommandPeriodSummary[];
  catalog: {
    totalStreams: number;
    spotifyStreams: number;
    appleStreams: number;
    views: number;
    trackCount: number;
    growingTracks: number;
    decliningTracks: number;
    avgGrowth: number | null;
    topTracks: CommandTrackRow[];
    topMover: CommandTrackRow | null;
  };
  markets: {
    topCities: CommandCityRow[];
    topCity: CommandCityRow | null;
    shazams: CommandShazamRow[];
    topShazam: CommandShazamRow | null;
  };
  playlists: {
    rows: CommandPlaylistRow[];
    totalStreams: number;
    topPlaylist: CommandPlaylistRow | null;
  };
  dataHealth: {
    totalRows: number;
    totalWidgets: number;
    totalLinkedTracks: number;
    lastSeenAt: string | null;
    latestRunStatus: string | null;
    latestRunCompletedAt: string | null;
    widgetRows: CommandWidgetSummary[];
  };
  availableArtists: FilterOption[];
  availableReleases: FilterOption[];
  activeFilters: AnalyticsCommandFilter;
}

const PERIODS: Array<{ key: AnalyticsPeriodKey; label: string; days: number | null }> = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "all", label: "All CSV history", days: null },
];

export function buildAnalyticsCommandCenter(input: BuildAnalyticsCommandCenterInput): AnalyticsCommandCenter {
  const dailyRows = normalizeDailyRows(input.dailySources);
  const datedRows = dailyRows.filter(hasDate);
  const allDates = [...new Set(datedRows.map((row) => row.date))].sort();
  const windowFrom = allDates[0] ?? null;
  const windowTo = allDates[allDates.length - 1] ?? null;

  const periods = PERIODS.map((period) => buildPeriod(period, dailyRows, windowFrom, windowTo, input));
  const tracks = [...input.tracks].sort((a, b) => b.combinedStreams - a.combinedStreams);
  const growthValues = tracks.map((track) => track.streamsGrowth).filter((value): value is number => value !== null);
  const totalStreams = tracks.reduce((sum, track) => sum + safeNumber(track.combinedStreams), 0);
  const topMover = [...tracks]
    .filter((track) => track.streamsGrowth !== null && track.combinedStreams >= 500)
    .sort((a, b) => (b.streamsGrowth ?? -Infinity) - (a.streamsGrowth ?? -Infinity))[0] ?? null;

  const topCities = input.cities
    .filter(isActionableCity)
    .sort((a, b) => b.streams - a.streams)
    .slice(0, 12);
  const playlists = [...input.playlists]
    .sort((a, b) => safeNumber(b.metrics.streams) - safeNumber(a.metrics.streams))
    .slice(0, 12);
  const shazams = [...input.shazams]
    .sort((a, b) => safeNumber(b.metrics.shazams) - safeNumber(a.metrics.shazams))
    .slice(0, 8);
  const latestRun = [...input.runHistory]
    .sort((a, b) => timestamp(b.completedAt) - timestamp(a.completedAt))[0] ?? null;

  return {
    defaultPeriod: "30d",
    dataWindow: { from: windowFrom, to: windowTo },
    periods,
    catalog: {
      totalStreams,
      spotifyStreams: tracks.reduce((sum, track) => sum + safeNumber(track.spotifyStreams), 0),
      appleStreams: tracks.reduce((sum, track) => sum + safeNumber(track.appleStreams), 0),
      views: tracks.reduce((sum, track) => sum + safeNumber(track.combinedViews), 0),
      trackCount: tracks.length,
      growingTracks: growthValues.filter((value) => value > 0).length,
      decliningTracks: growthValues.filter((value) => value < 0).length,
      avgGrowth: growthValues.length ? growthValues.reduce((sum, value) => sum + value, 0) / growthValues.length : null,
      topTracks: tracks.slice(0, 10),
      topMover,
    },
    markets: {
      topCities,
      topCity: topCities[0] ?? null,
      shazams,
      topShazam: shazams[0] ?? null,
    },
    playlists: {
      rows: playlists,
      totalStreams: playlists.reduce((sum, row) => sum + safeNumber(row.metrics.streams), 0),
      topPlaylist: playlists[0] ?? null,
    },
    dataHealth: {
      totalRows: input.totalRows,
      totalWidgets: input.totalWidgets,
      totalLinkedTracks: input.totalLinkedTracks,
      lastSeenAt: isoDateOrNull(input.lastSeenAt),
      latestRunStatus: latestRun?.status ?? null,
      latestRunCompletedAt: isoDateOrNull(latestRun?.completedAt ?? null),
      widgetRows: [...input.widgets].sort((a, b) => b.rowCount - a.rowCount),
    },
    availableArtists: input.availableArtists ?? [],
    availableReleases: input.availableReleases ?? [],
    activeFilters: input.filter ?? {},
  };
}

function buildPeriod(
  period: { key: AnalyticsPeriodKey; label: string; days: number | null },
  rows: NormalizedDailySourceRow[],
  windowFrom: string | null,
  windowTo: string | null,
  input: BuildAnalyticsCommandCenterInput,
): AnalyticsCommandPeriodSummary {
  if (!windowTo) {
    const totalRows = rows.length;
    return {
      key: period.key,
      label: period.label,
      from: null,
      to: null,
      streamTotal: 0,
      previousStreamTotal: null,
      changePct: null,
      trendState: totalRows > 0
        ? { kind: "invalid", points: 0, invalidRows: totalRows, totalRows }
        : { kind: "empty", points: 0, invalidRows: 0, totalRows: 0 },
      dailyTrend: [],
      topSources: [],
      topSource: null,
      insights: [],
    };
  }

  const to = windowTo;
  const from = period.days === null ? windowFrom : shiftIsoDate(to, -(period.days - 1));
  const selectedRows = rows.filter((row): row is NormalizedDailySourceRow & { date: string } => {
    if (!row.date) return false;
    return (!from || row.date >= from) && row.date <= to;
  });
  const selectedValidRows = selectedRows.filter((row) => row.isValid);
  const streamTotal = selectedValidRows.reduce((sum, row) => sum + row.streams, 0);

  let previousStreamTotal: number | null = null;
  if (period.days !== null && from) {
    const previousTo = shiftIsoDate(from, -1);
    const previousFrom = shiftIsoDate(previousTo, -(period.days - 1));
    previousStreamTotal = rows
      .filter((row): row is NormalizedDailySourceRow & { date: string } => row.isValid && Boolean(row.date))
      .filter((row) => row.date >= previousFrom && row.date <= previousTo)
      .reduce((sum, row) => sum + row.streams, 0);
  }

  const sourceMap = new Map<string, AnalyticsSourceMixRow>();
  for (const row of selectedValidRows) {
    const key = `${row.platform}\u0000${row.source}`;
    const existing = sourceMap.get(key) ?? { source: row.source, platform: row.platform, streams: 0, sharePct: 0 };
    existing.streams += row.streams;
    sourceMap.set(key, existing);
  }
  const topSources = [...sourceMap.values()]
    .sort((a, b) => b.streams - a.streams)
    .slice(0, 10)
    .map((row) => ({ ...row, sharePct: streamTotal > 0 ? row.streams / streamTotal : 0 }));

  const dailyTrend = buildDailyTrend(selectedValidRows);
  const trendState = buildTrendState(dailyTrend.length, selectedRows.length - selectedValidRows.length, selectedRows.length);
  const topSource = topSources[0] ?? null;

  return {
    key: period.key,
    label: period.label,
    from: period.key === "all" ? windowFrom : from,
    to,
    streamTotal,
    trendState,
    previousStreamTotal,
    changePct: previousStreamTotal && previousStreamTotal > 0 ? (streamTotal - previousStreamTotal) / previousStreamTotal : null,
    dailyTrend,
    topSources,
    topSource,
    insights: buildInsights({ streamTotal, previousStreamTotal, topSource, input }),
  };
}

function buildDailyTrend(rows: NormalizedDailySourceRow[]): AnalyticsTrendPoint[] {
  const byDate = new Map<string, AnalyticsTrendPoint>();
  for (const row of rows.filter(hasDate)) {
    const point = byDate.get(row.date) ?? { date: row.date, spotify: 0, apple: 0, total: 0, cumulative: 0 };
    if (row.platform === "apple") point.apple += row.streams;
    else point.spotify += row.streams;
    point.total += row.streams;
    byDate.set(row.date, point);
  }
  let cumulative = 0;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((point) => {
    cumulative += point.total;
    return { ...point, cumulative };
  });
}

function buildInsights({
  streamTotal,
  previousStreamTotal,
  topSource,
  input,
}: {
  streamTotal: number;
  previousStreamTotal: number | null;
  topSource: AnalyticsSourceMixRow | null;
  input: BuildAnalyticsCommandCenterInput;
}): AnalyticsInsightCard[] {
  const topMover = [...input.tracks]
    .filter((track) => track.streamsGrowth !== null && track.combinedStreams >= 500)
    .sort((a, b) => (b.streamsGrowth ?? -Infinity) - (a.streamsGrowth ?? -Infinity))[0] ?? null;
  const topCity = input.cities.filter(isActionableCity).sort((a, b) => b.streams - a.streams)[0] ?? null;
  const topPlaylist = [...input.playlists].sort((a, b) => safeNumber(b.metrics.streams) - safeNumber(a.metrics.streams))[0] ?? null;
  const changePct = previousStreamTotal && previousStreamTotal > 0 ? (streamTotal - previousStreamTotal) / previousStreamTotal : null;

  return [
    {
      label: "Momentum",
      title: changePct === null ? "Period comparison pending" : changePct >= 0 ? "Streams are up" : "Streams are down",
      metric: changePct === null ? "—" : signedPercent(changePct),
      detail: previousStreamTotal === null ? "Need an earlier comparable period for a clean delta." : `${formatCompact(streamTotal)} streams vs ${formatCompact(previousStreamTotal)} before.`,
      action: changePct !== null && changePct < 0 ? "Check source mix and playlist drop-offs before spending." : "Use this as the headline KPI for the week.",
      tone: changePct === null ? "neutral" : changePct >= 0 ? "good" : "watch",
    },
    {
      label: "Catalogue mover",
      title: topMover?.trackTitle ?? "No clear mover yet",
      metric: topMover?.streamsGrowth === null || !topMover ? "—" : signedPercent(topMover.streamsGrowth),
      detail: topMover ? `${topMover.primaryArtist ?? "Unknown artist"} · ${formatCompact(topMover.combinedStreams)} cumulative streams.` : "Import growth fields or period track rows to rank movers.",
      action: topMover ? "Decide if this deserves content, pitch, or ad support." : "Connect growth data before prioritising tracks.",
      tone: topMover && (topMover.streamsGrowth ?? 0) > 0 ? "good" : "neutral",
    },
    {
      label: "Market",
      title: topCity?.city ?? "No market signal yet",
      metric: topCity ? formatCompact(topCity.streams) : "—",
      detail: topCity ? `${topCity.listeners ? `${formatCompact(topCity.listeners)} superfans · ` : ""}highest city stream concentration.` : "No city data imported.",
      action: topCity ? "Use this for geo-targeting, PR angles, and routing fan outreach." : "Import city/superfan data.",
      tone: "neutral",
    },
    {
      label: "Discovery channel",
      title: topSource ? `${titleCase(topSource.platform)} · ${topSource.source}` : topPlaylist?.label ?? "No channel signal yet",
      metric: topSource ? formatCompact(topSource.streams) : topPlaylist ? formatCompact(safeNumber(topPlaylist.metrics.streams)) : "—",
      detail: topSource ? `${formatPercent(topSource.sharePct)} of selected-period source streams.` : topPlaylist ? "Top playlist by stream contribution." : "No source or playlist rows imported.",
      action: topSource?.source.toLowerCase().includes("radio") ? "Lean into algorithmic/radio compounding; watch saves and completion." : "Use this to separate algorithmic lift from owned/playlist lift.",
      tone: "neutral",
    },
  ];
}

function isActionableCity(row: CommandCityRow): boolean {
  const city = row.city.trim().toLowerCase();
  return city !== "" && city !== "unknown";
}

interface NormalizedDailySourceRow {
  date: string | null;
  platform: string;
  source: string;
  streams: number;
  isValid: boolean;
}

function normalizeDailyRows(rows: CommandDailySourceRow[]): NormalizedDailySourceRow[] {
  return rows
    .map((row) => ({
      date: isoDateOnly(row.date) || null,
      platform: (row.platform || "unknown").toLowerCase(),
      source: row.source || "Unknown",
      streams: safeNumber(row.streams),
      isValid: row.streams !== null && String(row.streams).trim() !== "" && Number.isFinite(Number(row.streams)) && Number(row.streams) >= 0 && Boolean(isoDateOnly(row.date)),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function hasDate(row: NormalizedDailySourceRow): row is NormalizedDailySourceRow & { date: string } {
  return Boolean(row.date);
}

function buildTrendState(points: number, invalidRows: number, totalRows: number): AnalyticsTrendState {
  if (totalRows === 0) {
    return { kind: "empty", points: 0, invalidRows: 0, totalRows: 0 };
  }

  if (points === 0) {
    return { kind: "invalid", points: 0, invalidRows, totalRows };
  }

  if (points < 2) {
    return { kind: "insufficient", points, invalidRows, totalRows };
  }

  return { kind: "valid", points, invalidRows, totalRows };
}

function isoDateOnly(value: string | Date | null): string {
  const date = isoDateOrNull(value);
  return date ? date.slice(0, 10) : "";
}

function isoDateOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const day = raw.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? null : day;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function shiftIsoDate(date: string, days: number): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function safeNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function timestamp(value: Date | string | null): number {
  if (!value) return 0;
  const n = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}


// ═══════════════════════════════════════════════════════════════════════════
// Artist 360 types (auto-reconstructed)
// ═══════════════════════════════════════════════════════════════════════════

export interface Artist360DataWindow {
  from: string | null;
  to: string | null;
}

export interface Artist360Hero {
  name: string;
  releaseCount: number;
  trackCount: number;
  totalStreams: number;
  topCity: string | null;
  topSource: string | null;
  topRelease: { title: string; streams: number } | null;
}

export interface Artist360ReleaseRow {
  id: string;
  title: string;
  format: string | null;
  releaseDate: string | null;
  trackCount: number;
  streams: number;
  changePct: number | null;
}

export interface Artist360SourceRow {
  source: string;
  platform: string;
  streams: number;
}

export interface Artist360CityRow {
  city: string;
  country: string | null;
  streams: number;
  superfans: number;
}

export interface Artist360PlaylistRow {
  name: string;
  ownerId: string | null;
  streams: number;
  latestPosition: number | null;
}

export interface Artist360ShazamRow {
  city: string;
  country: string | null;
  shazams: number;
}

export interface Artist360TrendPoint {
  date: string;
  streams: number;
}

// (removed — duplicate export of Artist360Result)

// Dummy to satisfy imports — real types were lost in git checkout
export type Artist360Result = {
  artistId: string;
  artistName: string;
  hero: Artist360Hero;
  releases: Artist360ReleaseRow[];
  dailyTrend: Artist360TrendPoint[];
  sources: Artist360SourceRow[];
  cities: Artist360CityRow[];
  playlists: Artist360PlaylistRow[];
  shazams: Artist360ShazamRow[];
  dataWindow: Artist360DataWindow;
  sourceFingerprint: { topSource: { source: string; platform: string; streams: number } | null; sourceMix: Artist360SourceRow[] };
  cityFootprint: { topCities: Artist360CityRow[]; cityCount: number };
  playlistPresence: { topPlaylists: Artist360PlaylistRow[]; playlistCount: number };
  shazamMomentum: { topShazams: Artist360ShazamRow[]; shazamCount: number };
};

export interface BuildArtist360Input {
  artistId: string;
  artistName: string;
  releases: Artist360ReleaseRow[];
  dailyRows: Artist360TrendPoint[];
  sourceRows: Artist360SourceRow[];
  cityRows: Artist360CityRow[];
  playlistRows: Artist360PlaylistRow[];
  shazamRows: Artist360ShazamRow[];
}

export function buildArtist360(input: BuildArtist360Input): Artist360Result {
  const dailyDates = input.dailyRows.map((r) => r.date).sort();
  const totalStreams = input.dailyRows.reduce((s, r) => s + r.streams, 0);
  const topCity = [...input.cityRows].sort((a, b) => b.streams - a.streams)[0] ?? null;
  const topSource = [...input.sourceRows].sort((a, b) => b.streams - a.streams)[0] ?? null;
  const topRelease = [...input.releases].sort((a, b) => b.streams - a.streams)[0] ?? null;
  return {
    artistId: input.artistId,
    artistName: input.artistName,
    hero: {
      name: input.artistName,
      releaseCount: input.releases.length,
      trackCount: input.releases.reduce((s, r) => s + r.trackCount, 0),
      totalStreams,
      topCity: topCity?.city ?? null,
      topSource: topSource ? `${topSource.platform} \u00b7 ${topSource.source}` : null,
      topRelease: topRelease ? { title: topRelease.title, streams: topRelease.streams } : null,
    },
    releases: input.releases,
    dailyTrend: input.dailyRows,
    sources: input.sourceRows,
    cities: input.cityRows,
    playlists: input.playlistRows,
    shazams: input.shazamRows,
    dataWindow: { from: dailyDates[0] ?? null, to: dailyDates[dailyDates.length - 1] ?? null },
    sourceFingerprint: { topSource: topSource ? { source: topSource.source, platform: topSource.platform, streams: topSource.streams } : null, sourceMix: input.sourceRows.slice(0, 5) },
    cityFootprint: { topCities: [...input.cityRows].sort((a, b) => b.streams - a.streams).slice(0, 5), cityCount: input.cityRows.length },
    playlistPresence: { topPlaylists: [...input.playlistRows].sort((a, b) => b.streams - a.streams).slice(0, 5), playlistCount: input.playlistRows.length },
    shazamMomentum: { topShazams: [...input.shazamRows].sort((a, b) => b.shazams - a.shazams).slice(0, 5), shazamCount: input.shazamRows.length },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Release Cockpit types (auto-reconstructed)
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseCockpitTrackRow {
  id: string;
  trackTitle: string;
  position: number | null;
  combinedStreams: number;
  spotifyStreams: number;
  appleStreams: number;
  streamsGrowth: number | null;
  combinedViews: number;
}

export interface ReleaseCockpitPlaylistRow {
  playlistName: string;
  ownerId: string | null;
  streams: number;
  latestPosition: number | null;
}

export interface ReleaseCockpitShazamRow {
  city: string;
  trackTitle: string;
  shazams: number;
}

export interface ReleaseCockpitPeriodSummary {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  streamTotal: number;
  dailyTrend: AnalyticsTrendPoint[];
  changePct: number | null;
  topCity: { city: string; streams: number } | null;
  topSource: { source: string; platform: string; sharePct: number } | null;
  insights: { label: string; title: string; metric: string; detail: string; action: string; tone: "good" | "watch" | "neutral" }[];
  topCities: { city: string; streams: number }[];
  topSources: { source: string; platform: string; streams: number; sharePct: number }[];
}

export interface ReleaseCockpit {
  releaseId: string;
  releaseTitle: string;
  artistName: string | null;
  format: string | null;
  releaseDate: string | null;
  trackCount: number;
  defaultPeriod: string;
  dataWindow: { from: string | null; to: string | null };
  periods: ReleaseCockpitPeriodSummary[];
  tracks: ReleaseCockpitTrackRow[];
  cities: Artist360CityRow[];
  playlists: ReleaseCockpitPlaylistRow[];
  shazams: ReleaseCockpitShazamRow[];
  topPlaylists: ReleaseCockpitPlaylistRow[];
  topPlaylistCount: number;
  leaderboard: ReleaseCockpitTrackRow[];
}

export interface BuildReleaseCockpitInput {
  releaseId: string;
  releaseTitle: string;
  artistName: string | null;
  format: string | null;
  releaseDate: string | null;
  trackCount: number;
  dailySources: CommandDailySourceRow[];
  tracks: ReleaseCockpitTrackRow[];
  cities: Artist360CityRow[];
  playlists: ReleaseCockpitPlaylistRow[];
  shazams: ReleaseCockpitShazamRow[];
}

export function buildReleaseCockpit(input: BuildReleaseCockpitInput): ReleaseCockpit {
  const dailyRows = normalizeDailyRows(input.dailySources);
  const datedRows = dailyRows.filter(hasDate);
  const allDates = [...new Set(datedRows.map((r) => r.date))].sort();
  const wf = allDates[0] ?? null;
  const wt = allDates[allDates.length - 1] ?? null;
  const _rcShift = (d: string | null, days: number): string | null => {
    if (!d) return null;
    const x = new Date(d.slice(0, 10) + "T00:00:00Z");
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  };
  const periods: ReleaseCockpitPeriodSummary[] = [
    { k: "7d", l: "Last 7 days", d: 7 }, { k: "30d", l: "Last 30 days", d: 30 },
    { k: "90d", l: "Last 90 days", d: 90 }, { k: "all", l: "All history", d: null },
  ].map((p) => {
    const from = p.d === null ? wf : _rcShift(wt, -(p.d - 1));
    const sel = datedRows.filter((r) => (!from || r.date >= from) && (!wt || r.date <= wt));
    const streamTotal = sel.reduce((s, r) => s + r.streams, 0);

    // Previous period for change calculation
    const prevEnd = from ? _rcShift(from, -1) : null;
    const prevStart = p.d !== null && from ? _rcShift(from, -(p.d)) : null;
    const prevSel = datedRows.filter((r) => prevStart && prevEnd && r.date >= prevStart && r.date <= prevEnd);
    const prevTotal = prevSel.reduce((s, r) => s + r.streams, 0);
    const changePct = prevTotal > 0 ? (streamTotal - prevTotal) / prevTotal : null;

    // Source breakdown for this period
    const sourceMap = new Map<string, { source: string; platform: string; streams: number }>();
    for (const r of sel) {
      const key = `${r.platform ?? "unknown"}:${r.source ?? "unknown"}`;
      const existing = sourceMap.get(key);
      if (existing) existing.streams += r.streams;
      else sourceMap.set(key, { source: r.source ?? "unknown", platform: r.platform ?? "unknown", streams: r.streams });
    }
    const topSourcesRaw = [...sourceMap.values()].sort((a, b) => b.streams - a.streams);
    const topSources = topSourcesRaw.map(s => ({ ...s, sharePct: streamTotal > 0 ? s.streams / streamTotal : 0 }));
    const topSource = topSources[0] ?? null;

    // Top cities (from global input)
    const topCities = [...input.cities].sort((a, b) => b.streams - a.streams);
    const topCity = topCities[0] ? { city: topCities[0].city, streams: topCities[0].streams } : null;

    // Insights
    const insights: ReleaseCockpitPeriodSummary["insights"] = [];
    if (streamTotal > 0) {
      insights.push({
        label: "Performance", title: `${formatCompact(streamTotal)} streams in period`,
        metric: changePct !== null ? `${changePct >= 0 ? "+" : ""}${(changePct * 100).toFixed(1)}%` : "—",
        detail: changePct !== null ? `Compared to previous ${p.l.toLowerCase()}` : "No previous data for comparison",
        action: changePct !== null && changePct > 0 ? "Momentum is positive — consider playlist pitching" : "Monitor trend and adjust marketing spend",
        tone: (changePct !== null && changePct > 0.1) ? "good" : (changePct !== null && changePct < -0.1) ? "watch" : "neutral",
      });
      if (topSource) {
        insights.push({
          label: "Channel mix", title: `${titleCase(topSource.platform)} · ${topSource.source} leads`,
          metric: `${(topSource.sharePct * 100).toFixed(0)}% share`,
          detail: `${formatCompact(topSource.streams)} streams from this channel`,
          action: topSource.sharePct > 0.5 ? "Diversify channels to reduce dependency" : "Channel mix looks healthy",
          tone: topSource.sharePct > 0.7 ? "watch" : "good",
        });
      }
      if (topCity) {
        insights.push({
          label: "Geography", title: `${topCity.city} is top market`,
          metric: formatCompact(topCity.streams),
          detail: `${topCities.length} cities with streaming activity`,
          action: topCity.streams > streamTotal * 0.5 ? "Strong in one city — expand to similar markets" : "Geographic spread is healthy",
          tone: topCity.streams > streamTotal * 0.5 ? "watch" : "good",
        });
      }
      if (input.tracks.length > 0) {
        const topTrackGrowth = [...input.tracks].sort((a, b) => (b.streamsGrowth ?? -Infinity) - (a.streamsGrowth ?? -Infinity))[0];
        if (topTrackGrowth && topTrackGrowth.streamsGrowth !== null) {
          insights.push({
            label: "Track momentum", title: topTrackGrowth.trackTitle,
            metric: `${topTrackGrowth.streamsGrowth >= 0 ? "+" : ""}${(topTrackGrowth.streamsGrowth * 100).toFixed(1)}%`,
            detail: "Fastest growing track on this release",
            action: topTrackGrowth.streamsGrowth > 0.2 ? "Pitch this track to playlists and DSP editors" : "Test new creative assets for top tracks",
            tone: topTrackGrowth.streamsGrowth > 0.1 ? "good" : topTrackGrowth.streamsGrowth < -0.1 ? "watch" : "neutral",
          });
        }
      }
    }

    return { key: p.k, label: p.l, from: p.k === "all" ? wf : from, to: wt,
      streamTotal, dailyTrend: buildDailyTrend(sel),
      changePct, topCity, topSource, insights, topCities, topSources };
  });
  return {
    releaseId: input.releaseId, releaseTitle: input.releaseTitle, artistName: input.artistName,
    format: input.format, releaseDate: input.releaseDate, trackCount: input.trackCount,
    defaultPeriod: "30d", dataWindow: { from: wf, to: wt }, periods,
    tracks: input.tracks, cities: input.cities, playlists: input.playlists, shazams: input.shazams,
    topPlaylists: [...input.playlists].sort((a, b) => b.streams - a.streams).slice(0, 5),
    topPlaylistCount: input.playlists.length,
    leaderboard: [...input.tracks]
      .filter((track) => track.combinedStreams > 0 || track.spotifyStreams > 0 || track.appleStreams > 0 || track.combinedViews > 0)
      .sort((a, b) => b.combinedStreams - a.combinedStreams)
      .slice(0, 10),
  };
}
