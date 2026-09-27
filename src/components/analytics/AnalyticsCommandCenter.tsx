"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  AnalyticsCommandCenter,
  AnalyticsCommandFilter,
  AnalyticsCommandPeriodSummary,
  AnalyticsInsightCard,
  AnalyticsPlatform,
  AnalyticsPeriodKey,
  AnalyticsSourceMixRow,
  CommandCityRow,
  CommandPlaylistRow,
  CommandShazamRow,
  CommandTrackRow,
  FilterOption,
} from "../../server/analytics-command-center-core";
import { analyticsGrowthClass, formatAnalyticsPercent } from "./utils";
import { Select as AppSelect } from "../ui/select";
import {
  ANALYTICS_IMPORT_STALE_AFTER_HOURS,
  analyticsSyncRunsHref,
  type AnalyticsSection,
} from "../../lib/analytics-workspace";

import { Button } from "@/components/ui/button";
type CommandCenterSection = Extract<
  AnalyticsSection,
  "overview" | "trends" | "audience" | "discovery"
>;

interface Props {
  command: AnalyticsCommandCenter;
  section: CommandCenterSection;
}

type MetadataNode = string | ReactNode;

const sectionCopy = {
  overview: { title: "Overview", description: "Key movement and decisions across the selected analytics scope." },
  trends: { title: "Trends", description: "Daily movement and catalogue momentum for the selected period." },
  audience: { title: "Audience", description: "Markets, listener composition, and demand signals." },
  discovery: { title: "Discovery", description: "Streaming sources, playlists, and discovery opportunities." },
} as const;

