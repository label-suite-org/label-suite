/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatedTrackSnapshotWorkspace } from "../../server/analytics";
import DatedTrackSnapshotTable from "./DatedTrackSnapshotTable";

const currentRows = [
  {
    id: "row-blue",
    rowKey: "isrc:DKAAA2600001",
    trackId: "track-blue",
    releaseId: "release-blue",
    trackTitle: "Blue",
    primaryArtist: "True Blue",
    appTrackTitle: "Blue",
    releaseTitle: "Blue EP",
    combinedStreams: 54_294,
    spotifyStreams: 50_000,
    appleStreams: 4_294,
    amazonStreams: 0,
    pandoraStreams: 0,
    streamsGrowth: 4.2,
    youtubeViews: 1_200,
    tiktokViews: 300,
    combinedViews: 1_500,
    viewsGrowth: 2.1,
    lastSeenAt: "2026-08-08T09:01:00.000Z",
  },
  {
    id: "row-sky",
    rowKey: "source:sky",
    trackId: null,
    releaseId: null,
    trackTitle: "Sky",
    primaryArtist: "True Blue",
    appTrackTitle: null,
    releaseTitle: null,
    combinedStreams: 2_026,
    spotifyStreams: 2_026,
    appleStreams: 0,
    amazonStreams: 0,
    pandoraStreams: 0,
    streamsGrowth: -1.5,
    youtubeViews: 0,
    tiktokViews: 0,
    combinedViews: 0,
    viewsGrowth: null,
    lastSeenAt: "2026-08-08T09:01:00.000Z",
  },
] satisfies NonNullable<DatedTrackSnapshotWorkspace["latest"]>["rows"];

function workspace(overrides: Partial<DatedTrackSnapshotWorkspace> = {}): DatedTrackSnapshotWorkspace {
  const latest = {
    runId: "run-current",
    fileId: "file-current",
    fileName: "Tracks-by-Growth-Rate.csv",
    sha256: "a".repeat(64),
    sha256Prefix: "a".repeat(12),
    importedAt: new Date("2026-08-08T09:01:00.000Z"),
    requestedDateRange: "2026-08-01 to 2026-08-08",
    requestedAggregation: "Daily",
    reportingFrom: "2026-08-01",
    reportingThrough: "2026-08-08",
    sourceRowCount: 3,
    uniqueTrackCount: 2,
    matchedCount: 1,
    unmatchedCount: 1,
    ambiguousCount: 0,
    exactDuplicateCount: 1,
    cumulativeStreams: 56_320,
    cumulativeViews: 1_500,
    rows: currentRows,
    rowsPage: { limit: 100, offset: 0, returnedCount: 2, totalCount: 2, hasMore: false },
  };
  return {
    latest,
    history: [latest],
    historyPage: { limit: 25, offset: 0, returnedCount: 1, hasMore: false },
    legacy: { status: "available", recordCount: 0, rows: [] },
    ...overrides,
  };
}

async function renderTable(
  snapshot = workspace(),
  onRefreshCurrentEvidence?: () => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DatedTrackSnapshotTable
        workspace={snapshot}
        selectedArtistId="artist-a"
        onRefreshCurrentEvidence={onRefreshCurrentEvidence}
      />,
    );
  });
  return { container, root };
}

