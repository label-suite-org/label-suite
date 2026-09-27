/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AnalyticsCommandCenterView from "./AnalyticsCommandCenter";
import { buildAnalyticsCommandCenter, type BuildAnalyticsCommandCenterInput } from "../../server/analytics-command-center-core";
import type { AnalyticsSection } from "../../lib/analytics-workspace";

const baseInput: BuildAnalyticsCommandCenterInput = {
  tracks: [
    {
      id: "track-a",
      trackTitle: "Cherry-coloured Funk",
      primaryArtist: "True Blue",
      combinedStreams: 1000,
      spotifyStreams: 800,
      appleStreams: 200,
      streamsGrowth: 0.25,
      combinedViews: 500,
      viewsGrowth: 0.1,
    },
    {
      id: "track-b",
      trackTitle: "Bad Behavior",
      primaryArtist: "True Blue",
      combinedStreams: 700,
      spotifyStreams: 690,
      appleStreams: 10,
      streamsGrowth: -0.05,
      combinedViews: 200,
      viewsGrowth: null,
    },
  ],
  cities: [
    { city: "New York, United States", streams: 500, listeners: 40, trackCount: 0 },
    { city: "Copenhagen, Denmark", streams: 250, listeners: 20, trackCount: 0 },
  ],
  playlists: [
    {
      id: "playlist-a",
      label: "discoverWeekly",
      dimensions: { playlist__name: "discoverWeekly" },
      metrics: { streams: 120, latest_position: null },
      lastSeenAt: "2026-07-05",
    },
  ],
  shazams: [
    {
      id: "shazam-a",
      label: "Paris, France",
      dimensions: { city: "Paris", country: "France" },
      metrics: { shazams: 44 },
      lastSeenAt: "2026-07-05",
    },
  ],
  widgets: [{ widgetKey: "csv-track-totals", rowCount: 2, trackCount: 2, lastSeenAt: "2026-07-05" }],
  runHistory: [{ status: "completed", completedAt: "2026-07-05", rowsImported: 10, rowsInserted: 10, rowsUpdated: 0, rowsUnchanged: 0, filesDownloaded: 1, error: null }],
  dailySources: [],
  totalRows: 10,
  totalWidgets: 1,
  totalLinkedTracks: 2,
  lastSeenAt: "2026-07-05",
  availableArtists: [{ id: "artist-a", label: "Artist A" }],
  availableReleases: [
    { id: "release-a", label: "Artist A — Release A" },
    { id: "release-b", label: "Artist B — Release B" },
  ],
};

function stubWindow({
  pathname = "/analytics",
  search = "",
}: {
  pathname?: string;
  search?: string;
}) {
  const location = {
    href: `http://localhost${pathname}${search}`,
    pathname,
    search,
    hash: "",
    // Browsers navigate by updating href; the stub models that so components
    // using location.assign/replace can be observed through href.
    assign: (url: string) => {
      location.href = url;
    },
    replace: (url: string) => {
      location.href = url;
    },
    reload: vi.fn(),
    toString: () => `http://localhost${pathname}${search}`,
  } as unknown as Location;
  vi.stubGlobal("location", location);
}

async function renderAnalytics(
  commandBuilder: BuildAnalyticsCommandCenterInput,
  search = "?period=7d",
  section: Extract<AnalyticsSection, "overview" | "trends" | "audience" | "discovery"> = "overview",
) {
  stubWindow({ search });
  const command = buildAnalyticsCommandCenter(commandBuilder);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<AnalyticsCommandCenterView command={command} section={section} />);
  });

  return {
    container,
    root,
    html: container.innerHTML,
    command,
  };
}