export default function AnalyticsCommandCenterView({ command, section }: Props) {
  const [periodKey, setPeriodKey] = useState<AnalyticsPeriodKey>(() => {
    if (typeof window === "undefined") return command.defaultPeriod;
    const requested = new URLSearchParams(window.location.search).get("period");
    return command.periods.some((period) => period.key === requested) ? requested as AnalyticsPeriodKey : command.defaultPeriod;
  });
  const selectedPeriod = useMemo(
    () => command.periods.find((period) => period.key === periodKey) ?? command.periods[0],
    [command.periods, periodKey],
  );

  if (command.dataHealth.totalRows === 0) {
    const failed = command.dataHealth.latestRunStatus === "failed";
    return (
      <section aria-labelledby="analytics-empty-title" className="border-y border-border py-10 sm:py-14">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{sectionCopy[section].title}</p>
        <h2 id="analytics-empty-title" className="mt-4 text-3xl font-semibold tracking-tight">{failed ? "Your import needs attention." : "Bring your listening data together."}</h2>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">{failed ? "The latest import failed, and no analytics rows are available. Review the import details before trying again." : command.dataHealth.latestRunStatus ? "No analytics rows are available. Review your import history or add a supported export to get started." : "No analytics data has been imported yet. Start with a Spotify audience CSV or a Sisense track snapshot. Metrics will appear as supported data becomes available."}</p>
        <a href="/analytics?section=data-health" className="mt-6 inline-flex min-h-11 items-center gap-6 bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{failed ? "Review import" : "Import analytics"}<span aria-hidden="true">→</span></a>
        {!command.availableArtists.length && <p className="mt-5 text-sm text-muted-foreground">You’ll need an artist to link your import. <a href="/artists" className="underline underline-offset-4 hover:text-foreground">Start with your roster.</a></p>}
      </section>
    );
  }

  const hasActiveFilters =
    Boolean(command.activeFilters.artistId) ||
    Boolean(command.activeFilters.releaseId) ||
    Boolean(command.activeFilters.platforms?.length);
  const reportingWindow = periodWindow(selectedPeriod);
  const allHistoryReportingLabel = `Source coverage from ${command.dataWindow.from ?? "no date"} to ${command.dataWindow.to ?? "no date"}`;

  const dailySourceMeta = buildReportingMeta({
    command,
    sourceWidgetKeys: ["csv-daily-source-mix", "spotify-streams-source", "apple-streams-source"],
    sourceLabel: "Sisense daily source mix",
    reportingLabel: reportingWindow,
    scopeLabel: "Scope: selected-period trend",
  });
  const trackTotalsMeta = buildReportingMeta({
    command,
    sourceWidgetKeys: ["csv-track-totals", "tracks-by-growth-rate"],
    sourceLabel: "Sisense track totals",
    reportingLabel: allHistoryReportingLabel,
    scopeLabel: command.activeFilters.artistId || command.activeFilters.releaseId
      ? "Scope: selected artist/release filters"
      : "Scope: catalogue-wide",
  });
  const geoMeta = buildReportingMeta({
    command,
    sourceWidgetKeys: ["csv-geo-superfans", "spotify-superfans-active-streams-city"],
    sourceLabel: "Sisense geo superfans",
    reportingLabel: allHistoryReportingLabel,
    scopeLabel: "Scope: catalogue-wide until linked imports exist",
  });
  const playlistMeta = buildReportingMeta({
    command,
    sourceWidgetKeys: ["csv-playlists", "spotify-playlist-listings"],
    sourceLabel: "Sisense playlists",
    reportingLabel: allHistoryReportingLabel,
    scopeLabel: "Scope: catalogue-wide until linked imports exist",
  });
  const shazamMeta = buildReportingMeta({
    command,
    sourceWidgetKeys: ["csv-shazams-city", "shazams-city"],
    sourceLabel: "Sisense shazams by city",
    reportingLabel: allHistoryReportingLabel,
    scopeLabel: "Scope: catalogue-wide",
  });
  const requestedPlatformWidgetKeys = command.activeFilters.platforms?.length
    ? command.activeFilters.platforms.map((platform) => platform === "apple" ? "apple-streams-source" : "spotify-streams-source")
    : ["spotify-streams-source", "apple-streams-source"];
  const dailySourceAvailability = sourceAvailability(command, [["csv-daily-source-mix"], requestedPlatformWidgetKeys]);
  const trackTotalsAvailability = sourceAvailability(command, [["csv-track-totals"], ["tracks-by-growth-rate"]]);
  const geoAvailability = sourceAvailability(command, [["csv-geo-superfans"], ["spotify-superfans-active-streams-city"]]);
  const catalogueMetricLabel = command.activeFilters.artistId
    ? "Selected artist combined streams"
    : command.activeFilters.releaseId
      ? "Selected release combined streams"
      : "Catalogue combined streams";
  return (
    <section className="space-y-8">
      <div className="space-y-7 border-b border-[var(--border)] pb-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              Analytics workspace
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">{sectionCopy[section].title}</h2>
            <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">
              {sectionCopy[section].description}
            </p>
          </div>
          {section === "audience" ? (
            <span className="border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-sm font-medium text-[var(--foreground)]">
              All available audience data
            </span>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {command.periods.map((period) => (
                <Button
                  key={period.key}
                  type="button"
                  onClick={() => {
                    setPeriodKey(period.key);
                    const params = new URLSearchParams(window.location.search);
                    params.set("period", period.key);
                    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
                  }}
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
          )}
        </div>

        {section === "audience" ? (
          <p className="border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--muted-foreground)]">
            Audience is a catalogue-wide snapshot. The imported files have no per-row dates or artist/release links, so period and object filters are unavailable.
          </p>
        ) : (
          <FilterBar
            artists={command.availableArtists}
            releases={command.availableReleases}
            activeFilters={command.activeFilters}
            hasActiveFilters={hasActiveFilters}
          />
        )}

        <DataFreshnessBanner command={command} />

        {section === "overview" && (
          <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <HeroMetric
              label="Selected-period combined streams"
              value={dailySourceAvailability.available ? formatNumber(selectedPeriod.streamTotal) : "Unavailable"}
              delta={dailySourceAvailability.available ? selectedPeriod.changePct : null}
              meta={dailySourceAvailability.available ? dailySourceMeta : [dailySourceAvailability.reason, ...dailySourceMeta]}
              strong
            />
            <HeroMetric
              label={catalogueMetricLabel}
              value={trackTotalsAvailability.available ? formatNumber(command.catalog.totalStreams) : "Unavailable"}
              meta={trackTotalsAvailability.available ? trackTotalsMeta : [trackTotalsAvailability.reason, ...trackTotalsMeta]}
            />
            <HeroMetric
              label="Top mover"
              value={trackTotalsAvailability.available ? command.catalog.topMover?.trackTitle ?? "—" : "Unavailable"}
              delta={trackTotalsAvailability.available ? command.catalog.topMover?.streamsGrowth ?? null : null}
              meta={trackTotalsAvailability.available ? trackTotalsMeta : [trackTotalsAvailability.reason, ...trackTotalsMeta]}
            />
            <HeroMetric
              label="Top city"
              value={geoAvailability.available ? command.markets.topCity?.city ?? "—" : "Unavailable"}
              delta={null}
              meta={geoAvailability.available
                ? command.markets.topCity ? [`${formatNumber(command.markets.topCity.streams)} streams`, ...geoMeta] : geoMeta
                : [geoAvailability.reason, ...geoMeta]}
            />
            <HeroMetric
              label="Top source"
              value={dailySourceAvailability.available
                ? selectedPeriod.topSource ? `${titleCase(selectedPeriod.topSource.platform)} · ${selectedPeriod.topSource.source}` : "—"
                : "Unavailable"}
              meta={dailySourceAvailability.available
                ? selectedPeriod.topSource ? [`${formatAnalyticsPercent(selectedPeriod.topSource.sharePct)} share`, ...dailySourceMeta] : ["No source data", ...dailySourceMeta]
                : [dailySourceAvailability.reason, ...dailySourceMeta]}
            />
          </div>
        )}
      </div>

      {section === "overview" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {selectedPeriod.insights.map((insight) => <InsightCard key={insight.label} insight={insight} />)}
        </div>
      )}

      {section === "trends" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Daily streams trend"
            eyebrow={periodWindow(selectedPeriod)}
            description="Spotify and Apple combined. Use this to spot momentum instead of reading raw rows."
            metadata={dailySourceMeta}
          >
            <TrendChart period={selectedPeriod} />
          </Panel>
          <Panel
            title="Catalogue movers"
            eyebrow="Prioritise tracks"
            description="Sort by stream base first, then growth. These are candidates for content, ads, or playlist pitching."
            metadata={trackTotalsMeta}
          >
            <CatalogueMovers rows={command.catalog.topTracks} />
          </Panel>
        </div>
      )}

      {section === "audience" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Markets to act on"
            eyebrow="Geo opportunity"
            description="Cities with the strongest stream/superfan concentration."
            metadata={geoMeta}
          >
            <MarketList rows={command.markets.topCities.slice(0, 8)} />
          </Panel>
          <Panel
            title="Shazam demand"
            eyebrow="Offline/curiosity signal"
            description="Cities where people actively identify tracks."
            metadata={shazamMeta}
          >
            <ShazamList rows={command.markets.shazams} />
          </Panel>
        </div>
      )}

      {section === "discovery" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Discovery source mix"
            eyebrow="Channel split"
            description="Separates algorithmic/radio lift from collection, playlist, search, and Apple discovery."
            metadata={dailySourceMeta}
          >
            <SourceMix rows={selectedPeriod.topSources} total={selectedPeriod.streamTotal} />
          </Panel>
          <Panel
            title="Playlist opportunities"
            eyebrow="Placement impact"
            description="Top playlist stream contribution. Position fields show where follow-up may be possible."
            metadata={playlistMeta}
          >
            <PlaylistList rows={command.playlists.rows.slice(0, 8)} />
          </Panel>
        </div>
      )}
    </section>
  );
}