async function cleanup(container: HTMLElement, root: Root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DatedTrackSnapshotTable", () => {
  it("presents the latest dated snapshot as cumulative provider evidence", async () => {
    const { container, root } = await renderTable();
    try {
      expect(container.querySelector("h2")?.textContent).toBe("Latest dated track snapshot");
      expect(container.textContent).toContain("2 unique tracks");
      expect(container.textContent).toContain("Cumulative streams");
      expect(container.textContent).toContain("Cumulative views");
      expect(container.textContent).toContain("1,500");
      expect(container.textContent).toContain("2026-08-01 to 2026-08-08 · Daily");
      expect(container.textContent).toContain("Reporting through 2026-08-08");
      expect(container.textContent).not.toContain("Avg growth");
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders one accessible sortable row per identity with explicit match and growth context", async () => {
    const base = workspace();
    const snapshot = workspace({
      latest: {
        ...base.latest!,
        rows: [currentRows[0], { ...currentRows[0], id: "duplicate-blue" }, currentRows[1]],
      },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      expect(container.textContent).toContain(
        "Growth is the provider-reported comparison between dated snapshots",
      );
      const table = container.querySelector("table");
      expect(table?.querySelector("caption")?.textContent).toContain("Current Sisense track snapshot");
      expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(table?.textContent).toContain("Matched to catalog");
      expect(table?.textContent).toContain("Unmatched source row");
      for (const heading of [
        "Release",
        "Spotify",
        "Apple",
        "Amazon",
        "Pandora",
        "Combined views",
        "View growth",
        "Reporting context",
      ]) {
        expect(table?.querySelector("thead")?.textContent).toContain(heading);
      }
      expect(table?.textContent).toContain("Blue EP");
      expect(table?.textContent).toContain("Through 2026-08-08");

      const region = table?.parentElement;
      expect(region?.getAttribute("role")).toBe("region");
      expect(region?.tabIndex).toBe(0);
      expect(region?.className).toContain("overflow-x-auto");

      const trackSort = [...(table?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent?.includes("Track")) as HTMLButtonElement | undefined;
      expect(trackSort).toBeTruthy();
      trackSort?.focus();
      expect(document.activeElement).toBe(trackSort);
      await act(async () => trackSort?.click());
      expect(trackSort?.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
      expect(table?.querySelector("tbody tr td")?.textContent).toContain("Blue");
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders Sisense growth as percentage points and safely omits missing or non-finite values", async () => {
    const base = workspace();
    const snapshot = workspace({
      latest: {
        ...base.latest!,
        rows: [
          currentRows[0],
          currentRows[1],
          { ...currentRows[0], id: "row-null", rowKey: "source:null", trackTitle: "No Growth", streamsGrowth: null },
          { ...currentRows[0], id: "row-infinite", rowKey: "source:infinite", trackTitle: "Invalid Growth", streamsGrowth: Number.POSITIVE_INFINITY },
        ],
      },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      const rows = [...container.querySelectorAll("tbody tr")];
      const growthFor = (trackTitle: string) => rows
        .find((row) => row.querySelector("td")?.textContent?.includes(trackTitle))
        ?.querySelectorAll("td")[8]?.textContent;

      expect(growthFor("Blue")).toBe("4.2%");
      expect(growthFor("Sky")).toBe("-1.5%");
      expect(growthFor("No Growth")).toBe("—");
      expect(growthFor("Invalid Growth")).toBe("—");
      expect(container.textContent).not.toContain("420.0%");
      expect(container.textContent).not.toContain("-150.0%");
    } finally {
      await cleanup(container, root);
    }
  });

  it("keeps earlier snapshot metadata and bounded undated legacy QA records in collapsed disclosures", async () => {
    const base = workspace();
    const earlier = {
      runId: "run-earlier",
      fileId: "file-earlier",
      fileName: "earlier.csv",
      sha256: "b".repeat(64),
      sha256Prefix: "b".repeat(12),
      importedAt: new Date("2026-08-01T09:01:00.000Z"),
      requestedDateRange: "2026-07-01 to 2026-07-31",
      requestedAggregation: "Weekly",
      reportingFrom: "2026-07-01",
      reportingThrough: "2026-07-31",
      sourceRowCount: 2,
      uniqueTrackCount: 2,
      matchedCount: 2,
      unmatchedCount: 0,
      ambiguousCount: 0,
      exactDuplicateCount: 1,
    };
    const legacyRows = Array.from({ length: 101 }, (_, index) => ({
      ...currentRows[index % currentRows.length],
      id: `legacy-${index}`,
      trackTitle: `Legacy ${index + 1}`,
    }));
    const snapshot = workspace({
      history: [base.latest!, earlier],
      historyPage: { limit: 2, offset: 0, returnedCount: 2, hasMore: true },
      legacy: { status: "available", recordCount: 95, rows: legacyRows },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      const disclosures = [...container.querySelectorAll("details")];
      expect(disclosures).toHaveLength(2);
      expect(disclosures.every((details) => !details.open)).toBe(true);
      expect(disclosures[0].querySelector("summary")?.textContent).toContain("Earlier dated snapshots");
      expect(disclosures[0].textContent).toContain("2026-07-01 to 2026-07-31 · Weekly");
      expect(disclosures[0].textContent).toContain(`SHA-256 ${"b".repeat(12)}`);
      expect(disclosures[0].textContent).toContain(
        "Matched 2 · Unmatched 0 · Ambiguous 0 · Exact duplicates 1",
      );
      expect(disclosures[0].textContent).toContain("Additional earlier snapshots are not shown on this page");
      expect(disclosures[0].textContent).not.toContain("Cumulative streams");

      expect(disclosures[1].querySelector("summary")?.textContent).toContain("Undated legacy records · 95 records");
      expect(disclosures[1].textContent).toContain(
        "These records predate reporting-period provenance. They are preserved for QA, excluded from current totals, and cannot be used to identify the latest value.",
      );
      expect(disclosures[1].querySelectorAll("tbody tr").length).toBeLessThanOrEqual(100);
      expect(disclosures[1].textContent).not.toContain("Avg growth");
    } finally {
      await cleanup(container, root);
    }
  });

  it("points an empty current snapshot to the importer and distinguishes unavailable legacy evidence from zero", async () => {
    const snapshot = workspace({
      latest: null,
      history: [],
      historyPage: { limit: 25, offset: 0, returnedCount: 0, hasMore: false },
      legacy: { status: "unavailable", recordCount: null, rows: [] },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      expect(container.querySelector("h2")?.textContent).toBe("Latest dated track snapshot");
      expect(container.textContent).toContain("No dated track snapshot is available for this artist.");
      const importerLink = container.querySelector<HTMLAnchorElement>(
        'a[href="#sisense-track-snapshot-import-heading"]',
      );
      expect(importerLink?.textContent).toContain("Import a dated Sisense track snapshot");

      const legacy = [...container.querySelectorAll("details")]
        .find((details) => details.querySelector("summary")?.textContent?.includes("Undated legacy records"));
      expect(legacy?.querySelector("summary")?.textContent).toContain("count unavailable");
      expect(legacy?.textContent).toContain(
        "Legacy records are unavailable in this environment; this is not a zero-record result.",
      );
      expect(legacy?.querySelector("summary")?.textContent).not.toContain("0 records");
    } finally {
      await cleanup(container, root);
    }
  });

  it("labels a bounded current row page while preserving the exact full-snapshot view total", async () => {
    const base = workspace();
    const snapshot = workspace({
      latest: {
        ...base.latest!,
        uniqueTrackCount: 120,
        rowsPage: { limit: 2, offset: 0, returnedCount: 2, totalCount: 120, hasMore: true },
      },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      expect(container.textContent).toContain("120 unique tracks");
      expect(container.textContent).toContain("Showing 2 of 120 unique tracks in this table");
      expect(container.textContent).toContain("Cumulative views1,500");
      expect(container.textContent).not.toContain("Full-snapshot total is not available from this row page");

      const table = container.querySelector("table");
      expect(table?.className).toContain("min-w-[1500px]");
      expect(table?.parentElement?.className).toContain("overflow-x-auto");
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders unavailable optional platform evidence as a dash without hiding valid zeroes", async () => {
    const base = workspace();
    const snapshot = workspace({
      latest: {
        ...base.latest!,
        rows: [{
          ...currentRows[1],
          spotifyStreams: null,
          appleStreams: null,
          amazonStreams: 0,
          pandoraStreams: null,
          combinedViews: null,
          viewsGrowth: null,
        }],
      },
    });
    const { container, root } = await renderTable(snapshot);
    try {
      const cells = [...container.querySelectorAll("tbody tr td")].map((cell) => cell.textContent);
      expect(cells[3]).toBe("—");
      expect(cells[4]).toBe("—");
      expect(cells[5]).toBe("0");
      expect(cells[6]).toBe("—");
      expect(cells[9]).toBe("—");
      expect(cells[10]).toBe("—");
    } finally {
      await cleanup(container, root);
    }
  });

  it("refreshes authoritative evidence after a successful import for the selected artist", async () => {
    const refresh = vi.fn();
    const { container, root } = await renderTable(workspace(), refresh);
    try {
      await act(async () => {
        window.dispatchEvent(new CustomEvent("sisense-track-snapshot-imported", {
          detail: { latest: { artistId: "artist-b" } },
        }));
      });
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        window.dispatchEvent(new CustomEvent("sisense-track-snapshot-imported", {
          detail: { latest: { artistId: "artist-a" } },
        }));
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(container, root);
    }
  });
});

describe("analytics dated snapshot composition", () => {
  it("loads selected-artist evidence, mounts the importer below Spotify, and replaces only the raw track table", () => {
    const page = readFileSync("src/pages/analytics.astro", "utf8");

    expect(page).toContain("listDatedTrackSnapshotWorkspace(orgId, artistParam)");
    expect(page).toContain("artistParam ? listDatedTrackSnapshotWorkspace");
    expect(page).toContain("createProductionSisenseTrackSnapshotService().listLatestByArtist(orgId)");
    expect(page).not.toContain("listAnalyticsTracksByGrowth");
    expect(page).not.toContain("<TracksByGrowthTable");
    expect(page).not.toContain("Full tables for QA and deeper investigation.");
    expect(page).toContain("Bounded source tables for QA and deeper investigation.");

    const spotifyImporter = page.indexOf("<SpotifyCsvImport");
    const sisenseImporter = page.indexOf("<SisenseTrackSnapshotImport");
    const datedTable = page.indexOf("<DatedTrackSnapshotTable");
    expect(spotifyImporter).toBeGreaterThan(-1);
    expect(sisenseImporter).toBeGreaterThan(spotifyImporter);
    expect(datedTable).toBeGreaterThan(sisenseImporter);
    expect(page).toContain('selectedArtistId={artistParam}');

    for (const preserved of [
      "<CitiesByStreams",
      "<SpotifySourceBreakdown",
      "<DemographicsTable",
      "<PlaylistListings",
      "<GenreBenchmarks",
    ]) {
      expect(page).toContain(preserved);
    }
  });

  it("documents the exact two-stage importer action labels", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("**Preview file**");
    expect(readme).toContain("**Import this snapshot**");
    expect(readme).not.toContain("**Preview identity quality**");
    expect(readme).not.toContain("**Import snapshot**");
  });
});
