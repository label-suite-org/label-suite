import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { resolveNewPageDownloadAction } from "./sisense-action-boundary";
import { previousCalendarDayInTimeZone } from "./sisense-date-range";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const npmCli = process.env.npm_execpath;

type DashboardFixture = { close: () => Promise<void>; filterEvents: string[]; url: string };
type PortalTracksMenuShape = "single" | "stale" | "ambiguous";
type WidgetTarget = { key: string; title: string; downloadLabel?: string; menuSelector?: string };

async function startDashboardFixture(input: {
  activateRequestedRange: boolean;
  applyControl?: "uppercase" | "title-case";
  customRangeInput?: "normalize" | "provider" | "malformed";
  dateRangeClickTarget?: "option" | "label";
  duplicateFilterTrigger?: boolean;
  duplicateSettingsFrame?: boolean;
  duplicateTrackTitle?: boolean;
  initialProviderScopeActive?: boolean;
  initialRequestedRangeActive?: boolean;
  shazamState?: "empty" | "blank" | "delayed-empty" | "within-budget-empty" | "late-empty" | "poll-window-empty";
  shazamMenuState?: "late-ready" | "race-ready" | "poll-window-ready" | "post-click-empty";
  portalTracksMenuShape?: PortalTracksMenuShape;
  portalAppleMenu?: boolean;
  portalPlaylistMenu?: boolean;
}): Promise<DashboardFixture> {
  const filterEvents: string[] = [];
  const server = createServer((request, response) => {
    const filterEvent = request.url?.match(/^\/filter-event\/([^?]+)/)?.[1];
    if (filterEvent) {
      filterEvents.push(decodeURIComponent(filterEvent));
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/duplicate.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=duplicate.csv" });
      response.end("Track,Streams\nWrong Track,1\n");
      return;
    }
    if (request.url === "/tracks.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=tracks.csv" });
      response.end("Track,Streams\nTrack One,19\n");
      return;
    }
    if (request.url === "/apple.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=apple.csv" });
      response.end("Date,Source,Streams\n2026-07-30,Search,7\n");
      return;
    }
    if (request.url === "/playlist.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=playlist.csv" });
      response.end("Playlist,Track,Streams\nRelease Radar,Track One,23\n");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
      <button id="filters">FILTERS</button>
      <section id="filter-panel">
        <div class="filters-bar invisible">
          <div class="filters">
            <div class="filter-group">
              <span class="dimension-name">True_Nature_Artists</span>
              <div class="filter" id="artist-summary"><span class="label">${input.initialProviderScopeActive === false ? "Another Artist" : "True Blue"}</span></div>
            </div>
            <div class="filter-group">
              <span class="dimension-name">True_Nature_Tracks</span>
              <div class="filter" id="track-summary"><span class="label">${input.initialProviderScopeActive === false ? "Another Track" : "cherry-coloured funk"}</span></div>
            </div>
            <div class="filter-group">
              <span class="dimension-name">Aggregation</span>
              <div class="filter" id="aggregation-summary"><span class="label">Daily</span></div>
            </div>
            <div class="filter-group">
              <span class="dimension-name">DateRange</span>
              <div class="filter" id="date-range-summary"><span class="label">${input.initialRequestedRangeActive ? "All Dates" : "14 Days"}</span></div>
            </div>
          </div>
        </div>
        <div class="dashboard-settings-frame">
          <div class="setting dimension-setting" id="artist-editor" hidden>
            <div class="setting-header">True_Nature_Artists</div>
            <div class="values-selection exclusive">
              <input class="search-input" />
              <div class="checkbox-list">
                <div class="checkbox small-radio-button ${input.initialProviderScopeActive === false ? "" : "selected"}"><div class="label">True Blue</div></div>
                <div class="checkbox small-radio-button ${input.initialProviderScopeActive === false ? "selected" : ""}"><div class="label">Another Artist</div></div>
              </div>
            </div>
          </div>
          <div class="setting dimension-setting" id="track-editor" hidden>
            <div class="setting-header">True_Nature_Tracks</div>
            <div class="values-selection exclusive">
              <input class="search-input" />
              <div class="checkbox-list">
                <div class="checkbox small-radio-button ${input.initialProviderScopeActive === false ? "" : "selected"}"><div class="label">cherry-coloured funk</div></div>
                <div class="checkbox small-radio-button ${input.initialProviderScopeActive === false ? "selected" : ""}"><div class="label">Another Track</div></div>
              </div>
            </div>
          </div>
          <div class="setting dimension-setting aggregation-setting" id="aggregation-editor" hidden>
            <div class="small-radio-button selected">Daily (DEFAULT)</div>
            <div class="small-radio-button">Weekly (DEFAULT)</div>
          </div>
          <div class="setting dimension-setting" id="date-range-editor" hidden>
            <div class="date-range-dropdown">
              ${input.dateRangeClickTarget === "label"
                ? '<div class="small-radio-button" style="width:400px;height:40px"><div class="label" style="display:inline-block;width:80px">Custom Range (DEFAULT)</div></div>'
                : "<div>Custom Range (DEFAULT)</div>"}
              <div>Current Week (DEFAULT)</div>
              <div>Last Week (DEFAULT)</div>
              <div>Current Month (DEFAULT)</div>
              <div>All Dates (DEFAULT)</div>
              <div>365 Days (DEFAULT)</div>
              <div>180 Days (DEFAULT)</div>
              <div>90 Days (DEFAULT)</div>
              <div>60 Days (DEFAULT)</div>
              <div>30 Days (DEFAULT)</div>
              <div>14 Days (DEFAULT)</div>
              ${input.dateRangeClickTarget === "label"
                ? '<div class="small-radio-button" style="width:400px;height:40px"><div class="label" style="display:inline-block;width:80px">7 Days (DEFAULT)</div></div>'
                : "<div>7 Days (DEFAULT)</div>"}
              <div>3 Days (DEFAULT)</div>
              <div>1 Day (DEFAULT)</div>
            </div>
            <div id="custom-range" hidden>
              <input aria-label="Custom range start" />
              <input aria-label="Custom range end" />
            </div>
          </div>
          <div class="bottom-menu-frame">
            <div id="apply" class="button action-medium apply-button"><div class="label">${input.applyControl === "title-case" ? "Apply" : "APPLY"}</div></div>
          </div>
        </div>
      </section>
      ${input.duplicateSettingsFrame ? "<div class=\"dashboard-settings-frame\"><div class=\"bottom-menu-frame\"><button id=\"decoy-frame-apply\">APPLY</button></div></div>" : ""}
      <aside>
        <div class="filter-group active-looking">
          <span class="dimension-name">Aggregation</span>
          <div class="filter"><span class="label">Daily</span></div>
        </div>
        <button id="decoy-yesterday">Yesterday</button>
        <button id="decoy-apply">APPLY</button>
        ${input.duplicateFilterTrigger ? "<button id=\"decoy-filters\">FILTERS</button>" : ""}
      </aside>
      ${input.duplicateTrackTitle ? `<section class="widget-container">
        <h2>Tracks by Growth Rate</h2>
        <button aria-label="More Options" id="duplicate-tracks-more">More Options</button>
        <div id="duplicate-tracks-menu" hidden><a href="/duplicate.csv" download>Download Data 1 Row</a></div>
      </section>` : ""}
      <section class="widget-container">
        <h2>Tracks by Growth Rate</h2>
        ${input.portalTracksMenuShape ? "<div name=\"expand\" id=\"tracks-more\">More Options</div>" : "<button aria-label=\"More Options\" id=\"tracks-more\">More Options</button>"}
        ${input.portalTracksMenuShape ? "" : "<div id=\"tracks-menu\" hidden><a href=\"/tracks.csv\" download>Download Data 19 Rows</a></div>"}
      </section>
      ${input.portalAppleMenu ? `<section class="widget-container">
        <h2>Apple Streams by Source</h2>
        <button aria-label="More Options" id="apple-more">More Options</button>
      </section>` : ""}
      ${input.portalPlaylistMenu ? `<section class="widget-container" id="playlist-widget">
        <h2>Spotify Playlist Listings</h2>
        <div name="expand" id="playlist-more" aria-disabled="true" class="disabled" style="pointer-events: none">More Options</div>
      </section>` : ""}
      ${input.portalTracksMenuShape === "stale" ? "<div id=\"stale-download\"><a href=\"/duplicate.csv\" download>Download Data stale export</a></div>" : ""}
      ${input.portalTracksMenuShape === "single" ? "<div id=\"tracks-portal\" hidden><a href=\"/tracks.csv\" download>Download Data 19 Rows</a></div>" : ""}
      ${input.portalTracksMenuShape === "ambiguous" ? "<div id=\"tracks-portal\" hidden><a href=\"/tracks.csv\" download>Download Data CSV</a><a href=\"/duplicate.csv\" download>Download Data XLSX</a></div>" : ""}
      ${input.portalAppleMenu ? "<div id=\"apple-portal\" hidden><a href=\"/apple.csv\" download>Download Data CSV</a></div>" : ""}
      ${input.portalPlaylistMenu ? "<div id=\"playlist-portal\" hidden><a href=\"/playlist.csv\" download>Download Data CSV</a></div>" : ""}
      <section class="widget-container">
        <h2>Shazams by City</h2>
        ${input.shazamState !== "blank" && input.shazamState !== "delayed-empty" && input.shazamState !== "within-budget-empty" && input.shazamState !== "late-empty" && input.shazamState !== "poll-window-empty" ? "<p>Query returned no matching rows.</p>" : ""}
        <button id="shazams-more" aria-label="More Options" disabled style="pointer-events: none">More Options</button>
      </section>
      <script>
        const aggregationSummary = document.getElementById("aggregation-summary");
        const dateRangeSummary = document.getElementById("date-range-summary");
        const artistSummary = document.getElementById("artist-summary");
        const trackSummary = document.getElementById("track-summary");
        const artistEditor = document.getElementById("artist-editor");
        const trackEditor = document.getElementById("track-editor");
        const aggregationEditor = document.getElementById("aggregation-editor");
        const dateRangeEditor = document.getElementById("date-range-editor");
        const dateRangeDropdown = dateRangeEditor.querySelector(".date-range-dropdown");
        const customRange = document.getElementById("custom-range");
        const startInput = document.querySelector("input[aria-label='Custom range start']");
        const endInput = document.querySelector("input[aria-label='Custom range end']");
        const record = (event) => { void fetch("/filter-event/" + encodeURIComponent(event)); };
        const removeDefaultSuffix = (label) => label.replace(/\\s+\\(DEFAULT\\)\\s*$/i, "");
        const normalizeDate = (value) => {
          const match = value.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
          return match ? match[3] + "-" + match[1] + "-" + match[2] : value;
        };
        document.getElementById("filters").addEventListener("click", () => record("filters-opened"));
        const bindProviderEditor = (summary, editor, eventName) => {
          summary.addEventListener("click", () => { editor.hidden = false; });
          editor.querySelectorAll(".checkbox.small-radio-button").forEach((option) => option.addEventListener("click", () => {
            editor.querySelectorAll(".checkbox.small-radio-button").forEach((candidate) => candidate.classList.remove("selected"));
            option.classList.add("selected");
            summary.querySelector(".label").textContent = option.textContent.trim();
            record(eventName + ":" + option.textContent.trim());
          }));
        };
        bindProviderEditor(artistSummary, artistEditor, "artist-select");
        bindProviderEditor(trackSummary, trackEditor, "track-select");
        aggregationSummary.addEventListener("click", () => {
          aggregationEditor.hidden = false;
          record("aggregation-open");
        });
        aggregationEditor.querySelectorAll(".small-radio-button").forEach((option) => option.addEventListener("click", () => {
          aggregationEditor.querySelectorAll(".small-radio-button").forEach((candidate) => candidate.classList.remove("selected"));
          option.classList.add("selected");
          aggregationSummary.querySelector(".label").textContent = removeDefaultSuffix(option.textContent || "");
          record("aggregation-select:" + aggregationSummary.querySelector(".label").textContent);
          record("aggregation-option-selected:" + option.classList.contains("selected"));
          record("aggregation-editor-visible:" + !aggregationEditor.hidden);
        }));
        dateRangeSummary.addEventListener("click", () => {
          dateRangeEditor.hidden = false;
          dateRangeDropdown.hidden = false;
          customRange.hidden = true;
          record("date-range-open");
        });
        dateRangeDropdown.querySelectorAll(":scope > div").forEach((option) => {
          const label = removeDefaultSuffix(option.textContent || "");
          const clickTarget = ${JSON.stringify(input.dateRangeClickTarget ?? "option")} === "label"
            ? option.querySelector(":scope > div.label")
            : option;
          clickTarget?.addEventListener("click", () => {
            dateRangeDropdown.querySelectorAll(":scope > div").forEach((candidate) => candidate.classList.remove("selected"));
            option.classList.add("selected");
            record("date-range-select:" + label);
            record("date-range-option-selected:" + option.classList.contains("selected"));
            record("date-range-dropdown-visible:" + !dateRangeDropdown.hidden);
            if (label === "Custom Range") {
              customRange.hidden = false;
              record("custom-range-controls-visible:" + [startInput, endInput].filter((input) => !input.hidden).length);
              return;
            }
            if (${input.activateRequestedRange}) dateRangeSummary.querySelector(".label").textContent = label;
          });
        });
        [startInput, endInput].forEach((input) => input.addEventListener("input", () => {
          if (${JSON.stringify(input.customRangeInput ?? "normalize")} === "normalize") input.value = normalizeDate(input.value);
          if (${JSON.stringify(input.customRangeInput ?? "normalize")} === "malformed") input.value = "not-a-date";
          record("custom-range-filled:" + input.value);
        }));
        document.getElementById("apply").addEventListener("click", () => {
          if (!customRange.hidden && startInput.value && endInput.value && ${input.activateRequestedRange}) {
            dateRangeSummary.querySelector(".label").textContent = normalizeDate(startInput.value) + " to " + normalizeDate(endInput.value);
          }
          record("filters-applied");
          record("aggregation-summary:" + aggregationSummary.querySelector(".label").textContent);
          record("date-range-summary:" + dateRangeSummary.querySelector(".label").textContent);
        });
        document.getElementById("decoy-yesterday").addEventListener("click", () => record("decoy-yesterday-clicked"));
        document.getElementById("decoy-apply").addEventListener("click", () => record("decoy-apply-clicked"));
        document.getElementById("decoy-filters")?.addEventListener("click", () => record("decoy-filters-clicked"));
        document.getElementById("decoy-frame-apply")?.addEventListener("click", () => record("decoy-frame-apply-clicked"));
        document.getElementById("duplicate-tracks-more")?.addEventListener("click", () => { document.getElementById("duplicate-tracks-menu").hidden = false; });
        document.getElementById("tracks-more").addEventListener("click", () => {
          const inlineMenu = document.getElementById("tracks-menu");
          const portalMenu = document.getElementById("tracks-portal");
          if (inlineMenu) inlineMenu.hidden = false;
          if (portalMenu) portalMenu.hidden = false;
        });
        document.getElementById("apple-more")?.addEventListener("click", () => { document.getElementById("apple-portal").hidden = false; });
        const playlistMore = document.getElementById("playlist-more");
        if (playlistMore) {
          let playlistReady = false;
          let playlistReadyTimerStarted = false;
          const startPlaylistReadyTimer = () => {
            if (playlistReadyTimerStarted) return;
            playlistReadyTimerStarted = true;
            setTimeout(() => {
              playlistReady = true;
              playlistMore.classList.remove("disabled");
              playlistMore.removeAttribute("aria-disabled");
              playlistMore.style.pointerEvents = "auto";
            }, 3200);
          };
          playlistMore.parentElement?.addEventListener("mouseenter", startPlaylistReadyTimer);
          playlistMore.addEventListener("click", () => {
            if (!playlistReady) return;
            document.getElementById("playlist-portal").hidden = false;
          });
        }
        ${input.shazamState === "delayed-empty" ? 'setTimeout(() => { const widget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); if (widget) { const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; widget.prepend(message); } }, 3200);' : ""}
        ${input.shazamState === "within-budget-empty" ? 'const shazamWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); let withinBudgetHoverStarted = false; shazamWidget?.addEventListener("mouseover", () => { if (withinBudgetHoverStarted) return; withinBudgetHoverStarted = true; setTimeout(() => { const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; shazamWidget.prepend(message); const request = new XMLHttpRequest(); request.open("GET", "/filter-event/within-budget-empty-rendered", false); request.send(); }, 250); });' : ""}
        ${input.shazamState === "late-empty" ? 'const shazamWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); let lateEmptyHoverStarted = false; shazamWidget?.addEventListener("mouseover", () => { if (lateEmptyHoverStarted) return; lateEmptyHoverStarted = true; const started = performance.now(); while (performance.now() - started < 500) {} const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; shazamWidget.prepend(message); const request = new XMLHttpRequest(); request.open("GET", "/filter-event/late-empty-rendered", false); request.send(); });' : ""}
        ${input.shazamState === "poll-window-empty" ? 'const pollWindowEmptyWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); let pollWindowEmptyHoverStarted = false; pollWindowEmptyWidget?.addEventListener("mouseover", () => { if (pollWindowEmptyHoverStarted) return; pollWindowEmptyHoverStarted = true; setTimeout(() => { const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; pollWindowEmptyWidget.prepend(message); const request = new XMLHttpRequest(); request.open("GET", "/filter-event/poll-window-empty-rendered", false); request.send(); }, 250); });' : ""}
        ${input.shazamMenuState === "late-ready" ? 'const shazamWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); const shazamsMore = document.getElementById("shazams-more"); shazamsMore?.addEventListener("click", () => { const request = new XMLHttpRequest(); request.open("GET", "/filter-event/late-menu-clicked", false); request.send(); }); let lateReadyStarted = false; shazamWidget?.addEventListener("mouseover", () => { if (lateReadyStarted) return; lateReadyStarted = true; setTimeout(() => { shazamsMore?.removeAttribute("disabled"); if (shazamsMore) shazamsMore.style.pointerEvents = "auto"; }, 450); });' : ""}
        ${input.shazamMenuState === "poll-window-ready" ? 'const pollWindowMenuWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); const shazamsMore = document.getElementById("shazams-more"); shazamsMore?.addEventListener("click", () => { const request = new XMLHttpRequest(); request.open("GET", "/filter-event/poll-window-menu-clicked", false); request.send(); }); let pollWindowReadyStarted = false; pollWindowMenuWidget?.addEventListener("mouseover", () => { if (pollWindowReadyStarted) return; pollWindowReadyStarted = true; setTimeout(() => { shazamsMore?.removeAttribute("disabled"); if (shazamsMore) shazamsMore.style.pointerEvents = "auto"; const request = new XMLHttpRequest(); request.open("GET", "/filter-event/poll-window-menu-ready", false); request.send(); }, 250); });' : ""}
        ${input.shazamMenuState === "race-ready" ? 'const shazamWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); const shazamsMore = document.getElementById("shazams-more"); shazamsMore?.addEventListener("click", () => { const request = new XMLHttpRequest(); request.open("GET", "/filter-event/race-menu-clicked", false); request.send(); }); let raceStarted = false; shazamWidget?.addEventListener("mouseover", () => { if (raceStarted) return; raceStarted = true; setTimeout(() => { const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; shazamWidget.prepend(message); shazamsMore?.removeAttribute("disabled"); if (shazamsMore) shazamsMore.style.pointerEvents = "auto"; const emptyMarker = new XMLHttpRequest(); emptyMarker.open("GET", "/filter-event/race-empty-rendered", false); emptyMarker.send(); const menuMarker = new XMLHttpRequest(); menuMarker.open("GET", "/filter-event/race-menu-ready", false); menuMarker.send(); }, 55); });' : ""}
        ${input.shazamMenuState === "post-click-empty" ? 'const shazamWidget = [...document.querySelectorAll(".widget-container")].find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Shazams by City"); const shazamsMore = document.getElementById("shazams-more"); shazamsMore?.removeAttribute("disabled"); if (shazamsMore) shazamsMore.style.pointerEvents = "auto"; shazamsMore?.addEventListener("click", () => { const message = document.createElement("p"); message.textContent = "Query returned no matching rows."; shazamWidget?.prepend(message); });' : ""}
      </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port.");
  return { close: () => closeServer(server), filterEvents, url: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function runScrape(input: {
  dashboardUrl: string;
  artistName?: string | null;
  dateRange?: string;
  downloadTimeoutMs?: number;
  downloadDir: string;
  importFile?: boolean;
  mode?: "import" | "scrape" | "sync";
  skipFilters?: boolean;
  schema?: string;
  timeZone?: string;
  widgets?: WidgetTarget[];
  actionTimeoutMs?: number;
  providerArtistFilter?: string;
  providerTrackFilter?: string;
  trackTitle?: string | null;
}): Promise<{ status: number | null; output: string }> {
  const { DATABASE_URL: _databaseUrl, SISENSE_DASHBOARD_URL: _dashboardUrl, SISENSE_WIDGETS_JSON: _widgets, SISENSE_SKIP_FILTERS: _skipFilters, SISENSE_RESET_FILTERS: _resetFilters, SISENSE_TIME_ZONE: _timeZone, SISENSE_DB_SCHEMA: _schema, SISENSE_SCOPE_ARTIST_NAME: _artistName, SISENSE_SCOPE_TRACK_TITLE: _trackTitle, SISENSE_PROVIDER_ARTIST_FILTER: _providerArtistFilter, SISENSE_PROVIDER_TRACK_FILTER: _providerTrackFilter, SISENSE_DOWNLOAD_TIMEOUT_MS: _downloadTimeout, ...environment } = process.env;
  return await new Promise((resolve, reject) => {
    const mode = input.mode ?? "scrape";
    const args = [npmCli!, "run", "sisense:sync", "--", "--mode", mode];
    args.push(...(mode === "import"
      ? [input.importFile ? "--file" : "--dir", input.downloadDir]
      : ["--date-range", input.dateRange ?? "All Dates", "--aggregation", "Daily", "--download-dir", input.downloadDir]));
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...environment,
        DATABASE_URL: "",
        SISENSE_DASHBOARD_URL: input.dashboardUrl,
        SISENSE_ACTION_TIMEOUT_MS: String(input.actionTimeoutMs ?? 2000),
        SISENSE_DOWNLOAD_TIMEOUT_MS: String(input.downloadTimeoutMs ?? 5000),
        ...(input.artistName === null ? {} : { SISENSE_SCOPE_ARTIST_NAME: input.artistName ?? "True Blue" }),
        ...(input.trackTitle === null ? {} : { SISENSE_SCOPE_TRACK_TITLE: input.trackTitle ?? "cherry-coloured funk" }),
        ...(input.providerArtistFilter ? { SISENSE_PROVIDER_ARTIST_FILTER: input.providerArtistFilter } : {}),
        ...(input.providerTrackFilter ? { SISENSE_PROVIDER_TRACK_FILTER: input.providerTrackFilter } : {}),
        SISENSE_TIME_ZONE: input.timeZone ?? "Europe/Copenhagen",
        ...(input.skipFilters ? { SISENSE_SKIP_FILTERS: "true" } : {}),
        ...(input.schema ? { SISENSE_DB_SCHEMA: input.schema } : {}),
        SISENSE_WIDGETS_JSON: JSON.stringify(input.widgets ?? [
          { key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" },
          { key: "shazams-city", title: "Shazams by City" },
        ]),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}

async function readScrapeRun(directory: string): Promise<{ runDir: string; manifest: { files: Array<{ fileName: string; widgetKey: string }>; completeness: Record<string, unknown>; providerFilterState: Record<string, unknown> } }> {
  const [orgDirectory] = await readdir(directory);
  const [runDirectory] = await readdir(path.join(directory, orgDirectory));
  const runDir = path.join(directory, orgDirectory, runDirectory);
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json"), "utf8")) as {
    files: Array<{ fileName: string; widgetKey: string }>;
    completeness: Record<string, unknown>;
    providerFilterState: Record<string, unknown>;
  };
  return { runDir, manifest };
}

async function readDiagnosticSummary(runDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(runDir, "diagnostic-summary.json"), "utf8")) as Record<string, unknown>;
}

describe("Sisense browser contract", () => {
  it("emits one sanitized configuration failure marker when scrape exits through the top-level error path", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-diagnostic-failure-"));

    try {
      const result = await runScrape({
        dashboardUrl: "",
        downloadDir: directory,
      });

      expect(result.status).toBe(1);
      expect(result.output.split("\n").filter((line) => line.startsWith("SISENSE_DIAGNOSTIC_FAILURE "))).toEqual([
        'SISENSE_DIAGNOSTIC_FAILURE {"version":1,"code":"configuration"}',
      ]);
      expect(result.output).not.toContain("SISENSE_DIAGNOSTIC_SUMMARY");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("emits one sanitized configuration failure marker for an invalid schema", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-invalid-schema-"));

    try {
      const result = await runScrape({
        dashboardUrl: "http://127.0.0.1:1",
        downloadDir: directory,
        schema: "bad-name",
      });
      const markerLines = result.output.split("\n").filter((line) => line.startsWith("SISENSE_DIAGNOSTIC_FAILURE "));

      expect(result.status).toBe(1);
      expect(markerLines).toEqual([
        'SISENSE_DIAGNOSTIC_FAILURE {"version":1,"code":"configuration"}',
      ]);
      expect(markerLines.join("\n")).not.toContain("bad-name");
      expect(markerLines.join("\n")).not.toContain("Invalid SQL identifier");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a sanitized scrape diagnostic summary and emits one matching marker", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalAppleMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-diagnostic-summary-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        dateRange: "7 Days",
        downloadDir: directory,
        widgets: [
          { key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" },
          { key: "apple-streams-source", title: "Apple Streams by Source" },
          { key: "shazams-city", title: "Shazams by City" },
        ],
      });

      expect(result.status).toBe(0);
      const { runDir } = await readScrapeRun(directory);
      const summary = await readDiagnosticSummary(runDir);
      const expectedFiles = [
        {
          widgetKey: "apple-streams-source",
          rowCount: 1,
          sha256: createHash("sha256").update("Date,Source,Streams\n2026-07-30,Search,7\n").digest("hex"),
        },
        {
          widgetKey: "tracks-by-growth-rate",
          rowCount: 1,
          sha256: createHash("sha256").update("Track,Streams\nTrack One,19\n").digest("hex"),
        },
      ];

      expect(summary).toMatchObject({
        version: 1,
        mode: "scrape",
        requestedDateRange: "7 Days",
        requestedAggregation: "Daily",
        observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        providerFilterState: { artist: "True Blue", aggregation: "Daily", dateRange: "7 Days", track: "cherry-coloured funk" },
        databaseLockHeld: false,
        effectiveWidgetKeys: ["apple-streams-source", "shazams-city", "tracks-by-growth-rate"],
        effectiveWidgetCount: 3,
        downloadedWidgetKeys: ["apple-streams-source", "tracks-by-growth-rate"],
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
        completenessState: "complete",
        fileCount: 2,
        files: expectedFiles,
      });
      expect(summary.runId).toMatch(/^sisense_\d{14}_[0-9a-f]{8}$/);
      expect(JSON.stringify(summary)).not.toContain(fixture.url);
      expect(JSON.stringify(summary)).not.toContain("Track One");
      expect(JSON.stringify(summary)).not.toContain("Search");

      const markerLines = result.output.split("\n").filter((line) => line.startsWith("SISENSE_DIAGNOSTIC_SUMMARY "));
      expect(markerLines).toHaveLength(1);
      expect(JSON.parse(markerLines[0]!.slice("SISENSE_DIAGNOSTIC_SUMMARY ".length))).toEqual(summary);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not copy custom widget configuration into skipped diagnostic evidence", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "stale" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-diagnostic-skip-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate", downloadLabel: "Operator-only label" }],
      });

      expect(result.status).toBe(0);
      const { runDir } = await readScrapeRun(directory);
      const summary = await readDiagnosticSummary(runDir);
      expect(summary).toMatchObject({
        skippedWidgets: [{
          key: "tracks-by-growth-rate",
          reason: "No uniquely observable export action was available after opening the scoped widget menu.",
        }],
        completenessState: "partial",
        fileCount: 0,
      });
      expect(JSON.stringify(summary)).not.toContain("Operator-only label");
      expect(result.output).not.toContain("Operator-only label");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses to import a partial browser acquisition", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "stale" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-partial-sync-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        artistName: null,
        trackTitle: null,
        downloadDir: directory,
        mode: "sync",
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" }],
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain("Sisense acquisition is partial; refusing to publish incomplete analytics.");
      expect(result.output).not.toContain("Rows imported:");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("selects Daily and Yesterday through their scoped provider dimensions", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, applyControl: "title-case", customRangeInput: "provider", dateRangeClickTarget: "label" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-filter-chip-"));
    const yesterday = previousCalendarDayInTimeZone(new Date(), "Europe/Copenhagen");

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "Yesterday", downloadDir: directory });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Range: Yesterday");
      expect(result.output).toContain("Downloaded tracks-by-growth-rate");
      const expectedFilterEvents = [
        "filters-opened",
        "aggregation-open",
        "aggregation-select:Daily",
        "aggregation-option-selected:true",
        "aggregation-editor-visible:true",
        "date-range-open",
        "date-range-select:Custom Range",
        "date-range-option-selected:true",
        "date-range-dropdown-visible:true",
        "custom-range-controls-visible:2",
        `custom-range-filled:${yesterday.slice(5, 7)}/${yesterday.slice(8, 10)}/${yesterday.slice(0, 4)}`,
        `custom-range-filled:${yesterday.slice(5, 7)}/${yesterday.slice(8, 10)}/${yesterday.slice(0, 4)}`,
        "filters-applied",
        "aggregation-summary:Daily",
        `date-range-summary:${yesterday} to ${yesterday}`,
      ];
      // Fixture telemetry arrives over independent fetches, so network delivery
      // order is not a reliable proxy for the UI action order.
      expect(fixture.filterEvents.slice().sort()).toEqual(expectedFilterEvents.slice().sort());
      expect(fixture.filterEvents.filter((event) => event === "filters-applied")).toHaveLength(1);
      expect(fixture.filterEvents).not.toContain("decoy-yesterday-clicked");
      expect(fixture.filterEvents).not.toContain("decoy-apply-clicked");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("selects and records the configured provider artist and track", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, initialProviderScopeActive: false, portalAppleMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-provider-scope-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        dateRange: "7 Days",
        downloadDir: directory,
        artistName: "True Blue [catalog]",
        trackTitle: "Cherry-coloured Funk [Cover]",
        providerArtistFilter: "True Blue",
        providerTrackFilter: "cherry-coloured funk",
        widgets: [{ key: "apple-streams-source", title: "Apple Streams by Source" }],
      });

      expect(result.status).toBe(0);
      const { manifest } = await readScrapeRun(directory);
      expect(manifest.providerFilterState).toEqual({
        artist: "True Blue",
        aggregation: "Daily",
        dateRange: "7 Days",
        track: "cherry-coloured funk",
      });
      expect(fixture.filterEvents).toContain("artist-select:True Blue");
      expect(fixture.filterEvents).toContain("track-select:cherry-coloured funk");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails before browser launch when track-scoped widgets lack an exact provider scope", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalAppleMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-missing-provider-scope-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        artistName: "True Blue",
        trackTitle: null,
        downloadDir: directory,
        widgets: [{ key: "apple-streams-source", title: "Apple Streams by Source" }],
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain("Track-scoped Sisense widgets require configured artist and track filters.");
      expect(result.output).not.toContain("Downloaded");
      expect(fixture.filterEvents).toEqual([]);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("selects a date preset through the provider label when the option container ignores direct clicks", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, dateRangeClickTarget: "label" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-date-label-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "7 Days", downloadDir: directory });

      expect(result.status).toBe(0);
      expect(result.output).toContain("Downloaded tracks-by-growth-rate");
      expect(fixture.filterEvents).toContain("date-range-select:7 Days");
      expect(fixture.filterEvents).toContain("date-range-option-selected:true");
      expect(fixture.filterEvents).toContain("filters-applied");
      expect(fixture.filterEvents).toContain("date-range-summary:7 Days");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when a Custom Range input is malformed", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, customRangeInput: "malformed" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-custom-range-malformed-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "Yesterday", downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("did not match accepted");
      expect(fixture.filterEvents).not.toContain("filters-applied");
      expect(result.output).not.toContain("Downloaded");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when Yesterday has ambiguous dashboard settings frames", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, duplicateSettingsFrame: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-apply-frame-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "Yesterday", downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Could not resolve exactly one scoped Sisense dashboard settings frame for Apply.");
      expect(fixture.filterEvents).not.toContain("filters-applied");
      expect(fixture.filterEvents).not.toContain("decoy-frame-apply-clicked");
      expect(fixture.filterEvents).not.toContain("decoy-apply-clicked");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("requires Apply for a non-Yesterday preset before downloading", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, duplicateSettingsFrame: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-preset-apply-frame-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "30 Days", downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Could not resolve exactly one scoped Sisense dashboard settings frame for Apply.");
      expect(fixture.filterEvents).not.toContain("filters-applied");
      expect(fixture.filterEvents).not.toContain("decoy-frame-apply-clicked");
      expect(fixture.filterEvents).not.toContain("decoy-apply-clicked");
      expect(result.output).not.toContain("Downloaded");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed before opening an ambiguous pre-open FILTERS trigger", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, duplicateFilterTrigger: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-filter-trigger-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, dateRange: "Yesterday", downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Could not resolve exactly one pre-open Sisense FILTERS trigger.");
      expect(fixture.filterEvents).toEqual([]);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails before downloading when a widget title resolves to duplicate containers", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, duplicateTrackTitle: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-duplicate-title-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Could not resolve exactly one .widget-container for widget 'tracks-by-growth-rate'.");
      expect(result.output).not.toContain("Downloaded");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when the requested range is not visibly active", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: false });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-filter-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, downloadDir: directory });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Requested date range 'All Dates' is not visibly active.");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("skips filter clicks only when visible dashboard defaults already match", async () => {
    const mismatchFixture = await startDashboardFixture({ activateRequestedRange: false });
    const matchFixture = await startDashboardFixture({ activateRequestedRange: false, initialRequestedRangeActive: true });
    const mismatchDirectory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-skip-mismatch-"));
    const matchDirectory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-skip-match-"));

    try {
      const mismatch = await runScrape({ dashboardUrl: mismatchFixture.url, downloadDir: mismatchDirectory, skipFilters: true });
      expect(mismatch.status).toBe(1);
      expect(mismatch.output).toContain("Requested date range 'All Dates' is not visibly active.");

      const match = await runScrape({ dashboardUrl: matchFixture.url, downloadDir: matchDirectory, skipFilters: true });
      expect(match.status).toBe(0);
      expect(match.output).toContain("Skipping Sisense filter UI");
    } finally {
      await mismatchFixture.close();
      await matchFixture.close();
      await rm(mismatchDirectory, { recursive: true, force: true });
      await rm(matchDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("records only the explicit scoped empty state instead of borrowing another widget's export", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-empty-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, downloadDir: directory });
      expect(result.status).toBe(0);
      const [orgDirectory] = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
      const [runDirectory] = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(directory, orgDirectory)));
      const manifest = JSON.parse(await readFile(path.join(directory, orgDirectory, runDirectory, "manifest.json"), "utf8"));
      expect(manifest.files.map((file: { widgetKey: string }) => file.widgetKey)).toEqual(["tracks-by-growth-rate"]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("downloads tracks by growth through one newly visible portaled action", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "single" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-tracks-portal-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Downloaded tracks-by-growth-rate");
      expect(result.output).not.toContain("Skipped tracks-by-growth-rate");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([expect.objectContaining({ widgetKey: "tracks-by-growth-rate" })]);
      expect(await readFile(path.join(runDir, manifest.files[0].fileName), "utf8")).toBe("Track,Streams\nTrack One,19\n");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("downloads Apple streams by source through one newly visible portaled action", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalAppleMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-apple-portal-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "apple-streams-source", title: "Apple Streams by Source" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Downloaded apple-streams-source");
      expect(result.output).not.toContain("Skipped apple-streams-source");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([expect.objectContaining({ widgetKey: "apple-streams-source" })]);
      expect(await readFile(path.join(runDir, manifest.files[0].fileName), "utf8")).toBe("Date,Source,Streams\n2026-07-30,Search,7\n");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("waits for the scoped Spotify Playlist Listings menu to become actionable", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalPlaylistMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-playlist-portal-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 5000,
        widgets: [{ key: "spotify-playlist-listings", title: "Spotify Playlist Listings" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Downloaded spotify-playlist-listings");
      expect(result.output).not.toContain("Skipped spotify-playlist-listings");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([expect.objectContaining({ widgetKey: "spotify-playlist-listings" })]);
      expect(await readFile(path.join(runDir, manifest.files[0].fileName), "utf8")).toBe("Playlist,Track,Streams\nRelease Radar,Track One,23\n");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed for an invalid Sisense action timeout budget", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalPlaylistMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-invalid-action-timeout-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 0,
        widgets: [{ key: "spotify-playlist-listings", title: "Spotify Playlist Listings" }],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("SISENSE_ACTION_TIMEOUT_MS must be a finite positive number.");
      expect(result.output).toContain('SISENSE_DIAGNOSTIC_FAILURE {"version":1,"code":"configuration"}');
      expect(result.output).not.toContain("Downloaded spotify-playlist-listings");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("caps the Sisense download timeout budget", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-download-timeout-"));
    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        downloadTimeoutMs: 1_800_001,
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" }],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("SISENSE_DOWNLOAD_TIMEOUT_MS must be between 1 and 1800000.");
      expect(fixture.filterEvents).toEqual([]);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("fails closed when a widget menu selector is malformed", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalPlaylistMenu: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-malformed-menu-selector-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "spotify-playlist-listings", title: "Spotify Playlist Listings", menuSelector: "[" }],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('SISENSE_DIAGNOSTIC_FAILURE {"version":1,"code":"widget_export_resolution"}');
      expect(result.output).not.toContain("Skipped spotify-playlist-listings");
      expect(result.output).not.toContain("Downloaded spotify-playlist-listings");
      expect(result.output).not.toContain("SISENSE_DIAGNOSTIC_SUMMARY");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not mask a malformed Shazams menu selector with an immediate empty state", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-empty-malformed-menu-selector-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "shazams-city", title: "Shazams by City", menuSelector: "[" }],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('SISENSE_DIAGNOSTIC_FAILURE {"version":1,"code":"widget_export_resolution"}');
      expect(result.output).not.toContain("Skipped shazams-city");
      expect(result.output).not.toContain("Downloaded shazams-city");
      expect(result.output).not.toContain("Observed empty shazams-city");
      expect(result.output).not.toContain("SISENSE_DIAGNOSTIC_SUMMARY");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not borrow a stale page-level Download Data action", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "stale" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-stale-portal-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Skipped tracks-by-growth-rate: No uniquely observable export action was available after opening the scoped widget menu.");
      expect(result.output).not.toContain("Downloaded tracks-by-growth-rate");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        state: "partial",
        skippedWidgets: [{ key: "tracks-by-growth-rate" }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not guess between ambiguous newly visible page-level Download Data actions", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "ambiguous" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-ambiguous-portal-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Skipped tracks-by-growth-rate: No uniquely observable export action was available after opening the scoped widget menu.");
      expect(result.output).not.toContain("Downloaded tracks-by-growth-rate");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        state: "partial",
        skippedWidgets: [{ key: "tracks-by-growth-rate" }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects a second page-level Download Data action that appears during stabilization", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, portalTracksMenuShape: "single" });
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(fixture.url);
      await page.locator("#tracks-more").click();
      expect(await page.locator("#tracks-portal a").count()).toBe(1);
      expect(await page.locator("#tracks-portal a").isVisible()).toBe(true);
      // Change the real DOM at the first stabilization poll, not after a wall-clock delay.
      // The adjacent CLI ambiguity test verifies skip/no-file handling end to end.
      const poll = vi.spyOn(page, "waitForTimeout").mockImplementationOnce(async () => {
        await page.locator("#tracks-portal").evaluate(element => {
          element.insertAdjacentHTML("beforeend", '<a href="/duplicate.csv" download>Download Data XLSX</a>');
        });
      });
      await expect(resolveNewPageDownloadAction(page, "Download Data", [])).rejects.toThrow("found 2");
      expect(poll).toHaveBeenCalledOnce();
    } finally {
      await Promise.all([browser?.close(), fixture.close()]);
    }
  }, 30_000);

  it("keeps a blank widget with a disabled scoped menu partial", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "blank" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-ambiguous-"));

    try {
      const result = await runScrape({ dashboardUrl: fixture.url, downloadDir: directory });
      expect(result.status).toBe(0);
      const { readdir } = await import("node:fs/promises");
      const [orgDirectory] = await readdir(directory);
      const [runDirectory] = await readdir(path.join(directory, orgDirectory));
      const manifest = JSON.parse(await readFile(path.join(directory, orgDirectory, runDirectory, "manifest.json"), "utf8"));
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "partial",
        observedEmptyWidgets: [],
        skippedWidgets: [{ key: "shazams-city" }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("records a delayed exact Shazams empty state without downloading a CSV", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "delayed-empty" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-delayed-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 5000,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Observed empty shazams-city: Query returned no matching rows.");
      expect(result.output).not.toContain("Downloaded shazams-city");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("records an exact Shazams empty message rendered within the final menu-attempt budget", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "within-budget-empty" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-within-budget-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 400,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).toContain("within-budget-empty-rendered");
      expect(result.output).toContain("Observed empty shazams-city: Query returned no matching rows.");
      expect(result.output).not.toContain("Skipped shazams-city");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("keeps an exact Shazams empty message arriving after the action budget partial", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "late-empty" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-late-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 400,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).toContain("late-empty-rendered");
      expect(result.output).toContain("Skipped shazams-city: No uniquely observable export action was available after opening the scoped widget menu.");
      expect(result.output).not.toContain("Observed empty shazams-city");
      expect(result.output).not.toContain("Downloaded shazams-city");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "partial",
        observedEmptyWidgets: [],
        skippedWidgets: [{ key: "shazams-city" }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not click a scoped menu that becomes actionable after the action budget", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "blank", shazamMenuState: "late-ready" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-late-menu-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 400,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).not.toContain("late-menu-clicked");
      expect(result.output).toContain("Skipped shazams-city: No uniquely observable export action was available after opening the scoped widget menu.");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "partial",
        observedEmptyWidgets: [],
        skippedWidgets: [{ key: "shazams-city" }],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("prefers exact empty evidence when menu readiness settles during its visibility probe", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "blank", shazamMenuState: "race-ready" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-race-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 400,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).toContain("race-empty-rendered");
      expect(fixture.filterEvents).toContain("race-menu-ready");
      expect(fixture.filterEvents.filter((event) => event === "race-menu-clicked")).toHaveLength(0);
      expect(result.output).toContain("Observed empty shazams-city: Query returned no matching rows.");
      const { runDir, manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect((await readdir(runDir)).filter((entry) => entry.endsWith(".csv"))).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("records empty evidence that appears when the widget menu opens", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "blank", shazamMenuState: "post-click-empty" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-post-menu-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain("Observed empty shazams-city: Query returned no matching rows.");
      expect((await readScrapeRun(directory)).manifest.completeness).toMatchObject({
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("clicks a menu that becomes actionable before the bounded action deadline", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "blank", shazamMenuState: "poll-window-ready" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-poll-window-menu-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 3000,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).toContain("poll-window-menu-ready");
      expect(fixture.filterEvents.filter((event) => event === "poll-window-menu-clicked")).toHaveLength(1);
      expect(result.output).toContain("Skipped shazams-city:");
      expect(result.output).not.toContain("Downloaded shazams-city");
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("observes exact empty evidence rendered before the bounded action deadline", async () => {
    const fixture = await startDashboardFixture({ activateRequestedRange: true, shazamState: "poll-window-empty", shazamMenuState: "poll-window-ready" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-poll-window-empty-"));

    try {
      const result = await runScrape({
        dashboardUrl: fixture.url,
        downloadDir: directory,
        actionTimeoutMs: 400,
        widgets: [{ key: "shazams-city", title: "Shazams by City" }],
      });
      expect(result.status).toBe(0);
      expect(fixture.filterEvents).toContain("poll-window-empty-rendered");
      expect(fixture.filterEvents).toContain("poll-window-menu-ready");
      expect(fixture.filterEvents.filter((event) => event === "poll-window-menu-clicked")).toHaveLength(0);
      expect(result.output).toContain("Observed empty shazams-city: Query returned no matching rows.");
      const { manifest } = await readScrapeRun(directory);
      expect(manifest.files).toEqual([]);
      expect(manifest.completeness).toMatchObject({
        version: 2,
        state: "complete",
        observedEmptyWidgets: [{ key: "shazams-city", reason: "Query returned no matching rows." }],
        skippedWidgets: [],
      });
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