function DataFreshnessBanner({ command }: { command: AnalyticsCommandCenter }) {
  const syncRunsHref = analyticsSyncRunsLink();
  const sourceRows = command.dataHealth.widgetRows
    .map((widget) => ({
      ...widget,
      label: widgetKeyToLabel(widget.widgetKey),
      stale: isStale(widget.lastSeenAt),
    }))
    .filter((row) => row.rowCount > 0);

  const lastSeenAt = command.dataHealth.lastSeenAt;
  const latestRun = command.dataHealth.latestRunStatus;
  const stale = isStale(lastSeenAt);
  const label = lastSeenAt ? formatLongDate(lastSeenAt) : "No imported rows yet";
  const staleRows = sourceRows.filter((row) => row.stale);
  const staleSource = staleRows[0]?.label ?? "source rows";
  const secondaryTextClass = stale
    ? "text-amber-950/80 dark:text-amber-100/85"
    : "text-[var(--foreground)]/80";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border px-3 py-2.5 text-sm ${stale ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/20"}`} role="status">
      <div>
        <span className="font-medium">Sisense import</span>
        <span className={`ml-2 ${secondaryTextClass}`}>Last seen {label}</span>
        <div className={`mt-1 flex flex-wrap gap-1.5 text-xs ${secondaryTextClass}`}>
          <span>Source window: {command.dataWindow.from && command.dataWindow.to ? `${command.dataWindow.from} – ${command.dataWindow.to}` : "no dated rows"}</span>
          <span>·</span>
          <span>Stale after {ANALYTICS_IMPORT_STALE_AFTER_HOURS} hours</span>
        </div>
        {stale ? (
          <p className={`mt-1 text-xs ${secondaryTextClass}`}>Track totals use the selected scope; source, market, and playlist aggregates remain catalogue-wide until imported rows carry object links.</p>
        ) : null}
      </div>
      {stale ? (
        <p className="max-w-[26rem] text-xs text-amber-700 dark:text-amber-200">
          Affected source: <strong>{staleSource}</strong>. Open
          {" "}
          <a href={syncRunsHref} className="underline underline-offset-2">sync runs</a> for remediation details.
        </p>
      ) : (
        <span className={`text-xs ${secondaryTextClass}`}>Latest run: {latestRun ?? "unknown"}</span>
      )}
    </div>
  );
}