async function cleanup(container: HTMLDivElement, root: Root) {
  await act(async () => {
    root.unmount();
    container.remove();
  });
  vi.unstubAllGlobals();
}

  beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("AnalyticsCommandCenter", () => {
  it("shows the selected artist label instead of its record ID", async () => {
    const { container, root } = await renderAnalytics({
      ...baseInput,
      filter: { artistId: "artist-a" },
    }, "?artist=artist-a&period=all", "overview");

    try {
      const artistFilter = container.querySelector('button[aria-label="Filter analytics by artist"]');
      expect(artistFilter?.textContent).toContain("Artist A");
      expect(artistFilter?.textContent).not.toContain("artist-a");
    } finally {
      await cleanup(container, root);
    }
  });

  it("does not present stale selected-artist totals as authoritative", async () => {
    const { container, root } = await renderAnalytics({
      ...baseInput,
      filter: { artistId: "artist-a" },
      widgets: [{
        widgetKey: "tracks-by-growth-rate",
        rowCount: 2,
        trackCount: 2,
        lastSeenAt: "2026-06-01T08:00:00.000Z",
      }],
      lastSeenAt: "2026-06-01T08:00:00.000Z",
    }, "?artist=artist-a&period=all", "overview");

    try {
      const label = [...container.querySelectorAll("p")]
        .find((node) => node.textContent === "Selected artist combined streams");
      const card = label?.parentElement;
      expect(card?.textContent).toContain("Unavailable");
      expect(card?.textContent).toContain("Source data is stale");
      expect(card?.textContent).not.toContain("1,700");
    } finally {
      await cleanup(container, root);
    }
  });

  it("does not present a combined period total when one platform source is missing", async () => {
    const current = new Date().toISOString();
    const { container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [{ date: "2026-08-10", platform: "spotify", source: "radio", streams: 120 }],
      widgets: [{ widgetKey: "spotify-streams-source", rowCount: 1, trackCount: 0, lastSeenAt: current }],
      lastSeenAt: current,
    }, "?period=all", "overview");

    try {
      const label = [...container.querySelectorAll("p")]
        .find((node) => node.textContent === "Selected-period combined streams");
      const card = label?.parentElement;
      expect(card?.textContent).toContain("Unavailable");
      expect(card?.textContent).toContain("Source data is incomplete");
      expect(card?.textContent).not.toContain("120");
    } finally {
      await cleanup(container, root);
    }
  });

  it.each([
    ["overview", "Selected-period combined streams", "Daily streams trend"],
    ["trends", "Daily streams trend", "Markets to act on"],
    ["audience", "Markets to act on", "Discovery source mix"],
    ["discovery", "Discovery source mix", "Selected-period combined streams"],
  ] as const)("renders only the %s workspace section", async (section, visible, hidden) => {
    const { container, root } = await renderAnalytics(baseInput, "?period=7d", section);
    try {
      expect(container.textContent).toContain(visible);
      expect(container.textContent).not.toContain(hidden);
    } finally {
      await cleanup(container, root);
    }
  });

  it("keeps the selected-period percentage beside its value instead of indenting metadata", async () => {
    const dailySources = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      platform: "spotify",
      source: "radio",
      streams: index < 7 ? 10 : 20,
    }));
    const current = new Date().toISOString();
    const { container, root } = await renderAnalytics({
      ...baseInput,
      dailySources,
      widgets: [
        { widgetKey: "spotify-streams-source", rowCount: 14, trackCount: 0, lastSeenAt: current },
        { widgetKey: "apple-streams-source", rowCount: 1, trackCount: 0, lastSeenAt: current },
      ],
      lastSeenAt: current,
    }, "?period=7d", "overview");

    try {
      const label = [...container.querySelectorAll("p")]
        .find((node) => node.textContent === "Selected-period combined streams");
      const card = label?.parentElement;
      const value = [...(card?.querySelectorAll("p") ?? [])]
        .find((node) => node.textContent === "140");
      const delta = [...(card?.querySelectorAll("span") ?? [])]
        .find((node) => node.textContent?.includes("↑ 100.0%"));

      expect(value).toBeTruthy();
      expect(delta).toBeTruthy();
      expect(value?.parentElement).toBe(delta?.parentElement);
    } finally {
      await cleanup(container, root);
    }
  });

  it("explains that audience snapshots cannot use period or object filters", async () => {
    const { container, root } = await renderAnalytics(baseInput, "?period=7d", "audience");

    try {
      expect(container.textContent).toContain("All available audience data");
      expect(container.textContent).toContain("no per-row dates or artist/release links");
      expect(container.querySelector('[aria-label="Filter analytics by artist"]')).toBeNull();
      expect([...container.querySelectorAll("button")].some((button) => button.textContent === "7D")).toBe(false);
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders visible trend bars when valid observations are present", async () => {
    const { html, container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    }, "?period=7d", "trends");

    expect(html).toContain("rounded-t");
    expect(html).not.toContain("No trend rows for this period.");
    await cleanup(container, root);
  });

  it("gives each trend bar a full-height positioning context", async () => {
    const { container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    }, "?period=7d", "trends");

    try {
      const bars = [...container.querySelectorAll<HTMLElement>('[role="img"]')];
      expect(bars).toHaveLength(2);
      expect(bars.every((bar) => bar.classList.contains("h-full"))).toBe(true);
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders explicit empty trend state", async () => {
    const { html, container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [],
    }, "?period=7d", "trends");

    expect(html).toContain("No trend rows for this period.");
    await cleanup(container, root);
  });

  it("renders explicit invalid trend state when rows cannot be interpreted", async () => {
    const { html, container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [
        { date: "not-a-date", platform: "spotify", source: "radio", streams: 10 },
        { date: "2026-07-05", platform: "spotify", source: "radio", streams: "bad" as unknown as number },
      ],
    }, "?period=7d", "trends");

    expect(html).toContain("Trend data for this period is invalid. Check source dates and numeric stream values.");
    await cleanup(container, root);
  });

  it("renders distinct insufficient trend state when only one unique date point exists", async () => {
    const { html, container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [
        { date: "2026-07-05", platform: "spotify", source: "radio", streams: 12 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 24 },
      ],
    }, "?period=7d", "trends");

    expect(html).toContain("Insufficient trend points for a reliable shape, but visible data is shown.");
    await cleanup(container, root);
  });

  it("renders source-specific metadata instead of implying one source across every panel", async () => {
    const command = buildAnalyticsCommandCenter({
          ...baseInput,
          widgets: [
            { widgetKey: "csv-daily-source-mix", rowCount: 8, trackCount: 0, lastSeenAt: "2026-07-05T08:00:00.000Z" },
            { widgetKey: "csv-track-totals", rowCount: 2, trackCount: 2, lastSeenAt: "2026-07-04T08:00:00.000Z" },
            { widgetKey: "csv-geo-superfans", rowCount: 2, trackCount: 0, lastSeenAt: "2026-07-03T08:00:00.000Z" },
            { widgetKey: "csv-playlists", rowCount: 1, trackCount: 0, lastSeenAt: "2026-07-02T08:00:00.000Z" },
            { widgetKey: "csv-shazams-city", rowCount: 1, trackCount: 0, lastSeenAt: "2026-07-01T08:00:00.000Z" },
          ],
          totalRows: 14,
          totalWidgets: 5,
          dailySources: [
            { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
            { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
          ],
        });
    const html = (["overview", "trends", "audience", "discovery"] as const)
      .map((section) => renderToStaticMarkup(<AnalyticsCommandCenterView command={command} section={section} />))
      .join("");

    expect(html).toContain("Source: Sisense daily source mix");
    expect(html).toContain("Source: Sisense track totals");
    expect(html).toContain("Source: Sisense geo superfans");
    expect(html).toContain("Source: Sisense playlists");
    expect(html).toContain("Source: Sisense shazams by city");
    expect(html).toContain("Reporting: Last 30 days");
    expect(html).toContain("Freshness:");
    expect(html).toContain("Stale threshold: 48 hours");
  });

  it("uses canonical imported widget keys for source freshness metadata", () => {
    const current = new Date().toISOString();
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      widgets: [
        { widgetKey: "spotify-streams-source", rowCount: 8, trackCount: 0, lastSeenAt: current },
        { widgetKey: "apple-streams-source", rowCount: 8, trackCount: 0, lastSeenAt: current },
        { widgetKey: "tracks-by-growth-rate", rowCount: 2, trackCount: 0, lastSeenAt: current },
        { widgetKey: "spotify-superfans-active-streams-city", rowCount: 2, trackCount: 0, lastSeenAt: current },
        { widgetKey: "spotify-playlist-listings", rowCount: 1, trackCount: 0, lastSeenAt: current },
        { widgetKey: "shazams-city", rowCount: 1, trackCount: 0, lastSeenAt: current },
      ],
      lastSeenAt: current,
    });
    const html = (["overview", "audience", "discovery"] as const)
      .map((section) => renderToStaticMarkup(<AnalyticsCommandCenterView command={command} section={section} />))
      .join("");

    expect(html).not.toContain("Last seen: Waiting for import");
    expect(html).toContain("Freshness: <span class=\"font-medium text-green-700 dark:text-green-300\">current</span>");
  });

  it("keeps long catalogue/playlist/shazam labels readable without truncation", async () => {
    const catalogTrack = "Really Long Track Title That Should Wrap on Mobile and not be Truncated";
    const playlistLabel = "Really Long Playlist Label That Should Be Readable on Small Screens Without Truncate";
    const shazamLabel = "Very Long Shazam City Label That Should Wrap Cleanly in Grid Cells";

    const input = {
      ...baseInput,
      tracks: [
        {
          id: "track-long",
          trackTitle: catalogTrack,
          primaryArtist: "True Blue",
          combinedStreams: 1000,
          spotifyStreams: 800,
          appleStreams: 200,
          streamsGrowth: 0.25,
          combinedViews: 500,
          viewsGrowth: 0.1,
        },
      ],
      playlists: [
        {
          id: "playlist-long",
          label: playlistLabel,
          dimensions: { playlist__name: playlistLabel },
          metrics: { streams: 120, latest_position: null },
          lastSeenAt: "2026-07-05",
        },
      ],
      shazams: [
        {
          id: "shazam-long",
          label: shazamLabel,
          dimensions: { city: "A Very Long City Name, Very Long Country", country: "United States" },
          metrics: { shazams: 44 },
          lastSeenAt: "2026-07-05",
        },
      ],
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    };
    const trends = await renderAnalytics(input, "?period=7d", "trends");
    const discovery = await renderAnalytics(input, "?period=7d", "discovery");
    const audience = await renderAnalytics(input, "?period=7d", "audience");

    const labels = [
      ...trends.container.querySelectorAll("p"),
      ...discovery.container.querySelectorAll("p"),
      ...audience.container.querySelectorAll("p"),
    ].filter((node) => [catalogTrack, playlistLabel, shazamLabel].includes(node.textContent ?? ""));
    expect(labels.every((node) => !node.className.includes("truncate"))).toBe(true);
    expect(labels.every((node) => node.className.includes("break-words"))).toBe(true);
    expect(trends.container.textContent).toContain(catalogTrack);
    expect(discovery.container.textContent).toContain(playlistLabel);
    expect(audience.container.textContent).toContain(shazamLabel);

    await cleanup(trends.container, trends.root);
    await cleanup(discovery.container, discovery.root);
    await cleanup(audience.container, audience.root);
  });

  it("keeps every paired list label readable beside its numeric value", async () => {
    const input = {
      ...baseInput,
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    };
    const trends = await renderAnalytics(input, "?period=7d", "trends");
    const audience = await renderAnalytics(input, "?period=7d", "audience");
    const discovery = await renderAnalytics(input, "?period=7d", "discovery");

    const pairedRows = [
      trends.container.querySelector('[title="Cherry-coloured Funk"]')?.parentElement?.parentElement,
      audience.container.querySelector('[title="New York, United States"]')?.parentElement,
      discovery.container.querySelector('[title="radio"]')?.parentElement,
      discovery.container.querySelector('[title="discoverWeekly"]')?.parentElement?.parentElement,
    ];

    expect(pairedRows.every((row) => row?.className.includes("grid-cols-[minmax(0,1fr)_auto]"))).toBe(true);
    expect([trends.html, audience.html, discovery.html].join("")).not.toContain("max-w-0");

    await cleanup(trends.container, trends.root);
    await cleanup(audience.container, audience.root);
    await cleanup(discovery.container, discovery.root);
  });

  it("shows panel-level stale metadata with source-specific sync-run remediation links", async () => {
    const { container, root } = await renderAnalytics({
      ...baseInput,
      tracks: [
        {
          id: "track-a",
          trackTitle: "Cherry-coloured Funk",
          primaryArtist: "True Blue",
          combinedStreams: 1000,
          spotifyStreams: 800,
          appleStreams: 200,
          streamsGrowth: 0.25,
          combinedViews: 500,
          viewsGrowth: 0.1,
        },
      ],
      playlists: [
        {
          id: "playlist-long",
          label: "Playlist that remains healthy",
          dimensions: { playlist__name: "Playlist that remains healthy" },
          metrics: { streams: 120, latest_position: null },
          lastSeenAt: "2026-07-05",
        },
      ],
      shazams: [
        {
          id: "shazam-a",
          label: "Paris, France",
          dimensions: { city: "Paris", country: "France" },
          metrics: { shazams: 44 },
          lastSeenAt: "2026-07-05",
        },
      ],
      widgets: [
        { widgetKey: "csv-track-totals", rowCount: 2, trackCount: 2, lastSeenAt: "2026-07-05T08:00:00.000Z" },
        { widgetKey: "csv-playlists", rowCount: 6, trackCount: 0, lastSeenAt: "2026-07-01T08:00:00.000Z" },
      ],
      totalRows: 8,
      totalWidgets: 2,
      lastSeenAt: "2026-07-05T09:00:00.000Z",
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    }, "?period=7d", "discovery");

    const playlistPanel = [...container.querySelectorAll("h2")].find((heading) => heading.textContent === "Playlist opportunities");
    const playlistMeta = playlistPanel?.closest("section")?.textContent ?? "";
    const staleLinks = [...container.querySelectorAll('a[href*="#analytics-sync-runs"]')];

    expect(playlistMeta).toContain("Freshness:");
    expect(playlistMeta).toContain("stale");
    expect(playlistMeta).toContain("Affected source:");
    expect(playlistMeta).toContain("Source: Sisense playlists");
    expect(staleLinks.length).toBeGreaterThan(0);

    await cleanup(container, root);
  });

  it("uses responsive grid breakpoints for chart and panel rows", async () => {
    const { html, container, root } = await renderAnalytics({
      ...baseInput,
      dailySources: [
        { date: "2026-07-04", platform: "spotify", source: "radio", streams: 100 },
        { date: "2026-07-05", platform: "apple", source: "radio", streams: 50 },
      ],
    }, "?period=7d", "overview");

    expect(html).toContain("md:grid-cols-2 xl:grid-cols-5");
    expect(html).toContain("grid gap-4 md:grid-cols-2 xl:grid-cols-4");
    await cleanup(container, root);
  });

  it("renders explicit stale banner and actionable sync run link", async () => {
    const staleCommand: BuildAnalyticsCommandCenterInput = {
      ...baseInput,
      lastSeenAt: "2026-06-01T08:00:00.000Z",
      widgets: [
        { widgetKey: "csv-playlists", rowCount: 6, trackCount: 0, lastSeenAt: "2026-06-01T08:00:00.000Z" },
        { widgetKey: "csv-track-totals", rowCount: 6, trackCount: 0, lastSeenAt: "2026-07-05T08:00:00.000Z" },
      ],
      runHistory: [{ status: "completed", completedAt: "2026-06-01T08:00:00.000Z", rowsImported: 4, rowsInserted: 1, rowsUpdated: 0, rowsUnchanged: 0, filesDownloaded: 1, error: null }],
      dailySources: [{ date: "2026-07-05", platform: "spotify", source: "radio", streams: 120 }],
    };
    const html = renderToStaticMarkup(<AnalyticsCommandCenterView command={buildAnalyticsCommandCenter(staleCommand)} section="discovery" />);

    expect(html).toContain("Affected source:");
    expect(html).toContain("Sisense playlists");
    expect(html).toContain(`href="/analytics?section=data-health#analytics-sync-runs"`);
  });

  it("clears filters to the current pathname", async () => {
    stubWindow({ pathname: "/analytics", search: "?artist=artist-a&release=release-a&platform=spotify" });
    const command = buildAnalyticsCommandCenter({
      ...baseInput,
      filter: { artistId: "artist-a", releaseId: "release-a", platforms: ["spotify"] },
      dailySources: [{ date: "2026-07-05", platform: "spotify", source: "radio", streams: 120 }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AnalyticsCommandCenterView command={command} section="overview" />);
    });

    const clearButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Clear all filters");

    expect(clearButton).toBeTruthy();
    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect((window.location as Location).href).toBe("/analytics");

    await cleanup(container, root);
  });

  it("preserves the workspace section and existing scope when changing the release filter", async () => {
    const { container, root } = await renderAnalytics(
      {
        ...baseInput,
        filter: { artistId: "artist-a", platforms: ["spotify"] },
      },
      "?section=trends&period=30d&artist=artist-a&platform=spotify",
      "trends",
    );

    const releaseFilter = container.querySelector('button[aria-label="Filter analytics by release"]');
    expect(releaseFilter).toBeTruthy();
    await act(async () => {
      releaseFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const releaseOption = [...document.body.querySelectorAll('[role="option"]')]
      .find((option) => option.textContent?.includes("Artist B — Release B"));
    expect(releaseOption).toBeTruthy();
    await act(async () => {
      releaseOption?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      releaseOption?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });

    const assignedUrl = new URL((window.location as Location).href, "http://localhost");
    expect(assignedUrl.searchParams.get("section")).toBe("trends");
    expect(assignedUrl.searchParams.get("period")).toBe("30d");
    expect(assignedUrl.searchParams.get("artist")).toBe("artist-a");
    expect(assignedUrl.searchParams.get("platform")).toBe("spotify");
    expect(assignedUrl.searchParams.get("release")).toBe("release-b");

    await cleanup(container, root);
  });

});

it("offers an import entry point for missing data and retains failed-import guidance", () => {
  const empty = buildAnalyticsCommandCenter({ ...baseInput, tracks: [], cities: [], playlists: [], shazams: [], widgets: [], runHistory: [], totalRows: 0, totalWidgets: 0, totalLinkedTracks: 0, lastSeenAt: null });
  const html = renderToStaticMarkup(<AnalyticsCommandCenterView command={empty} section="overview" />);
  expect(html).toContain("No analytics data has been imported yet");
  expect(html).toContain('href="/analytics?section=data-health"');
  expect(html).not.toContain("Unavailable");
  const failed = renderToStaticMarkup(<AnalyticsCommandCenterView command={{ ...empty, dataHealth: { ...empty.dataHealth, latestRunStatus: "failed" } }} section="overview" />);
  expect(failed).toContain("The latest import failed");
  expect(failed).toContain("Review import");
});