function widgetKeyToLabel(widgetKey: string): string {
  const sourceLabels: Record<string, string> = {
    "csv-daily-source-mix": "Sisense daily source mix",
    "csv-track-totals": "Sisense track totals",
    "csv-geo-superfans": "Sisense geo superfans",
    "csv-demographics": "Sisense demographics",
    "csv-playlists": "Sisense playlists",
    "csv-shazams-city": "Sisense shazams by city",
  };

  return sourceLabels[widgetKey] ?? widgetKey;
}

function isStale(lastSeenAt: string | Date | null): boolean {
  if (!lastSeenAt) return true;
  return Date.now() - new Date(lastSeenAt).getTime() > ANALYTICS_IMPORT_STALE_AFTER_HOURS * 60 * 60 * 1000;
}

function buildReportingMeta({
  command,
  sourceWidgetKeys,
  sourceLabel,
  reportingLabel,
  scopeLabel,
}: {
  command: AnalyticsCommandCenter;
  sourceWidgetKeys: string[];
  sourceLabel: string;
  reportingLabel: string;
  scopeLabel: string;
}): MetadataNode[] {
  const sourceLastSeenAt = sourceWidgetKeys.length
    ? maxLastSeenAt(command.dataHealth.widgetRows
      .filter((widget) => sourceWidgetKeys.includes(widget.widgetKey))
      .map((widget) => widget.lastSeenAt))
    : command.dataHealth.lastSeenAt;
  const affectedSourceRows = command.dataHealth.widgetRows
    .filter((widget) => sourceWidgetKeys.includes(widget.widgetKey) && widget.rowCount > 0)
    .filter((widget) => isStale(widget.lastSeenAt));
  const isSourceStale = isStale(sourceLastSeenAt);
  const staleSourceLabels = affectedSourceRows.map((widget) => widgetKeyToLabel(widget.widgetKey));
  const staleSourceLabelText = staleSourceLabels.join(", ");

  return [
    `Source: ${sourceLabel}`,
    `Reporting: ${reportingLabel}`,
    scopeLabel,
    <span key={`freshness-${sourceLabel}`}>
      Freshness: <span className={isSourceStale ? "font-medium text-amber-700 dark:text-amber-300" : "font-medium text-green-700 dark:text-green-300"}>{isSourceStale ? "stale" : "current"}</span>.
      {isSourceStale && staleSourceLabels.length
        ? (
          <span>
            {" "}
            Affected source{staleSourceLabels.length > 1 ? "s" : ""}:{" "}
            <strong>{staleSourceLabelText}</strong>. Open{" "}
            <a href={analyticsSyncRunsLink()} className="underline underline-offset-2">sync runs</a> for remediation details.
          </span>
        )
        : null}
    </span>,
    `Last seen: ${formatLongDate(sourceLastSeenAt)}`,
    `Stale threshold: ${ANALYTICS_IMPORT_STALE_AFTER_HOURS} hours`,
  ];
}

function sourceAvailability(
  command: AnalyticsCommandCenter,
  alternativeSourceGroups: string[][],
): { available: true; reason: "" } | { available: false; reason: string } {
  const sourceRows = command.dataHealth.widgetRows.filter((widget) => widget.rowCount > 0);
  const sourceRowByKey = new Map(sourceRows.map((widget) => [widget.widgetKey, widget]));
  let hasCompleteStaleGroup = false;

  for (const sourceGroup of alternativeSourceGroups) {
    const groupRows = sourceGroup.map((key) => sourceRowByKey.get(key));
    if (groupRows.some((row) => !row)) continue;
    if (groupRows.every((row) => row && !isStale(row.lastSeenAt))) return { available: true, reason: "" };
    hasCompleteStaleGroup = true;
  }

  if (hasCompleteStaleGroup) return { available: false, reason: "Source data is stale." };
  const expectedKeys = new Set(alternativeSourceGroups.flat());
  if (sourceRows.some((row) => expectedKeys.has(row.widgetKey))) {
    return { available: false, reason: "Source data is incomplete." };
  }
  return { available: false, reason: "Source data is unavailable." };
}

function analyticsSyncRunsLink(): string {
  // SAFETY: new URL can throw on malformed locations; fall back to the canonical path.
  if (typeof window === "undefined") return analyticsSyncRunsHref(new URL("https://label-suite.internal/analytics"));
  try {
    return analyticsSyncRunsHref(new URL(window.location.href));
  } catch {
    return analyticsSyncRunsHref(new URL("https://label-suite.internal/analytics"));
  }
}

function FilterBar({
  artists,
  releases,
  activeFilters,
  hasActiveFilters,
}: {
  artists: FilterOption[];
  releases: FilterOption[];
  activeFilters: AnalyticsCommandFilter;
  hasActiveFilters: boolean;
}) {
  const selectedPlatforms = activeFilters.platforms ?? [];

  function applyFilter(updates: Partial<AnalyticsCommandFilter>) {
    const params = new URLSearchParams(window.location.search);
    const merged: AnalyticsCommandFilter = {
      ...activeFilters,
      ...updates,
    };

    if (merged.artistId) params.set("artist", merged.artistId);
    else params.delete("artist");

    if (merged.releaseId) params.set("release", merged.releaseId);
    else params.delete("release");

    if (merged.platforms?.length) params.set("platform", merged.platforms.join(","));
    else params.delete("platform");

    window.location.assign(`${window.location.pathname}?${params.toString()}`);
  }

  function clearAll() {
    window.location.assign(window.location.pathname);
  }

  function togglePlatform(platform: AnalyticsPlatform) {
    const next = selectedPlatforms.includes(platform)
      ? selectedPlatforms.filter((p) => p !== platform)
      : [...selectedPlatforms, platform];
    applyFilter({ platforms: next.length ? next : undefined });
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Filter</span>

      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-[var(--muted-foreground)]">Artist</span>
        <AppSelect
          value={activeFilters.artistId ?? ""}
          onValueChange={(value) => applyFilter({ artistId: value || undefined, releaseId: undefined })}
          options={[{ value: "", label: "All artists" }, ...artists.map((artist) => ({ value: artist.id, label: artist.label }))]}
          aria-label="Filter analytics by artist"
          className="h-9 min-w-40"
        />
      </label>

      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-[var(--muted-foreground)]">Release</span>
        <AppSelect
          value={activeFilters.releaseId ?? ""}
          onValueChange={(value) => applyFilter({ releaseId: value || undefined })}
          options={[{ value: "", label: activeFilters.artistId ? "All artist releases" : "All releases" }, ...releases.map((release) => ({ value: release.id, label: release.label }))]}
          aria-label="Filter analytics by release"
          className="h-9 min-w-44"
        />
      </label>

      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-[var(--muted-foreground)]">Platform</span>
        {(["spotify", "apple"] as AnalyticsPlatform[]).map((platform) => (
          <Button
            key={platform}
            type="button"
            onClick={() => togglePlatform(platform)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              selectedPlatforms.includes(platform)
                ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {titleCase(platform)}
          </Button>
        ))}
      </div>

      {hasActiveFilters && (
        <Button variant="outline"
          type="button"
          onClick={clearAll}
          className="rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition"
        >
          Clear all filters
        </Button>
      )}
    </div>
  );
}

function HeroMetric({
  label,
  value,
  delta,
  meta,
  strong = false,
}: {
  label: string;
  value: string;
  delta?: number | null;
  meta?: MetadataNode | MetadataNode[];
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 bg-muted/18 p-4">
      <p className="text-xs break-words text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={`break-words font-semibold tracking-tight ${strong ? "text-3xl" : "text-xl"}`} title={value}>{value}</p>
        {delta !== undefined && delta !== null && (
          <span className={`shrink-0 text-xs font-semibold ${analyticsGrowthClass(delta)}`}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "·"} {formatAnalyticsPercent(Math.abs(delta))}</span>
        )}
      </div>
      {meta && (
        <div className="mt-3 flex min-w-0 flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          {Array.isArray(meta)
            ? meta.map((item, index) => (
              <span key={`hero-meta-${index}`} className="break-words">
                {typeof item === "string" ? <span title={item}>{item}</span> : item}
              </span>
            ))
            : <span className="break-words">{typeof meta === "string" ? <span title={meta}>{meta}</span> : meta}</span>}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: AnalyticsInsightCard }) {
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

function Panel({
  title,
  eyebrow,
  description,
  metadata,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  metadata?: MetadataNode | MetadataNode[];
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-5">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
      {metadata ? (
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">
            {Array.isArray(metadata)
              ? metadata.map((item, index) => (
              <p key={`panel-meta-${index}`} className="break-words">
                {typeof item === "string" ? <span title={item}>{item}</span> : item}
              </p>
            ))
            : <p className="break-words">{typeof metadata === "string" ? <span title={metadata}>{metadata}</span> : metadata}</p>}
        </div>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function TrendChart({ period }: { period: AnalyticsCommandPeriodSummary }) {
  const max = Math.max(...period.dailyTrend.map((point) => point.total), 1);
  const sampled = period.dailyTrend.length > 70 ? period.dailyTrend.filter((_, i) => i % Math.ceil(period.dailyTrend.length / 70) === 0) : period.dailyTrend;
  if (period.trendState.kind === "empty") {
    return <Empty>No trend rows for this period.</Empty>;
  }

  if (period.trendState.kind === "invalid") {
    return <Empty>Trend data for this period is invalid. Check source dates and numeric stream values.</Empty>;
  }

  if (!sampled.length) return <Empty>No trend rows for this period.</Empty>;

  const trendNotice = period.trendState.kind === "insufficient"
    ? <p className="text-xs text-amber-700 dark:text-amber-200">Insufficient trend points for a reliable shape, but visible data is shown.</p>
    : null;

  return (
    <div className="space-y-4">
      {trendNotice}
      <div className="flex h-64 items-end gap-1 border-b border-l border-[var(--border)] px-2 pt-6">
        {sampled.map((point) => (
          <div
            key={point.date}
            role="img"
            aria-label={`${point.date}: ${formatNumber(point.total)} streams`}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
          >
            <div
              className="w-full rounded-t bg-[var(--foreground)]/75 transition group-hover:bg-[var(--foreground)]"
              style={{ height: `${Math.max((point.total / max) * 100, 2)}%` }}
              title={`${point.date}: ${formatNumber(point.total)} streams`}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--popover,var(--card))] px-2 py-1 text-xs shadow group-hover:block whitespace-nowrap">
              {point.date}: {formatNumber(point.total)} streams
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <MiniStat label="Avg/day" value={formatNumber(Math.round(period.streamTotal / Math.max(period.dailyTrend.length, 1)))} />
        <MiniStat label="Best day" value={formatNumber(Math.max(...period.dailyTrend.map((point) => point.total), 0))} />
        <MiniStat label="Days" value={formatNumber(period.dailyTrend.length)} />
      </div>
    </div>
  );
}

function SourceMix({ rows, total }: { rows: AnalyticsSourceMixRow[]; total: number }) {
  if (!rows.length) return <Empty>No source rows for this period.</Empty>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((row) => (
        <div key={`${row.platform}-${row.source}`}>
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="min-w-0 break-words" title={row.source}>
              <span className="text-[var(--muted-foreground)]">{titleCase(row.platform)}</span> · {row.source}
            </span>
            <span className="shrink-0 text-right font-semibold tabular-nums">{formatNumber(row.streams)}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--muted)]">
            <div className="h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(total ? (row.streams / total) * 100 : 0, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CatalogueMovers({ rows }: { rows: CommandTrackRow[] }) {
  if (!rows.length) return <Empty>No catalogue rows.</Empty>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium" title={row.trackTitle}>{row.trackTitle}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{row.primaryArtist ?? "—"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">{formatNumber(row.combinedStreams)}</p>
            <p className={`text-xs font-medium ${analyticsGrowthClass(row.streamsGrowth)}`}>{row.streamsGrowth === null ? "—" : `${row.streamsGrowth >= 0 ? "+" : ""}${formatAnalyticsPercent(row.streamsGrowth)}`}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketList({ rows }: { rows: CommandCityRow[] }) {
  if (!rows.length) return <Empty>No market rows.</Empty>;
  const max = Math.max(...rows.map((row) => row.streams), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.city}>
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="min-w-0 break-words" title={row.city}>{row.city}</span>
            <span className="shrink-0 text-right font-semibold tabular-nums">{formatNumber(row.streams)}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--muted)]">
            <div className="h-2 rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.max((row.streams / max) * 100, 2)}%` }} />
          </div>
          {row.listeners !== null && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{formatNumber(row.listeners)} superfans</p>}
        </div>
      ))}
    </div>
  );
}

function PlaylistList({ rows }: { rows: CommandPlaylistRow[] }) {
  if (!rows.length) return <Empty>No playlist rows.</Empty>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium" title={row.label}>{row.label}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{row.dimensions.playlist__owner_id ?? row.dimensions.playlist_owner_id ?? "unknown owner"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">{formatNumber(Number(row.metrics.streams ?? 0))}</p>
            <p className="text-xs text-[var(--muted-foreground)]">pos {row.metrics.latest_position ?? "—"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShazamList({ rows }: { rows: CommandShazamRow[] }) {
  if (!rows.length) return <Empty>No Shazam rows.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-2xl border border-[var(--border)] p-3">
          <p className="break-words text-sm font-medium" title={row.label}>{row.label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(Number(row.metrics.shazams ?? 0))}</p>
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

function periodWindow(period: AnalyticsCommandPeriodSummary): string {
  if (!period.from || !period.to) return period.label;
  return `${period.label} · ${shortDate(period.from)}–${shortDate(period.to)}`;
}

function shortDate(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return value.slice(0, 10);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatLongDate(value: string | null): string {
  const date = parseIsoDate(value);
  if (!date) return "Waiting for import";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

function maxLastSeenAt(values: Array<string | Date | null>): string | null {
  const timestamps = values
    .map((value) => parseIsoDate(typeof value === "string" ? value : value?.toISOString() ?? null))
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
