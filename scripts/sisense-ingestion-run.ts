import { parseCsv, type ParsedCsv } from "./sisense-csv";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { chromium, errors, type ElementHandle, type Locator, type Page } from "playwright";
import { Pool, type PoolClient } from "pg";
import { logEvent } from "../src/server/observability";
import { deriveReportingThrough } from "../src/server/analytics-data-quality";
import { assertDisposableForcedFailureTarget } from "./sisense-fixture-safety";
import {
  assertAnalyticsSandboxReplacementTarget,
  replaceAnalyticsSandboxEvidence,
} from "./analytics-sandbox-replace-evidence";
import { createWakeableCancellation, pollDelayMs, NoDownloadAvailableError, resolveNewPageDownloadAction, visiblePageDownloadActions, type WakeableCancellation } from "./sisense-action-boundary";
import type { DiagnosticFailureCode } from "./sisense-diagnostic-failure";
import { formatSisenseCustomRangeDate, previousCalendarDayInTimeZone, resolveSisenseTimeZone } from "./sisense-date-range";
import { buildImportCompleteness, parseSisenseMetric } from "./sisense-import-snapshot";

const SOURCE = "sisense";
const DEFAULT_ORG_ID = "true-nature";
const DEFAULT_DOWNLOAD_DIR = ".data/sisense";
const DEFAULT_STORAGE_PREFIX = "distributor/sisense";
const WIDGET_MENU_ATTEMPT_TIMEOUT_MS = 500;
const MAX_DOWNLOAD_TIMEOUT_MS = 1_800_000;
const DEFAULT_WIDGETS: WidgetTarget[] = [
  { key: "tracks-by-growth-rate", title: "Tracks by Growth Rate" },
  { key: "spotify-superfans-active-streams-city", title: "Spotify Superfans & Active Streams by City" },
  { key: "spotify-demographics-passion-indicators", title: "Spotify Demographics by Passion Indicators" },
  { key: "spotify-streams-source", title: "Spotify Streams by Source" },
  { key: "apple-streams-source", title: "Apple Streams by Source" },
  { key: "spotify-playlist-listings", title: "Spotify Playlist Listings" },
  { key: "shazams-city", title: "Shazams by City" },
  { key: "passion-indicator-benchmarks-genre", title: "Passion Indicator Benchmarks by Genre" },
];

const WIDGET_SCOPE_GRAIN: Record<string, "global" | "artist" | "track"> = {
  "tracks-by-growth-rate": "global",
  "spotify-superfans-active-streams-city": "artist",
  "spotify-demographics-passion-indicators": "artist",
  "spotify-streams-source": "track",
  "apple-streams-source": "track",
  "spotify-playlist-listings": "track",
  "shazams-city": "track",
  "passion-indicator-benchmarks-genre": "global",
};

type Mode = "sync" | "scrape" | "import";

interface WidgetTarget {
  key: string;
  title?: string;
  menuSelector?: string;
  menuIndex?: number;
  downloadLabel?: string;
}

export interface DownloadedFile {
  widgetKey: string;
  widgetTitle: string | null;
  fileName: string;
  localPath: string;
  requestedDateRange: string;
  requestedAggregation: string;
  scope: AnalyticsScope;
}

interface ScopeInput {
  artistId?: string;
  artistName?: string;
  releaseId?: string;
  releaseTitle?: string;
  trackId?: string;
  trackTitle?: string;
}

export interface AnalyticsScope {
  artistId: string | null;
  releaseId: string | null;
  trackId: string | null;
}

interface NormalizedRow {
  rowKey: string;
  rowHash: string;
  scope: AnalyticsScope;
  dimensions: Record<string, string | null>;
  metrics: Record<string, number | null>;
  rawRow: Record<string, string | null>;
}

interface FileImportStats {
  rowCount: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

type RawStorageStatus = "not_requested" | "pending" | "uploaded" | "failed";

interface PreparedImportFile {
  id: string;
  file: DownloadedFile;
  normalizedRows: NormalizedRow[];
}

export interface ScrapeCompleteness {
  version: 2;
  expectedWidgetKeys: string[];
  downloadedWidgetKeys: string[];
  observedEmptyWidgets: Array<{ key: string; reason: string }>;
  skippedWidgets: Array<{ key: string; reason: string }>;
  state: "complete" | "partial" | "empty";
}

export interface ProviderFilterState {
  artist: string | null;
  aggregation: string;
  dateRange: string;
  track: string | null;
}

export interface ProviderScopeSelection {
  artist: string | null;
  track: string | null;
}

interface ScrapeDiagnosticSummary {
  version: 1;
  runId: string;
  mode: "scrape";
  requestedDateRange: string;
  requestedAggregation: string;
  observedAt: string;
  providerFilterState: ProviderFilterState;
  databaseLockHeld: boolean;
  effectiveWidgetKeys: string[];
  effectiveWidgetCount: number;
  downloadedWidgetKeys: string[];
  observedEmptyWidgets: ScrapeCompleteness["observedEmptyWidgets"];
  skippedWidgets: ScrapeCompleteness["skippedWidgets"];
  completenessState: ScrapeCompleteness["state"];
  fileCount: number;
  files: Array<{ widgetKey: string; rowCount: number; sha256: string }>;
}

type WidgetDownloadResult =
  | { kind: "downloaded"; file: DownloadedFile }
  | { kind: "observed_empty"; widget: ScrapeCompleteness["observedEmptyWidgets"][number] };

export type SisenseAcquisition = {
  files: DownloadedFile[];
  completeness: ScrapeCompleteness | null;
  providerFilterState: ProviderFilterState | null;
  providerFilterObservedAt: string | null;
  runDir: string | null;
};

export type SisenseAcquisitionRequest = {
  runId: string;
  orgId: string;
  requestedDateRange: string;
  requestedAggregation: string;
  scope: AnalyticsScope;
  providerScope: ProviderScopeSelection;
};

/** Own one attempt, from scope and locking to raw provenance and atomic publication.
 * Only external browser acquisition is replaceable; saved files, SQL and cleanup
 * exercise the same implementation in production and disposable fixtures.
 */
export async function runSisenseIngestionRun({ args = [], acquire }: {
  args?: string[];
  acquire?: (request: SisenseAcquisitionRequest) => Promise<SisenseAcquisition>;
} = {}) {
  let schema = "label_suite";
  const rawArgs = args;
  const argSet = new Set(rawArgs);

  if (argSet.has("--help") || argSet.has("-h")) {
    console.log(`Usage: npm run sisense:sync -- [options]

  Scrapes True Nature's Sisense/Periscope dashboard CSV exports and optionally imports
  the normalized rows into Label Suite analytics tables.

  Modes:
    --mode sync       Scrape CSVs, save raw files, then import them (default)
    --mode scrape     Scrape CSVs only
    --mode import     Import saved CSV file(s) without opening the browser

  Safety:
    - Dry-run is the default.
    - Add --apply to write Postgres rows and upload raw CSVs to R2.
    - Raw CSV snapshots are always written locally when scraping.
    - Imports are replayable from --file or --dir.

  Options:
    --apply                     Write to Postgres/R2
    --org <org-id>              Defaults to SISENSE_ORG_ID or true-nature
    --date-range <label>        Overrides smart range selection
    --aggregation <label>       Defaults to Daily
    --initial                   Force initial full-history range
    --recent                    Force recent range
    --file <path>               Import one CSV in --mode import
    --dir <path>                Import all CSV files in a directory in --mode import
    --download-dir <path>       Defaults to SISENSE_DOWNLOAD_DIR or .data/sisense
    --artist-id <id>            Attach this run/files/rows to an artist
    --release-id <id>           Attach this run/files/rows to a release
    --track-id <id>             Attach this run/files/rows to a track
    --artist-name <name>        Resolve and attach this run to an artist
    --release-title <title>     Resolve and attach this run to a release
    --track-title <title>       Resolve and attach this run to a track
    --no-upload                 Skip R2 upload even with --apply
    --replace-sandbox-evidence  Atomically replace prior local sandbox Sisense evidence

  Environment:
    DATABASE_URL                    Neon/Postgres connection string (required with --apply)
    SISENSE_DASHBOARD_URL           Shared Sisense dashboard URL
    SISENSE_DASHBOARD_PASSWORD      Shared dashboard password, if required
    SISENSE_WIDGETS_JSON            JSON array of widgets to export
    SISENSE_INITIAL_DATE_RANGE      Defaults to "All Dates"
    SISENSE_RECENT_DATE_RANGE       Defaults to "Yesterday"
    SISENSE_TIME_ZONE               Defaults to "Europe/Copenhagen" for Yesterday custom ranges
    SISENSE_INITIAL_AGGREGATION     Defaults to "Daily"
    SISENSE_RECENT_AGGREGATION      Defaults to "Daily"
    SISENSE_RESET_FILTERS           Defaults to "false"
    SISENSE_SKIP_FILTERS            Set "true" only when visible defaults already match the requested aggregation/date range
    SISENSE_HEADLESS                Defaults to "true"
    SISENSE_DOWNLOAD_TIMEOUT_MS     Defaults to 300000 (5 minutes); maximum 1800000 (30 minutes)
    SISENSE_SCOPE_ARTIST_ID         Optional analytics artist scope
    SISENSE_SCOPE_RELEASE_ID        Optional analytics release scope
    SISENSE_SCOPE_TRACK_ID          Optional analytics track scope
    SISENSE_SCOPE_ARTIST_NAME       Optional name used to resolve artist scope
    SISENSE_SCOPE_RELEASE_TITLE     Optional title used to resolve release scope
    SISENSE_SCOPE_TRACK_TITLE       Optional title used to resolve track scope
    SISENSE_PROVIDER_ARTIST_FILTER  Optional provider artist label when it differs from the catalog name
    SISENSE_PROVIDER_TRACK_FILTER   Optional provider track label when it differs from the catalog title
    R2_*                            Optional; raw CSVs upload to R2 only when configured

  Example SISENSE_WIDGETS_JSON:
    [{"key":"tracks-by-growth-rate","title":"Tracks by Growth Rate"}]
  `);
    return;
  }

  const apply = argSet.has("--apply");
  const mode = readMode();
  const orgId = readOption("--org") ?? process.env.SISENSE_ORG_ID ?? DEFAULT_ORG_ID;
  const replaceSandboxEvidence = argSet.has("--replace-sandbox-evidence");
  const downloadRoot = path.resolve(readOption("--download-dir") ?? process.env.SISENSE_DOWNLOAD_DIR ?? DEFAULT_DOWNLOAD_DIR);
  const dashboardUrl = readOption("--url") ?? process.env.SISENSE_DASHBOARD_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const runId = `sisense_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9_-]+$/.test(orgId)) fail("Sisense org ID contains unsupported characters.");
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, options: `-c app.current_org_id=${orgId}` }) : null;

  let scrapeFailureCode: DiagnosticFailureCode = "unexpected";

  try {
    return await main();
  } catch (error) {
    if (mode === "scrape") {
      console.log(`SISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: scrapeFailureCode })}`);
    }
    throw error;
  } finally {
    if (pool) await pool.end();
  }


  async function main() {
    setScrapeFailureStage("configuration");
    schema = sqlIdentifier(process.env.SISENSE_DB_SCHEMA ?? "label_suite");
    if (replaceSandboxEvidence) {
      assertAnalyticsSandboxReplacementTarget({
        mode,
        apply,
        noUpload: argSet.has("--no-upload"),
        orgId,
        schema,
        databaseUrl,
        env: process.env,
      });
    }
    assertForcedFailureSeamTarget();
    if (apply && mode === "scrape") {
      fail("--mode scrape is read-only; use --mode sync --apply to publish imported evidence.");
    }
    if (apply && !pool) fail("DATABASE_URL is required with --apply.");
    if ((mode === "sync" || mode === "scrape") && !dashboardUrl) {
      fail("SISENSE_DASHBOARD_URL is required for scraping.");
    }

    setScrapeFailureStage("database_setup");
    const hasPreviousSuccessfulRun = pool
      ? await successfulRunExists(pool, orgId)
      : false;
    const forceInitial = argSet.has("--initial") || (!argSet.has("--recent") && !hasPreviousSuccessfulRun);
    const requestedDateRange =
      readOption("--date-range") ??
      (forceInitial
        ? process.env.SISENSE_INITIAL_DATE_RANGE ?? "All Dates"
        : process.env.SISENSE_RECENT_DATE_RANGE ?? "Yesterday");
    const requestedAggregation =
      readOption("--aggregation") ??
      (forceInitial
        ? process.env.SISENSE_INITIAL_AGGREGATION ?? "Daily"
        : process.env.SISENSE_RECENT_AGGREGATION ?? "Daily");

    console.log(`Mode: ${mode}${apply ? " (apply)" : " (dry-run)"}`);
    console.log(`Run: ${runId}`);
    console.log(`Org: ${orgId}`);
    console.log(`Range: ${requestedDateRange}`);
    console.log(`Aggregation: ${requestedAggregation}`);

    const client = pool ? await pool.connect() : null;
    let lockClient: PoolClient | null = null;
    let runInserted = false;
    let publicationOpen = false;
    let acquisition: SisenseAcquisition | null = null;
    const stats = { filesDownloaded: 0, rowsImported: 0, rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 0 };
    try {
      if (pool && (apply || mode === "scrape")) {
        lockClient = await pool.connect();
        await lockClient.query("begin");
        if (!await acquireJobLock(lockClient)) throw new Error("Another Sisense sync is already running.");
      }
      const scopeInput = readScopeInput();
      const scope = await resolveScope(client, scopeInput);
      const providerScope = mode === "import"
        ? { artist: null, track: null }
        : await resolveProviderScopeSelection(client, scopeInput, scope);
      console.log(`Scope: ${formatScope(scope)}`);
      if (apply && client) {
        await ensureOrgExists(client, orgId);
        await insertRun(client, { requestedDateRange, requestedAggregation, status: "running", scope });
        runInserted = true;
      }
      acquisition = mode === "import"
        ? await importModeFiles(client, requestedDateRange, requestedAggregation, scope)
        : acquire
          ? await acquire({ runId, orgId, requestedDateRange, requestedAggregation, scope, providerScope })
          : await scrapeDashboard(requestedDateRange, requestedAggregation, scope, providerScope);
      if (mode === "scrape" && acquisition.completeness && acquisition.providerFilterState && acquisition.providerFilterObservedAt && acquisition.runDir) {
        setScrapeFailureStage("diagnostic_summary_writing");
        const diagnosticSummary = await writeScrapeDiagnosticSummary({
          runDir: acquisition.runDir, files: acquisition.files, requestedDateRange, requestedAggregation,
          providerFilterState: acquisition.providerFilterState, observedAt: acquisition.providerFilterObservedAt,
          databaseLockHeld: Boolean(lockClient), completeness: acquisition.completeness,
        });
        console.log(`SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify(diagnosticSummary)}`);
      }
      console.log(`Files ready: ${acquisition.files.length}`);
      if (mode !== "scrape" && acquisition.completeness?.state !== "complete") {
        throw new Error(`Sisense acquisition is ${acquisition.completeness?.state ?? "unverified"}; refusing to publish incomplete analytics.`);
      }
      const prepared: PreparedImportFile[] = [];
      if (mode !== "scrape") {
        for (const file of acquisition.files) prepared.push(await prepareImportFile(client, file));
        if (shouldFailAfterRawStaging()) throw new Error("Test requested failure after raw-file staging.");
      }
      if (apply && client && mode !== "scrape") {
        await client.query("begin");
        publicationOpen = true;
        if (replaceSandboxEvidence) {
          const replacement = await replaceAnalyticsSandboxEvidence(client, { orgId, currentRunId: runId });
          console.log(`Sandbox evidence replaced: metricChanges=${replacement.metricChanges} importFiles=${replacement.importFiles} metricRows=${replacement.metricRows} importRuns=${replacement.importRuns}`);
        }
      }
      for (const item of prepared) {
        const fileStats = await importPreparedFile(client, item);
        console.log(`${item.file.widgetKey}: ${fileStats.rowCount} rows (${fileStats.inserted} inserted, ${fileStats.updated} updated, ${fileStats.unchanged} unchanged)`);
        stats.rowsImported += fileStats.rowCount;
        stats.rowsInserted += fileStats.inserted;
        stats.rowsUpdated += fileStats.updated;
        stats.rowsUnchanged += fileStats.unchanged;
      }
      stats.filesDownloaded = acquisition.files.length;
      const sourceFreshness = {
        version: 1,
        reportingThrough: deriveReportingThrough(prepared.flatMap((file) => file.normalizedRows))?.toISOString() ?? null,
      };
      if (apply && client) {
        await completeRun(client, { status: "completed", ...stats, completeness: acquisition.completeness, providerFilterState: acquisition.providerFilterState, sourceFreshness });
      }
      if (publicationOpen && client) {
        await client.query("commit");
        publicationOpen = false;
      }
      console.log(`Rows imported: ${stats.rowsImported}`);
      return { acquisition, stats, sourceFreshness };
    } catch (error) {
      if (client && publicationOpen) {
        await client.query("rollback").catch(() => undefined);
        publicationOpen = false;
      }
      if (apply && client && runInserted) {
        await completeRun(client, { status: "failed", ...stats, filesDownloaded: acquisition?.files.length ?? 0,
          error: errorMessage(error), completeness: acquisition?.completeness ?? null,
          providerFilterState: acquisition?.providerFilterState ?? null,
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (lockClient) {
        await lockClient.query("rollback").catch(() => undefined);
        lockClient.release();
      }
      client?.release();
    }
  }

  async function scrapeDashboard(
    requestedDateRange: string,
    requestedAggregation: string,
    scope: AnalyticsScope,
    providerScope: ProviderScopeSelection,
  ): Promise<{ files: DownloadedFile[]; completeness: ScrapeCompleteness; providerFilterState: ProviderFilterState; providerFilterObservedAt: string; runDir: string }> {
    setScrapeFailureStage("configuration");
    if (!dashboardUrl) fail("SISENSE_DASHBOARD_URL is required.");
    const actionTimeoutMs = resolveSisenseActionTimeoutMs();
    const downloadTimeoutMs = resolveSisenseDownloadTimeoutMs();

    const widgets = readWidgets();
    assertRequiredProviderScope(widgets, providerScope);
    const runDir = path.join(downloadRoot, orgId, runId);
    const failureDir = path.join(runDir, "failures");
    await mkdir(runDir, { recursive: true });
    await mkdir(failureDir, { recursive: true });

    setScrapeFailureStage("browser_launch");
    const browser = await chromium.launch({
      headless: readBooleanEnv("SISENSE_HEADLESS", true),
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1600, height: 1200 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(actionTimeoutMs);

    try {
      setScrapeFailureStage("provider_navigation_authentication");
      await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
      await maybeEnterPassword(page);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      setScrapeFailureStage("provider_filters");
      const providerFilterState = await maybeApplyFilters(page, requestedDateRange, requestedAggregation, providerScope);
      const providerFilterObservedAt = new Date().toISOString();

      const files: DownloadedFile[] = [];
      const observedEmptyWidgets: ScrapeCompleteness["observedEmptyWidgets"] = [];
      const skippedWidgets: ScrapeCompleteness["skippedWidgets"] = [];
      for (const widget of widgets) {
        try {
          setScrapeFailureStage("widget_export_resolution");
          const result = await downloadWidget(page, widget, runDir, requestedDateRange, requestedAggregation, scopeForWidget(widget.key, scope), actionTimeoutMs, downloadTimeoutMs);
          if (result.kind === "observed_empty") {
            observedEmptyWidgets.push(result.widget);
            console.log(`Observed empty ${result.widget.key}: ${result.widget.reason}`);
            continue;
          }
          files.push(result.file);
          console.log(`Downloaded ${result.file.fileName}`);
        } catch (error) {
          if (error instanceof NoDownloadAvailableError) {
            const reason = "No uniquely observable export action was available after opening the scoped widget menu.";
            console.log(`Skipped ${widget.key}: ${reason}`);
            skippedWidgets.push({ key: widget.key, reason });
            continue;
          }
          await page.screenshot({ path: path.join(failureDir, `${safeFileName(widget.key)}.png`), fullPage: true }).catch(() => undefined);
          const safeWidgetResolutionError = `Could not resolve exactly one .widget-container for widget '${widget.key}'.`;
          if (errorMessage(error) === safeWidgetResolutionError) throw new Error(safeWidgetResolutionError);
          throw new Error(`Failed to download widget '${widget.key}' without a safely observable export action.`);
        }
      }

      const completeness: ScrapeCompleteness = {
        version: 2,
        expectedWidgetKeys: widgets.map((widget) => widget.key).sort(),
        downloadedWidgetKeys: files.map((file) => file.widgetKey).sort(),
        observedEmptyWidgets: observedEmptyWidgets.sort((a, b) => a.key.localeCompare(b.key)),
        skippedWidgets,
        state: skippedWidgets.length ? "partial" : files.length || observedEmptyWidgets.length ? "complete" : "empty",
      };
      setScrapeFailureStage("diagnostic_artifact_writing");
      await writeRunManifest(runDir, files, requestedDateRange, requestedAggregation, providerFilterState, completeness);
      return { files, completeness, providerFilterState, providerFilterObservedAt, runDir };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  function setScrapeFailureStage(stage: DiagnosticFailureCode): void {
    if (mode === "scrape") scrapeFailureCode = stage;
  }

  async function maybeEnterPassword(page: Page): Promise<void> {
    const password = process.env.SISENSE_DASHBOARD_PASSWORD;
    if (!password) return;

    const input = page.locator('input[type="password"]').first();
    if (!(await isVisible(input, 10_000))) return;

    await input.fill(password);
    await input.evaluate((element) => {
      const inputElement = element as HTMLInputElement;
      const form = inputElement.closest("form");
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        return;
      }
      const button = document.querySelector("#submit-button, button[type='submit']");
      if (button instanceof HTMLElement) button.click();
    });
    await input.press("Enter").catch(() => undefined);
  }

  async function maybeApplyFilters(
    page: Page,
    requestedDateRange: string,
    requestedAggregation: string,
    providerScope: ProviderScopeSelection,
  ): Promise<ProviderFilterState> {
    const requestedDateSummary = requestedDateRangeSummary(requestedDateRange);
    if (readBooleanEnv("SISENSE_SKIP_FILTERS", false)) {
      console.log("Skipping Sisense filter UI; verifying dashboard defaults match the requested state.");
      return {
        artist: providerScope.artist ? await assertVisibleFilterValue(page, "True_Nature_Artists", providerScope.artist) : null,
        aggregation: await assertVisibleFilterState(page, "aggregation", requestedAggregation),
        dateRange: await assertVisibleFilterState(page, "date range", requestedDateSummary),
        track: providerScope.track ? await assertVisibleFilterValue(page, "True_Nature_Tracks", providerScope.track) : null,
      };
    }

    await openFilters(page);

    if (readBooleanEnv("SISENSE_RESET_FILTERS", false)) {
      await clickText(page, "RESET FILTERS", { exact: true, timeoutMs: 5_000 }).catch(() => undefined);
    }

    if (providerScope.artist) await selectProviderValue(page, "True_Nature_Artists", providerScope.artist);
    if (providerScope.track) await selectProviderValue(page, "True_Nature_Tracks", providerScope.track);
    await selectProviderDimensionOption(page, "Aggregation", requestedAggregation, "aggregation");
    if (requestedDateRange === "Yesterday") {
      await selectYesterdayCustomRange(page, requestedDateSummary);
    } else {
      await selectProviderDimensionOption(page, "DateRange", requestedDateRange, "date range");
    }
    await clickApplyIfPossible(page, { required: true });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    return {
      artist: providerScope.artist ? await assertVisibleFilterValue(page, "True_Nature_Artists", providerScope.artist) : null,
      aggregation: await assertVisibleFilterState(page, "aggregation", requestedAggregation),
      dateRange: await assertVisibleFilterState(page, "date range", requestedDateSummary),
      track: providerScope.track ? await assertVisibleFilterValue(page, "True_Nature_Tracks", providerScope.track) : null,
    };
  }

  async function selectProviderValue(page: Page, dimension: "True_Nature_Artists" | "True_Nature_Tracks", requestedLabel: string): Promise<void> {
    const group = await resolveProviderSummaryGroup(page, dimension);
    const controls = group.locator(":scope > div.filter");
    if ((await controls.count()) !== 1 || !(await clickIfReachable(controls.first(), 5_000))) {
      throw new Error(`Could not open the scoped ${dimension} summary control.`);
    }

    const editor = page.locator("div.setting.dimension-setting").filter({
      has: page.locator("div.setting-header").getByText(dimension, { exact: true }),
    });
    if ((await editor.count()) !== 1 || !(await isVisible(editor.first(), 5_000))) {
      throw new Error(`Could not resolve exactly one scoped ${dimension} provider editor.`);
    }

    const search = editor.first().locator("input.search-input");
    if ((await search.count()) !== 1) throw new Error(`Could not resolve the scoped ${dimension} search input.`);
    await search.fill(requestedLabel);

    const options = editor.first().locator("div.checkbox.small-radio-button");
    const option = options.filter({ hasText: requestedLabel });
    await option.first().waitFor({ state: "visible", timeout: resolveSisenseActionTimeoutMs() });
    if ((await option.count()) !== 1 || (await option.first().innerText()).trim() !== requestedLabel) {
      throw new Error(`Could not resolve exactly one scoped ${dimension} option.`);
    }
    const selected = await option.first().evaluate((element) => element.classList.contains("selected")).catch(() => false);
    if (!selected && !(await clickIfReachable(option.first(), 5_000))) {
      throw new Error(`Could not select the requested scoped ${dimension} option.`);
    }
    await search.fill("");
  }

  async function openFilters(page: Page): Promise<void> {
    // The observed filters bar is only available after this entry trigger opens
    // the settings UI, so it cannot safely scope this one pre-open lookup.
    const triggers = page.getByText(/^\s*FILTERS\s*(?:\(\d+\))?\s*$/i);
    const visible: Locator[] = [];
    for (let index = 0; index < await triggers.count(); index += 1) {
      const trigger = triggers.nth(index);
      if (await isVisible(trigger, 1_000)) visible.push(trigger);
    }
    if (visible.length !== 1 || !(await clickIfReachable(visible[0], 10_000))) {
      throw new Error("Could not resolve exactly one pre-open Sisense FILTERS trigger.");
    }
  }

  async function selectProviderDimensionOption(
    page: Page,
    summaryDimension: "Aggregation" | "DateRange",
    requestedLabel: string,
    dimension: "aggregation" | "date range",
  ): Promise<void> {
    const editor = await openProviderDimensionEditor(page, summaryDimension);
    const option = await resolveProviderOption(editor, requestedLabel, dimension);
    const clickTarget = summaryDimension === "DateRange"
      ? await resolveDateRangeOptionClickTarget(option)
      : option;
    if (!(await clickIfReachable(clickTarget, 5_000))) {
      throw new Error(`Could not select ${dimension} '${requestedLabel}' from its scoped provider editor.`);
    }
    if (summaryDimension === "Aggregation") {
      await assertSelectedAggregationOption(option, requestedLabel);
    }
  }

  async function selectYesterdayCustomRange(page: Page, expectedSummary: string): Promise<void> {
    const editor = await openProviderDimensionEditor(page, "DateRange");
    const customRange = await resolveProviderOption(editor, "Custom Range", "date range");
    const clickTarget = await resolveDateRangeOptionClickTarget(customRange);
    if (!(await clickIfReachable(clickTarget, 5_000))) {
      throw new Error("Could not select Custom Range from the scoped date range editor.");
    }

    const inputs = editor.locator("input");
    if ((await inputs.count()) !== 2) {
      throw new Error("Could not resolve exactly two scoped Custom Range date inputs.");
    }
    const [startDate, endDate] = expectedSummary.split(" to ");
    if (!startDate || startDate !== endDate) throw new Error(`Invalid Yesterday custom range summary '${expectedSummary}'.`);
    const providerDate = formatSisenseCustomRangeDate(startDate);
    for (let index = 0; index < 2; index += 1) {
      const input = inputs.nth(index);
      if (!(await isVisible(input, 1_000))) {
        throw new Error(`Scoped Custom Range input ${index + 1} is not visible after selecting Custom Range.`);
      }
      await input.fill(providerDate);
      const observedDate = await input.inputValue();
      if (observedDate !== startDate && observedDate !== providerDate) {
        throw new Error(`Scoped Custom Range input ${index + 1} did not match accepted ISO '${startDate}' or provider '${providerDate}'.`);
      }
    }
  }

  async function assertSelectedAggregationOption(option: Locator, requestedLabel: string): Promise<void> {
    const selected = await option.evaluate((element) => element.classList.contains("selected")).catch(() => false);
    if (!selected || normalizeProviderOptionLabel(await option.innerText()) !== requestedLabel) {
      throw new Error(`The scoped aggregation option '${requestedLabel}' did not become selected.`);
    }
  }

  async function openProviderDimensionEditor(page: Page, summaryDimension: "Aggregation" | "DateRange"): Promise<Locator> {
    const group = await resolveProviderSummaryGroup(page, summaryDimension);
    const controls = group.locator(":scope > div.filter");
    if ((await controls.count()) !== 1 || !(await clickIfReachable(controls.first(), 5_000))) {
      throw new Error(`Could not open the scoped ${summaryDimension} summary control.`);
    }

    const editor = summaryDimension === "Aggregation"
      ? page.locator("div.setting.dimension-setting.aggregation-setting")
      : page.locator("div.setting.dimension-setting").filter({ has: page.locator("div.date-range-dropdown") });
    if ((await editor.count()) !== 1 || !(await isVisible(editor.first(), 5_000))) {
      throw new Error(`Could not resolve exactly one scoped ${summaryDimension} provider editor.`);
    }
    return editor.first();
  }

  async function resolveProviderSummaryGroup(page: Page, summaryDimension: "Aggregation" | "DateRange" | "True_Nature_Artists" | "True_Nature_Tracks"): Promise<Locator> {
    const bars = page.locator("div.filters-bar");
    if ((await bars.count()) !== 1) throw new Error("Could not resolve exactly one Sisense filters bar.");
    const filters = bars.first().locator(":scope > div.filters");
    if ((await filters.count()) !== 1) throw new Error("Could not resolve exactly one Sisense filters container.");

    const groups = filters.first().locator(":scope > div.filter-group");
    const matches: Locator[] = [];
    for (let index = 0; index < await groups.count(); index += 1) {
      const group = groups.nth(index);
      if ((await group.getByText(summaryDimension, { exact: true }).count()) === 1) matches.push(group);
    }
    if (matches.length !== 1) {
      throw new Error(`Could not resolve exactly one scoped ${summaryDimension} summary group.`);
    }
    return matches[0];
  }

  async function resolveProviderOption(editor: Locator, requestedLabel: string, dimension: string): Promise<Locator> {
    const options = editor.locator("div.small-radio-button, div.date-range-dropdown > *");
    const matches: Locator[] = [];
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index);
      if (normalizeProviderOptionLabel(await option.innerText()) === requestedLabel) matches.push(option);
    }
    if (matches.length !== 1) {
      throw new Error(`Could not resolve exactly one scoped ${dimension} option '${requestedLabel}'.`);
    }
    return matches[0];
  }

  async function resolveDateRangeOptionClickTarget(option: Locator): Promise<Locator> {
    const labels = option.locator(":scope > div.label");
    if ((await labels.count()) === 1 && await isVisible(labels.first(), 1_000)) return labels.first();
    return option;
  }

  function normalizeProviderOptionLabel(label: string): string {
    return label.trim().replace(/\s+\(DEFAULT\)\s*$/i, "");
  }

  function requestedDateRangeSummary(requestedDateRange: string): string {
    if (requestedDateRange !== "Yesterday") return requestedDateRange;
    const yesterday = previousCalendarDayInTimeZone(new Date(), resolveSisenseTimeZone(process.env.SISENSE_TIME_ZONE));
    return `${yesterday} to ${yesterday}`;
  }

  async function downloadWidget(
    page: Page,
    widget: WidgetTarget,
    runDir: string,
    requestedDateRange: string,
    requestedAggregation: string,
    scope: AnalyticsScope,
    actionTimeoutMs: number,
    downloadTimeoutMs: number,
  ): Promise<WidgetDownloadResult> {
    const widgetRoot = await resolveWidgetRoot(page, widget);
    const downloadLabel = widget.downloadLabel ?? "Download Data";
    const visiblePageActionsBeforeMenu = await visiblePageDownloadActions(page, downloadLabel);
    let pageDownloadAction: ElementHandle | null = null;
    try {
      const menuResult = await openWidgetMenu(widgetRoot, widget, actionTimeoutMs);
      if (menuResult === "empty") {
        return { kind: "observed_empty", widget: { key: widget.key, reason: "Query returned no matching rows." } };
      }
      if (await observedEmptyWidget(widgetRoot)) {
        return { kind: "observed_empty", widget: { key: widget.key, reason: "Query returned no matching rows." } };
      }

      const scopedDownloadAction = widgetRoot.getByText(downloadLabel, { exact: false }).first();
      const hasScopedDownloadAction = await isVisible(scopedDownloadAction, 3_000);
      if (!hasScopedDownloadAction) {
        pageDownloadAction = await resolveNewPageDownloadAction(page, downloadLabel, visiblePageActionsBeforeMenu);
      }

      const downloadPromise = page.waitForEvent("download", { timeout: downloadTimeoutMs });
      const clicked = pageDownloadAction
        ? await clickElementIfReachable(pageDownloadAction, 5_000)
        : await clickIfReachable(scopedDownloadAction, 5_000);
      if (!clicked) {
        void downloadPromise.catch(() => undefined);
        throw new NoDownloadAvailableError(`Could not click the resolved ${downloadLabel} action.`);
      }
      const download = await downloadPromise;

      const suggestedName = download.suggestedFilename() || `${widget.key}.csv`;
      const fileName = safeFileName([
        widget.key,
        requestedAggregation,
        requestedDateRange,
        new Date().toISOString().replace(/[:.]/g, "-"),
        suggestedName,
      ].join("-"));
      const localPath = path.join(runDir, fileName.endsWith(".csv") ? fileName : `${fileName}.csv`);
      await download.saveAs(localPath);

      return { kind: "downloaded", file: {
        widgetKey: widget.key,
        widgetTitle: widget.title ?? null,
        fileName: path.basename(localPath),
        localPath,
        requestedDateRange,
        requestedAggregation,
        scope,
      } };
    } finally {
      await pageDownloadAction?.dispose().catch(() => undefined);
      await Promise.all(visiblePageActionsBeforeMenu.map(({ element }) => element.dispose().catch(() => undefined)));
    }
  }

  async function resolveWidgetRoot(page: Page, widget: WidgetTarget): Promise<Locator> {
    if (!widget.title) throw new Error(`Widget '${widget.key}' requires a title to resolve its .widget-container.`);
    const titleMatches = page.getByText(widget.title, { exact: true });
    const rootIndexes = await titleMatches.evaluateAll((elements) => {
      const widgetContainers = [...document.querySelectorAll(".widget-container")];
      return [...new Set(elements.map((element) => {
        const container = element.closest(".widget-container");
        return container ? widgetContainers.indexOf(container) : -1;
      }).filter((index) => index >= 0))];
    });
    if (rootIndexes.length !== 1) {
      throw new Error(`Could not resolve exactly one .widget-container for widget '${widget.key}'.`);
    }
    return page.locator(".widget-container").nth(rootIndexes[0]);
  }

  async function observedEmptyWidget(widgetRoot: Locator): Promise<string | null> {
    const empty = widgetRoot.getByText("Query returned no matching rows.", { exact: true }).first();
    return await empty.isVisible() ? "Query returned no matching rows." : null;
  }

  async function openWidgetMenu(widgetRoot: Locator, widget: WidgetTarget, actionTimeoutMs: number): Promise<"menu" | "empty"> {
    const deadline = Date.now() + actionTimeoutMs;
    const selector = widget.menuSelector
      ?? 'div[name="expand"], [data-tooltip*="More"], [aria-label*="More"], [title*="More"], button:has-text("More"), [role="button"]:has-text("More"), [class*="more"], [class*="menu"], [class*="hamburger"], [class*="ellipsis"]';
    const menus = widgetRoot.locator(selector);
    await menus.count();

    const cancellation = createWakeableCancellation();
    const emptyEvidence = observeEmptyWidgetUntilDeadline(widgetRoot, deadline, cancellation);
    const menuReadiness = waitForWidgetMenuReadiness(widgetRoot, menus, deadline, cancellation);

    let winner: { kind: "empty-evidence"; value: "empty" | null } | { kind: "menu-readiness"; value: number };
    try {
      winner = await Promise.race([
        emptyEvidence.then((value) => ({ kind: "empty-evidence" as const, value })),
        menuReadiness.then((value) => ({ kind: "menu-readiness" as const, value })),
      ]);
    } catch (error) {
      cancellation.cancel();
      await emptyEvidence;
      throw error;
    }

    if (winner.kind === "empty-evidence") {
      cancellation.cancel();
      try {
        await menuReadiness;
      } catch (error) {
        if (!(error instanceof NoDownloadAvailableError) && !isPlaywrightTimeoutError(error)) throw error;
      }
      if (winner.value === "empty") return "empty";
      throw new NoDownloadAvailableError("Scoped More Options control is unavailable for this widget.");
    }

    cancellation.cancel();
    const reconciledEmptyEvidence = await emptyEvidence;
    if (reconciledEmptyEvidence === "empty" || await probeEmptyWidgetBeforeDeadline(widgetRoot, deadline)) return "empty";
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new NoDownloadAvailableError("Scoped More Options control is unavailable for this widget.");
    try {
      await menus.nth(winner.value).click({ timeout: Math.min(WIDGET_MENU_ATTEMPT_TIMEOUT_MS, remainingMs) });
    } catch (error) {
      if (isPlaywrightTimeoutError(error)) throw new NoDownloadAvailableError("Scoped More Options control is unavailable for this widget.");
      throw error;
    }
    if (Date.now() >= deadline) throw new NoDownloadAvailableError("Scoped More Options control is unavailable for this widget.");
    return "menu";
  }

  async function waitForWidgetMenuReadiness(
    widgetRoot: Locator,
    menus: Locator,
    deadline: number,
    cancellation: WakeableCancellation,
  ): Promise<number> {
    while (!cancellation.isCancelled() && Date.now() < deadline) {
      const hoverTimeoutMs = remainingActionTimeout(deadline);
      if (hoverTimeoutMs <= 0) break;
      try {
        await widgetRoot.hover({ timeout: Math.min(WIDGET_MENU_ATTEMPT_TIMEOUT_MS, hoverTimeoutMs) });
      } catch (error) {
        if (!isPlaywrightTimeoutError(error)) throw error;
      }
      if (Date.now() >= deadline) break;

      const count = await menus.count();
      for (let index = 0; index < count && !cancellation.isCancelled() && Date.now() < deadline; index += 1) {
        const timeoutMs = remainingActionTimeout(deadline);
        if (timeoutMs <= 0) break;
        try {
          await menus.nth(index).click({ trial: true, timeout: Math.min(WIDGET_MENU_ATTEMPT_TIMEOUT_MS, timeoutMs) });
          if (Date.now() < deadline) return index;
        } catch (error) {
          if (!isPlaywrightTimeoutError(error)) throw error;
          // Re-resolve the scoped selector after each bounded trial because the
          // provider may replace a disabled control as it becomes actionable.
        }
      }
      if (cancellation.isCancelled()) break;
      const remainingMs = remainingActionTimeout(deadline);
      if (remainingMs > 0) await cancellation.sleep(pollDelayMs(remainingMs));
    }
    throw new NoDownloadAvailableError("Scoped More Options control is unavailable for this widget.");
  }

  function remainingActionTimeout(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  }

  async function observeEmptyWidgetUntilDeadline(
    widgetRoot: Locator,
    deadline: number,
    cancellation: WakeableCancellation,
  ): Promise<"empty" | null> {
    while (!cancellation.isCancelled() && Date.now() < deadline) {
      const observed = await observedEmptyWidget(widgetRoot);
      if (observed && Date.now() < deadline) return "empty";
      if (Date.now() >= deadline) return null;
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await cancellation.sleep(pollDelayMs(remainingMs));
      }
    }
    return null;
  }

  async function probeEmptyWidgetBeforeDeadline(widgetRoot: Locator, deadline: number): Promise<boolean> {
    if (Date.now() >= deadline) return false;
    const observed = await observedEmptyWidget(widgetRoot);
    return Boolean(observed && Date.now() < deadline);
  }

  function resolveSisenseActionTimeoutMs(): number {
    const actionTimeoutMs = Number(process.env.SISENSE_ACTION_TIMEOUT_MS ?? 30_000);
    if (!Number.isFinite(actionTimeoutMs) || actionTimeoutMs <= 0) {
      throw new Error("SISENSE_ACTION_TIMEOUT_MS must be a finite positive number.");
    }
    return actionTimeoutMs;
  }

  function resolveSisenseDownloadTimeoutMs(): number {
    const downloadTimeoutMs = Number(process.env.SISENSE_DOWNLOAD_TIMEOUT_MS ?? 300_000);
    if (!Number.isFinite(downloadTimeoutMs) || downloadTimeoutMs <= 0 || downloadTimeoutMs > MAX_DOWNLOAD_TIMEOUT_MS) {
      throw new Error(`SISENSE_DOWNLOAD_TIMEOUT_MS must be between 1 and ${MAX_DOWNLOAD_TIMEOUT_MS}.`);
    }
    return downloadTimeoutMs;
  }

  async function importModeFiles(
    client: PoolClient | null,
    requestedDateRange: string,
    requestedAggregation: string,
    scope: AnalyticsScope,
  ): Promise<{
    files: DownloadedFile[];
    completeness: ScrapeCompleteness;
    providerFilterState: ProviderFilterState | null;
    providerFilterObservedAt: null;
    runDir: null;
  }> {
    const filePath = readOption("--file");
    const dirPath = readOption("--dir");
    if (!filePath && !dirPath) fail("--mode import requires --file or --dir.");

    const dir = dirPath ? path.resolve(dirPath) : null;
    const resolvedFilePath = filePath ? path.resolve(filePath) : null;
    const manifest = await readRunManifest(dir ?? path.dirname(resolvedFilePath!));
    const paths = resolvedFilePath ? [resolvedFilePath] : await csvFilesInDirectory(dir!);
    const explicitWidgetKey = readOption("--widget-key");
    const explicitWidgetTitle = readOption("--widget-title");
    const observedProviderScope = {
      artist: cleanText(manifest?.providerFilterState?.artist),
      track: cleanText(manifest?.providerFilterState?.track),
    };
    let resolvedImportScope = scope;
    if (client && (observedProviderScope.artist || observedProviderScope.track)) {
      const manifestScope = await resolveScope(client, {
        artistName: observedProviderScope.artist ?? undefined,
        trackTitle: observedProviderScope.track ?? undefined,
      });
      resolvedImportScope = mergeStrictScope(scope, manifestScope, "manifest provider filters");
    }

    const files = paths.map((localPath, index) => {
      const fileName = path.basename(localPath);
      const manifestFile = manifest?.files.get(fileName);
      const inferredWidget = inferWidgetForFile(fileName, requestedDateRange, requestedAggregation);
      const widgetKey = explicitWidgetKey ?? manifestFile?.widgetKey ?? inferredWidget?.key ?? `manual-${index + 1}`;
      const storedScope = normalizeScope(manifestFile?.scope);
      const hasStoredScope = Boolean(storedScope.artistId || storedScope.releaseId || storedScope.trackId);
      return {
        widgetKey,
        widgetTitle: explicitWidgetTitle ?? manifestFile?.widgetTitle ?? inferredWidget?.title ?? null,
        fileName,
        localPath,
        requestedDateRange: manifestFile?.requestedDateRange ?? requestedDateRange,
        requestedAggregation: manifestFile?.requestedAggregation ?? requestedAggregation,
        scope: hasStoredScope
          ? storedScope
          : manifest?.providerFilterState ? scopeForWidget(widgetKey, resolvedImportScope) : resolvedImportScope,
      };
    });

    if (manifest) {
      if (manifest.providerFilterState) {
        assertRequiredProviderScope(files.map((file) => ({ key: file.widgetKey })), observedProviderScope);
      }
      if (manifest.completeness && !resolvedFilePath) {
        const selected = [...new Set(files.map((file) => file.widgetKey))].sort();
        const downloaded = [...new Set(manifest.completeness.downloadedWidgetKeys)].sort();
        if (selected.join("\0") !== downloaded.join("\0")) {
          fail("Selected import files do not match the manifest's downloaded widget set.");
        }
      }
    }

    let completeness: ScrapeCompleteness = manifest?.completeness ?? buildImportCompleteness(files.map((file) => file.widgetKey));
    if (resolvedFilePath && completeness.state === "complete") {
      completeness = buildImportCompleteness(files.map((file) => file.widgetKey));
    }

    return {
      files,
      completeness,
      providerFilterState: manifest?.providerFilterState ?? null,
      providerFilterObservedAt: null,
      runDir: null,
    };
  }

  async function prepareImportFile(client: PoolClient | null, file: DownloadedFile): Promise<PreparedImportFile> {
    const contents = await readFile(file.localPath);
    const sha256 = hashBuffer(contents);
    const parsed = parseCsv(contents.toString("utf8"));
    const id = importFileId(file);
    let storageBucket: string | null = null;
    let storageKey: string | null = null;
    let storageStatus: RawStorageStatus = "not_requested";
    if (apply && client && !argSet.has("--no-upload") && storageConfigured()) {
      const location = await rawCsvStorageLocation(file);
      storageBucket = location.bucket;
      storageKey = location.key;
      storageStatus = "pending";
    }

    if (apply && client) {
      await insertFile(client, file, {
        id,
        sha256,
        byteSize: contents.byteLength,
        rowCount: parsed.rows.length,
        headers: parsed.headers,
        storageBucket,
        storageKey,
        storageStatus,
      });
      if (storageStatus === "pending" && storageBucket && storageKey) {
        try {
          await uploadRawCsv(file, contents, { bucket: storageBucket, key: storageKey });
          await updateFileStorageState(client, id, "uploaded", null);
        } catch (error) {
          await updateFileStorageState(client, id, "failed", errorMessage(error)).catch(() => undefined);
          throw error;
        }
      }
    }

    return { id, file, normalizedRows: await normalizeRows(client, file.widgetKey, parsed, file.scope) };
  }

  async function importPreparedFile(client: PoolClient | null, preparedFile: PreparedImportFile): Promise<FileImportStats> {
    const { file, normalizedRows } = preparedFile;
    if (!apply || !client) {
      return { rowCount: normalizedRows.length, inserted: normalizedRows.length, updated: 0, unchanged: 0 };
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of normalizedRows) {
      const result = await upsertMetricRow(client, file, row);
      if (result === "inserted") inserted++;
      else if (result === "updated") updated++;
      else unchanged++;
    }

    return { rowCount: normalizedRows.length, inserted, updated, unchanged };
  }

  async function rawCsvStorageLocation(file: DownloadedFile): Promise<{ bucket: string; key: string }> {
    const { getStorageBucket, tenantStorageKey } = await import("../src/server/storage");
    const storagePrefix = process.env.SISENSE_STORAGE_PREFIX ?? DEFAULT_STORAGE_PREFIX;
    return { bucket: getStorageBucket(), key: tenantStorageKey(orgId, `${storagePrefix}/${runId}/${file.fileName}`) };
  }

  async function uploadRawCsv(file: DownloadedFile, body: Buffer, location: { bucket: string; key: string }): Promise<void> {
    const { getStorageClient } = await import("../src/server/storage");
    await getStorageClient().send(new PutObjectCommand({
      Bucket: location.bucket,
      Key: location.key,
      Body: body,
      ContentType: "text/csv; charset=utf-8",
      Metadata: {
        org_id: orgId,
        source: SOURCE,
        run_id: runId,
        widget_key: file.widgetKey,
        artist_id: file.scope.artistId ?? "",
        release_id: file.scope.releaseId ?? "",
        track_id: file.scope.trackId ?? "",
      },
    }));
  }

  async function upsertMetricRow(
    client: PoolClient,
    file: DownloadedFile,
    row: NormalizedRow,
  ): Promise<"inserted" | "updated" | "unchanged"> {
    const id = `amr_${hashText(`${orgId}:${SOURCE}:${file.widgetKey}:${file.requestedAggregation}:${file.requestedDateRange}:${row.rowKey}`).slice(0, 40)}`;
    const existing = await client.query<{
      id: string;
      row_hash: string;
      raw_row: Record<string, string | null>;
    }>(
      `
        select id, row_hash, raw_row
        from ${tableName("analytics_metric_rows")}
        where org_id = $1
          and source = $2
          and widget_key = $3
          and requested_aggregation = $4
          and requested_date_range = $5
          and row_key = $6
        limit 1
      `,
      [orgId, SOURCE, file.widgetKey, file.requestedAggregation, file.requestedDateRange, row.rowKey],
    );

    if (!existing.rowCount) {
      await client.query(
        `
          insert into ${tableName("analytics_metric_rows")} (
            id, org_id, source, widget_key, artist_id, release_id, track_id, row_key, row_hash,
            requested_date_range, requested_aggregation,
            dimensions, metrics, raw_row,
            first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $15, now(), now())
        `,
        [
          id,
          orgId,
          SOURCE,
          file.widgetKey,
          row.scope.artistId,
          row.scope.releaseId,
          row.scope.trackId,
          row.rowKey,
          row.rowHash,
          file.requestedDateRange,
          file.requestedAggregation,
          JSON.stringify(row.dimensions),
          JSON.stringify(row.metrics),
          JSON.stringify(row.rawRow),
          runId,
        ],
      );
      await insertChange(client, id, file, row, "insert", null, null);
      return "inserted";
    }

    const previous = existing.rows[0];
    if (previous.row_hash === row.rowHash) {
      await client.query(
        `
          update ${tableName("analytics_metric_rows")}
          set last_seen_run_id = $1, last_seen_at = now()
          where id = $2
        `,
        [runId, previous.id],
      );
      return "unchanged";
    }

    await client.query(
      `
        update ${tableName("analytics_metric_rows")}
        set row_hash = $1,
            artist_id = $2,
            release_id = $3,
            track_id = $4,
            dimensions = $5::jsonb,
            metrics = $6::jsonb,
            raw_row = $7::jsonb,
            requested_date_range = $8,
            requested_aggregation = $9,
            last_seen_run_id = $10,
            last_seen_at = now()
        where id = $11
      `,
      [
        row.rowHash,
        row.scope.artistId,
        row.scope.releaseId,
        row.scope.trackId,
        JSON.stringify(row.dimensions),
        JSON.stringify(row.metrics),
        JSON.stringify(row.rawRow),
        file.requestedDateRange,
        file.requestedAggregation,
        runId,
        previous.id,
      ],
    );
    await insertChange(client, previous.id, file, row, "update", previous.row_hash, previous.raw_row);
    return "updated";
  }

  async function insertChange(
    client: PoolClient,
    metricRowId: string,
    file: DownloadedFile,
    row: NormalizedRow,
    changeType: "insert" | "update",
    previousHash: string | null,
    previousRawRow: Record<string, string | null> | null,
  ): Promise<void> {
    const id = `amc_${hashText(`${runId}:${metricRowId}:${changeType}`).slice(0, 40)}`;
    await client.query(
      `
        insert into ${tableName("analytics_metric_changes")} (
          id, org_id, run_id, metric_row_id, source, widget_key,
          artist_id, release_id, track_id, row_key,
          change_type, previous_hash, current_hash, previous_raw_row, current_raw_row, changed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, now())
      `,
      [
        id,
        orgId,
        runId,
        metricRowId,
        SOURCE,
        file.widgetKey,
        row.scope.artistId,
        row.scope.releaseId,
        row.scope.trackId,
        row.rowKey,
        changeType,
        previousHash,
        row.rowHash,
        previousRawRow ? JSON.stringify(previousRawRow) : null,
        JSON.stringify(row.rawRow),
      ],
    );
  }

  async function insertRun(
    client: PoolClient,
    input: { requestedDateRange: string; requestedAggregation: string; status: string; scope: AnalyticsScope },
  ): Promise<void> {
    await client.query(
      `
        insert into ${tableName("analytics_import_runs")} (
          id, org_id, source, artist_id, release_id, track_id, mode,
          requested_date_range, requested_aggregation, status, started_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11::jsonb)
      `,
      [
        runId,
        orgId,
        SOURCE,
        input.scope.artistId,
        input.scope.releaseId,
        input.scope.trackId,
        mode,
        input.requestedDateRange,
        input.requestedAggregation,
        input.status,
        JSON.stringify({
          dashboardUrl,
          dryRun: !apply,
          command: rawArgs,
          scope: input.scope,
        }),
      ],
    );
  }

  async function completeRun(
    client: PoolClient,
    input: {
      status: string;
      filesDownloaded: number;
      rowsImported: number;
      rowsInserted: number;
      rowsUpdated: number;
      rowsUnchanged: number;
      error?: string;
      completeness?: ScrapeCompleteness | null;
      providerFilterState?: ProviderFilterState | null;
      sourceFreshness?: { version: number; reportingThrough: string | null };
    },
  ): Promise<void> {
    await client.query(
      `
        update ${tableName("analytics_import_runs")}
        set status = $1,
            completed_at = now(),
            files_downloaded = $2,
            rows_imported = $3,
            rows_inserted = $4,
            rows_updated = $5,
            rows_unchanged = $6,
            error = $7,
            metadata = coalesce(metadata, '{}'::jsonb) || $9::jsonb
        where id = $8
      `,
      [
        input.status,
        input.filesDownloaded,
        input.rowsImported,
        input.rowsInserted,
        input.rowsUpdated,
        input.rowsUnchanged,
        input.error ?? null,
        runId,
        JSON.stringify({
          ...(input.completeness ? { completeness: input.completeness } : {}),
          ...(input.providerFilterState ? { providerFilterState: input.providerFilterState } : {}),
          ...(input.sourceFreshness ? { sourceFreshness: input.sourceFreshness } : {}),
        }),
      ],
    );
    logEvent({
      severity: input.status === "failed" ? "error" : "info",
      event: "analytics.ingestion_run.completed",
      orgId,
      outcome: input.status,
      rowsImported: input.rowsImported,
      rowsInserted: input.rowsInserted,
      rowsUpdated: input.rowsUpdated,
      rowsUnchanged: input.rowsUnchanged,
      filesDownloaded: input.filesDownloaded,
    });
  }

  async function insertFile(
    client: PoolClient,
    file: DownloadedFile,
    input: {
      id: string;
      sha256: string;
      byteSize: number;
      rowCount: number;
      headers: string[];
      storageBucket: string | null;
      storageKey: string | null;
      storageStatus: RawStorageStatus;
    },
  ): Promise<void> {
    await client.query(
      `
        insert into ${tableName("analytics_import_files")} (
          id, org_id, run_id, source, dashboard_url, widget_key, widget_title,
          artist_id, release_id, track_id,
          requested_date_range, requested_aggregation, file_name, local_path,
          storage_bucket, storage_key, storage_status, sha256, byte_size, row_count, headers, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, now())
      `,
      [
        input.id,
        orgId,
        runId,
        SOURCE,
        dashboardUrl ?? null,
        file.widgetKey,
        file.widgetTitle,
        file.scope.artistId,
        file.scope.releaseId,
        file.scope.trackId,
        file.requestedDateRange,
        file.requestedAggregation,
        file.fileName,
        file.localPath,
        input.storageBucket,
        input.storageKey,
        input.storageStatus,
        input.sha256,
        input.byteSize,
        input.rowCount,
        JSON.stringify(input.headers),
      ],
    );
  }

  async function updateFileStorageState(
    client: PoolClient,
    fileId: string,
    storageStatus: Exclude<RawStorageStatus, "not_requested" | "pending">,
    storageError: string | null,
  ): Promise<void> {
    await client.query(
      `
        update ${tableName("analytics_import_files")}
        set storage_status = $1,
            storage_uploaded_at = case when $1 = 'uploaded' then now() else storage_uploaded_at end,
            storage_error = $2
        where id = $3 and org_id = $4 and run_id = $5
      `,
      [storageStatus, storageError, fileId, orgId, runId],
    );
  }

  function importFileId(file: DownloadedFile): string {
    return `aif_${hashText(`${runId}:${file.widgetKey}:${file.fileName}`).slice(0, 40)}`;
  }

  async function successfulRunExists(pool: Pool, targetOrgId: string): Promise<boolean> {
    const result = await pool.query(
      `
        select 1
        from ${tableName("analytics_import_runs")}
        where org_id = $1
          and source = $2
          and status = 'completed'
          and mode in ('sync', 'import')
        limit 1
      `,
      [targetOrgId, SOURCE],
    ).catch(() => ({ rowCount: 0 }));
    return (result.rowCount ?? 0) > 0;
  }

  async function ensureOrgExists(client: PoolClient, targetOrgId: string): Promise<void> {
    const result = await client.query(
      `select 1 from ${tableName("orgs")} where id = $1 limit 1`,
      [targetOrgId],
    );
    if (!result.rowCount) fail(`Org '${targetOrgId}' does not exist.`);
  }

  async function acquireJobLock(client: PoolClient): Promise<boolean> {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
      [`label-suite:${orgId}:${SOURCE}`],
    );
    return result.rows[0]?.locked === true;
  }


  async function normalizeRows(
    client: PoolClient | null,
    widgetKey: string,
    csv: ParsedCsv,
    fileScope: AnalyticsScope,
  ): Promise<NormalizedRow[]> {
    const metricHeaders = new Set(metricHeaderNames(csv.headers, csv.rows));
    const rows: NormalizedRow[] = [];

    for (const [index, rawRow] of csv.rows.entries()) {
      const dimensions: Record<string, string | null> = {};
      const metrics: Record<string, number | null> = {};

      for (const header of csv.headers) {
        const value = rawRow[header] ?? null;
        if (metricHeaders.has(header)) {
          metrics[header] = parseSisenseMetric(value);
        } else {
          dimensions[header] = value;
        }
      }

      if (!Object.keys(dimensions).length) {
        dimensions.__row_index = String(index + 1);
      }

      const scope = await resolveRowScope(client, fileScope, rawRow);
      const rowKey = hashText(stableStringify({ widgetKey, scope, dimensions }));
      const rowHash = hashText(stableStringify({ dimensions, metrics }));
      rows.push({ rowKey, rowHash, scope, dimensions, metrics, rawRow });
    }

    return rows;
  }

  function readScopeInput(): ScopeInput {
    return {
      artistId: readOption("--artist-id") ?? readOption("--scope-artist-id") ?? process.env.SISENSE_SCOPE_ARTIST_ID,
      artistName: readOption("--artist-name") ?? readOption("--scope-artist-name") ?? process.env.SISENSE_SCOPE_ARTIST_NAME,
      releaseId: readOption("--release-id") ?? readOption("--scope-release-id") ?? process.env.SISENSE_SCOPE_RELEASE_ID,
      releaseTitle: readOption("--release-title") ?? readOption("--scope-release-title") ?? process.env.SISENSE_SCOPE_RELEASE_TITLE,
      trackId: readOption("--track-id") ?? readOption("--scope-track-id") ?? process.env.SISENSE_SCOPE_TRACK_ID,
      trackTitle: readOption("--track-title") ?? readOption("--scope-track-title") ?? process.env.SISENSE_SCOPE_TRACK_TITLE,
    };
  }

  async function resolveScope(client: PoolClient | null, input: ScopeInput): Promise<AnalyticsScope> {
    let scope = normalizeScope({
      artistId: cleanText(input.artistId),
      releaseId: cleanText(input.releaseId),
      trackId: cleanText(input.trackId),
    });

    const needsDbResolution = Boolean(input.artistName || input.releaseTitle || input.trackTitle);
    if (!client) {
      if (needsDbResolution && mode !== "scrape") {
        fail("DATABASE_URL is required to resolve SISENSE_SCOPE_* name/title values. Use *_ID values instead.");
      }
      return scope;
    }

    if (input.artistName) {
      const artistId = await resolveArtistIdByName(client, input.artistName, true);
      scope = mergeStrictScope(scope, { artistId, releaseId: null, trackId: null }, "artist name");
    }

    if (scope.trackId) scope = await fillScopeFromTrackId(client, scope);
    if (scope.releaseId) scope = await fillScopeFromReleaseId(client, scope);

    if (input.releaseTitle && !scope.releaseId) {
      const releaseScope = await resolveReleaseScopeByTitle(client, input.releaseTitle, scope.artistId, true);
      if (releaseScope) scope = mergeStrictScope(scope, releaseScope, "release title");
    }

    if (scope.releaseId) scope = await fillScopeFromReleaseId(client, scope);

    if (input.trackTitle && !scope.trackId) {
      const trackScope = await resolveTrackScope(client, {
        trackTitle: input.trackTitle,
        artistId: scope.artistId,
        releaseId: scope.releaseId,
      }, true);
      if (trackScope) scope = mergeStrictScope(scope, trackScope, "track title");
    }

    if (scope.trackId) scope = await fillScopeFromTrackId(client, scope);
    if (scope.releaseId) scope = await fillScopeFromReleaseId(client, scope);
    await ensureScopeIdsExist(client, scope);
    return scope;
  }

  async function resolveProviderScopeSelection(
    client: PoolClient | null,
    input: ScopeInput,
    scope: AnalyticsScope,
  ): Promise<ProviderScopeSelection> {
    let artist = cleanText(process.env.SISENSE_PROVIDER_ARTIST_FILTER) ?? cleanText(input.artistName);
    let track = cleanText(process.env.SISENSE_PROVIDER_TRACK_FILTER) ?? cleanText(input.trackTitle);

    if (client && scope.artistId && !artist) {
      const result = await client.query<{ name: string }>(
        `select name from ${tableName("artists")} where org_id = $1 and id = $2 limit 1`,
        [orgId, scope.artistId],
      );
      artist = cleanText(result.rows[0]?.name);
    }
    if (client && scope.trackId && !track) {
      const result = await client.query<{ title: string }>(
        `select title from ${tableName("tracks")} where org_id = $1 and id = $2 limit 1`,
        [orgId, scope.trackId],
      );
      track = cleanText(result.rows[0]?.title);
    }

    if (scope.artistId && !artist) fail("Configured Sisense artist scope could not be mapped to a provider artist filter.");
    if (scope.trackId && !track) fail("Configured Sisense track scope could not be mapped to a provider track filter.");
    if (track && !artist) fail("A Sisense track filter requires an artist filter.");
    return { artist, track };
  }

  function assertRequiredProviderScope(widgets: readonly WidgetTarget[], providerScope: ProviderScopeSelection): void {
    const grains = widgets.map((widget) => WIDGET_SCOPE_GRAIN[widget.key]);
    const needsArtist = grains.includes("artist");
    const needsTrack = grains.includes("track");
    if (needsArtist && !providerScope.artist) fail("Artist-scoped Sisense widgets require a configured artist filter.");
    if (needsTrack && (!providerScope.artist || !providerScope.track)) fail("Track-scoped Sisense widgets require configured artist and track filters.");
  }

  function scopeForWidget(widgetKey: string, scope: AnalyticsScope): AnalyticsScope {
    if (WIDGET_SCOPE_GRAIN[widgetKey] === "artist") return normalizeScope({ artistId: scope.artistId });
    if (WIDGET_SCOPE_GRAIN[widgetKey] === "global") return normalizeScope();
    return scope;
  }

  async function resolveRowScope(
    client: PoolClient | null,
    fileScope: AnalyticsScope,
    rawRow: Record<string, string | null>,
  ): Promise<AnalyticsScope> {
    if (!client) return fileScope;

    const isrc = firstRowValue(rawRow, ["isrc", "track_isrc", "recording_isrc"]);
    const trackTitle = firstRowValue(rawRow, ["track_title", "track", "track_name", "title"]);
    const artistName = firstRowValue(rawRow, ["primary_artist", "artist", "artist_name", "main_artist"]);

    if (isrc || trackTitle) {
      const trackScope =
        await resolveTrackScope(client, {
          isrc,
          trackTitle,
          artistName,
          artistId: fileScope.artistId,
        }, false) ??
        await resolveTrackScope(client, {
          isrc,
          trackTitle,
          artistName,
          artistId: fileScope.artistId,
          releaseId: fileScope.releaseId,
        }, false);
      if (trackScope) return mergeLooseScope(fileScope, trackScope);

      if (artistName) {
        const artistId = await resolveArtistIdByName(client, artistName, false);
        if (artistId) return normalizeScope({ artistId });
      }

      return normalizeScope({ artistId: fileScope.artistId });
    }

    if (artistName) {
      const artistId = await resolveArtistIdByName(client, artistName, false);
      if (artistId) return mergeLooseScope(fileScope, { artistId, releaseId: null, trackId: null });
    }

    return fileScope;
  }

  async function resolveArtistIdByName(
    client: PoolClient,
    name: string,
    failOnMissingOrAmbiguous: boolean,
  ): Promise<string | null> {
    const cleaned = cleanText(name);
    if (!cleaned) return null;

    const result = await client.query<{ id: string }>(
      `
        select id
        from ${tableName("artists")}
        where org_id = $1 and lower(name) = lower($2)
        limit 2
      `,
      [orgId, cleaned],
    );

    if (result.rows.length === 1) return result.rows[0].id;
    if (failOnMissingOrAmbiguous) {
      fail(result.rows.length ? `Artist name '${cleaned}' is ambiguous.` : `Artist name '${cleaned}' was not found.`);
    }
    return null;
  }

  async function resolveReleaseScopeByTitle(
    client: PoolClient,
    title: string,
    artistId: string | null,
    failOnMissingOrAmbiguous: boolean,
  ): Promise<AnalyticsScope | null> {
    const cleaned = cleanText(title);
    if (!cleaned) return null;

    const params: Array<string | null> = [orgId, cleaned];
    const conditions = [`r.org_id = $1`, `lower(r.title) = lower($2)`];
    if (artistId) {
      params.push(artistId);
      conditions.push(`r.artist_id = $${params.length}`);
    }

    const result = await client.query<{ release_id: string; artist_id: string | null }>(
      `
        select r.id as release_id, r.artist_id
        from ${tableName("releases")} r
        where ${conditions.join(" and ")}
        limit 2
      `,
      params,
    );

    if (result.rows.length === 1) {
      const row = result.rows[0];
      return normalizeScope({ artistId: row.artist_id, releaseId: row.release_id });
    }
    if (failOnMissingOrAmbiguous) {
      fail(result.rows.length ? `Release title '${cleaned}' is ambiguous.` : `Release title '${cleaned}' was not found.`);
    }
    return null;
  }

  async function resolveTrackScope(
    client: PoolClient,
    input: {
      isrc?: string | null;
      trackTitle?: string | null;
      artistName?: string | null;
      artistId?: string | null;
      releaseId?: string | null;
    },
    failOnMissingOrAmbiguous: boolean,
  ): Promise<AnalyticsScope | null> {
    const isrc = cleanText(input.isrc);
    const trackTitle = cleanText(input.trackTitle);
    if (!isrc && !trackTitle) return null;

    const params: Array<string | null> = [orgId];
    const conditions = [`t.org_id = $1`];
    if (isrc) {
      params.push(isrc);
      conditions.push(`(lower(t.isrc) = lower($${params.length}) or lower(w.isrc) = lower($${params.length}))`);
    } else if (trackTitle) {
      params.push(trackTitle);
      conditions.push(`(
        lower(t.title) = lower($${params.length}) or
        lower(trim(split_part(t.title, '[', 1))) = lower($${params.length}) or
        lower(w.title) = lower($${params.length}) or
        lower(trim(split_part(w.title, '[', 1))) = lower($${params.length})
      )`);
    }
    if (input.artistId) {
      params.push(input.artistId);
      conditions.push(`r.artist_id = $${params.length}`);
    }
    if (input.releaseId) {
      params.push(input.releaseId);
      conditions.push(`t.release_id = $${params.length}`);
    }
    if (input.artistName) {
      params.push(input.artistName);
      conditions.push(`lower(a.name) = lower($${params.length})`);
    }

    const result = await client.query<{ track_id: string; release_id: string | null; artist_id: string | null }>(
      `
        select distinct t.id as track_id, t.release_id, r.artist_id
        from ${tableName("tracks")} t
        left join ${tableName("works")} w on w.id = t.work_id and w.org_id = t.org_id
        left join ${tableName("releases")} r on r.id = t.release_id and r.org_id = t.org_id
        left join ${tableName("artists")} a on a.id = r.artist_id and a.org_id = t.org_id
        where ${conditions.join(" and ")}
        limit 2
      `,
      params,
    );

    if (result.rows.length === 1) {
      const row = result.rows[0];
      return normalizeScope({ artistId: row.artist_id, releaseId: row.release_id, trackId: row.track_id });
    }
    if (failOnMissingOrAmbiguous) {
      const label = isrc ? `ISRC '${isrc}'` : `track title '${trackTitle}'`;
      fail(result.rows.length ? `${label} is ambiguous.` : `${label} was not found.`);
    }
    return null;
  }

  async function fillScopeFromTrackId(client: PoolClient, scope: AnalyticsScope): Promise<AnalyticsScope> {
    if (!scope.trackId) return scope;

    const result = await client.query<{ track_id: string; release_id: string | null; artist_id: string | null }>(
      `
        select t.id as track_id, t.release_id, r.artist_id
        from ${tableName("tracks")} t
        left join ${tableName("releases")} r on r.id = t.release_id and r.org_id = t.org_id
        where t.org_id = $1 and t.id = $2
        limit 1
      `,
      [orgId, scope.trackId],
    );

    if (!result.rowCount) fail(`Track id '${scope.trackId}' was not found.`);
    const row = result.rows[0];
    return mergeStrictScope(scope, {
      artistId: row.artist_id,
      releaseId: row.release_id,
      trackId: row.track_id,
    }, "track id");
  }

  async function fillScopeFromReleaseId(client: PoolClient, scope: AnalyticsScope): Promise<AnalyticsScope> {
    if (!scope.releaseId) return scope;

    const result = await client.query<{ release_id: string; artist_id: string | null }>(
      `
        select id as release_id, artist_id
        from ${tableName("releases")}
        where org_id = $1 and id = $2
        limit 1
      `,
      [orgId, scope.releaseId],
    );

    if (!result.rowCount) fail(`Release id '${scope.releaseId}' was not found.`);
    const row = result.rows[0];
    return mergeStrictScope(scope, {
      artistId: row.artist_id,
      releaseId: row.release_id,
      trackId: null,
    }, "release id");
  }

  async function ensureScopeIdsExist(client: PoolClient, scope: AnalyticsScope): Promise<void> {
    if (scope.artistId) {
      const result = await client.query(`select 1 from ${tableName("artists")} where org_id = $1 and id = $2 limit 1`, [orgId, scope.artistId]);
      if (!result.rowCount) fail(`Artist id '${scope.artistId}' was not found.`);
    }
    if (scope.releaseId) {
      const result = await client.query(`select 1 from ${tableName("releases")} where org_id = $1 and id = $2 limit 1`, [orgId, scope.releaseId]);
      if (!result.rowCount) fail(`Release id '${scope.releaseId}' was not found.`);
    }
    if (scope.trackId) {
      const result = await client.query(`select 1 from ${tableName("tracks")} where org_id = $1 and id = $2 limit 1`, [orgId, scope.trackId]);
      if (!result.rowCount) fail(`Track id '${scope.trackId}' was not found.`);
    }
  }

  function mergeStrictScope(base: AnalyticsScope, incoming: AnalyticsScope, label: string): AnalyticsScope {
    for (const key of ["artistId", "releaseId", "trackId"] as const) {
      if (base[key] && incoming[key] && base[key] !== incoming[key]) {
        fail(`Scope conflict while resolving ${label}: ${key} '${incoming[key]}' does not match '${base[key]}'.`);
      }
    }
    return mergeLooseScope(base, incoming);
  }

  function mergeLooseScope(base: AnalyticsScope, incoming: AnalyticsScope): AnalyticsScope {
    return {
      artistId: incoming.artistId ?? base.artistId,
      releaseId: incoming.releaseId ?? base.releaseId,
      trackId: incoming.trackId ?? base.trackId,
    };
  }

  function normalizeScope(value?: Partial<AnalyticsScope> | null): AnalyticsScope {
    return {
      artistId: cleanText(value?.artistId) ?? null,
      releaseId: cleanText(value?.releaseId) ?? null,
      trackId: cleanText(value?.trackId) ?? null,
    };
  }

  function formatScope(scope: AnalyticsScope): string {
    const parts = [
      scope.artistId ? `artist=${scope.artistId}` : null,
      scope.releaseId ? `release=${scope.releaseId}` : null,
      scope.trackId ? `track=${scope.trackId}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "unscoped";
  }

  function firstRowValue(row: Record<string, string | null>, candidates: string[]): string | null {
    const entries = Object.entries(row);
    for (const candidate of candidates) {
      const match = entries.find(([key]) => normalizeHeaderKey(key) === normalizeHeaderKey(candidate));
      const value = cleanText(match?.[1]);
      if (value) return value;
    }
    return null;
  }

  function normalizeHeaderKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function metricHeaderNames(headers: string[], rows: Record<string, string | null>[]): string[] {
    return headers.filter((header) => {
      if (headerLooksLikeDimension(header)) return false;
      const values = rows.map((row) => row[header]).filter((value): value is string => Boolean(value?.trim()));
      if (!values.length) return false;
      return values.every((value) => parseSisenseMetric(value) !== null);
    });
  }

  function headerLooksLikeDimension(header: string): boolean {
    return /\b(date|week|month|year|period|artist|track|title|isrc|upc|ean|label|country|territory|platform|store|release|album|genre|currency|name|id)\b/i
      .test(header.replace(/[_-]+/g, " "));
  }


  function cleanText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  function readWidgets(): WidgetTarget[] {
    const raw = process.env.SISENSE_WIDGETS_JSON;
    if (!raw) return DEFAULT_WIDGETS;

    const parsed = JSON.parse(raw) as WidgetTarget[];
    if (!Array.isArray(parsed) || !parsed.length) fail("SISENSE_WIDGETS_JSON must be a non-empty JSON array.");

    for (const widget of parsed) {
      if (!widget.key) fail("Every SISENSE_WIDGETS_JSON item needs a key.");
    }
    return parsed;
  }

  async function writeRunManifest(
    runDir: string,
    files: DownloadedFile[],
    requestedDateRange: string,
    requestedAggregation: string,
    providerFilterState: ProviderFilterState,
    completeness: ScrapeCompleteness,
  ): Promise<void> {
    await writeFile(
      path.join(runDir, "manifest.json"),
      `${JSON.stringify({
        runId,
        orgId,
        source: SOURCE,
        dashboardUrl,
        requestedDateRange,
        requestedAggregation,
        providerFilterState,
        completeness,
        files: files.map((file) => ({
          widgetKey: file.widgetKey,
          widgetTitle: file.widgetTitle,
          fileName: file.fileName,
          requestedDateRange: file.requestedDateRange,
          requestedAggregation: file.requestedAggregation,
          scope: file.scope,
        })),
      }, null, 2)}\n`,
    );
  }

  async function writeScrapeDiagnosticSummary(input: {
    runDir: string;
    files: DownloadedFile[];
    requestedDateRange: string;
    requestedAggregation: string;
    providerFilterState: ProviderFilterState;
    observedAt: string;
    databaseLockHeld: boolean;
    completeness: ScrapeCompleteness;
  }): Promise<ScrapeDiagnosticSummary> {
    const files = await Promise.all(input.files.map(async (file) => {
      const contents = await readFile(file.localPath);
      return {
        widgetKey: file.widgetKey,
        rowCount: parseCsv(contents.toString("utf8")).rows.length,
        sha256: hashBuffer(contents),
      };
    }));
    files.sort((left, right) => left.widgetKey.localeCompare(right.widgetKey));

    const summary: ScrapeDiagnosticSummary = {
      version: 1,
      runId,
      mode: "scrape",
      requestedDateRange: input.requestedDateRange,
      requestedAggregation: input.requestedAggregation,
      observedAt: input.observedAt,
      providerFilterState: {
        aggregation: input.providerFilterState.aggregation,
        artist: input.providerFilterState.artist,
        dateRange: input.providerFilterState.dateRange,
        track: input.providerFilterState.track,
      },
      databaseLockHeld: input.databaseLockHeld,
      effectiveWidgetKeys: input.completeness.expectedWidgetKeys,
      effectiveWidgetCount: input.completeness.expectedWidgetKeys.length,
      downloadedWidgetKeys: input.completeness.downloadedWidgetKeys,
      observedEmptyWidgets: input.completeness.observedEmptyWidgets,
      skippedWidgets: input.completeness.skippedWidgets,
      completenessState: input.completeness.state,
      fileCount: files.length,
      files,
    };
    await writeFile(path.join(input.runDir, "diagnostic-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  async function readRunManifest(dir: string): Promise<{
    files: Map<string, Partial<DownloadedFile>>;
    completeness: ScrapeCompleteness | null;
    providerFilterState: ProviderFilterState | null;
  } | null> {
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
        files?: Partial<DownloadedFile>[];
        completeness?: ScrapeCompleteness;
        providerFilterState?: ProviderFilterState;
      };
      const files = new Map<string, Partial<DownloadedFile>>();
      for (const file of manifest.files ?? []) {
        if (file.fileName) files.set(file.fileName, file);
      }
      return {
        files,
        completeness: manifest.completeness ?? null,
        providerFilterState: manifest.providerFilterState ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  function inferWidgetForFile(
    fileName: string,
    requestedDateRange: string,
    requestedAggregation: string,
  ): WidgetTarget | null {
    const explicitWidgets = readWidgets()
      .slice()
      .sort((a, b) => b.key.length - a.key.length);
    const safeName = safeFileName(fileName.replace(/\.csv$/i, ""));
    const matchedWidget = explicitWidgets.find((widget) => {
      const keyPrefix = safeFileName(widget.key);
      return safeName === keyPrefix || safeName.startsWith(`${keyPrefix}-`);
    });
    if (matchedWidget) return matchedWidget;

    const marker = `-${safeFileName(requestedAggregation)}-${safeFileName(requestedDateRange)}-`;
    const markerIndex = safeName.indexOf(marker);
    if (markerIndex > 0) return { key: safeName.slice(0, markerIndex) };

    return null;
  }

  function readMode(): Mode {
    const modeValue = readOption("--mode") ?? "sync";
    if (modeValue === "sync" || modeValue === "scrape" || modeValue === "import") return modeValue;
    fail(`Unsupported mode '${modeValue}'.`);
  }

  function readOption(name: string): string | undefined {
    const index = rawArgs.indexOf(name);
    if (index >= 0) return rawArgs[index + 1];
    const prefix = `${name}=`;
    const value = rawArgs.find((arg) => arg.startsWith(prefix));
    return value?.slice(prefix.length);
  }

  function readBooleanEnv(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (!value) return fallback;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  async function csvFilesInDirectory(dir: string): Promise<string[]> {
    const entries = await readdir(dir);
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const entryStat = await stat(fullPath);
      if (entryStat.isFile() && entry.toLowerCase().endsWith(".csv")) files.push(fullPath);
    }
    return files.sort();
  }

  async function clickText(
    page: Page,
    label: string,
    options: { exact: boolean; timeoutMs?: number },
  ): Promise<void> {
    let locator = page.getByText(label, { exact: options.exact });
    if (options.exact && (await locator.count()) === 0) {
      locator = page.getByText(new RegExp(`^\\s*${escapeRegExp(label)}\\b(?:\\s*\\([^)]*\\))?\\s*$`));
    }
    const count = await locator.count();
    for (let i = count - 1; i >= 0; i--) {
      if (await clickIfReachable(locator.nth(i), options.timeoutMs ?? 5_000)) return;
    }
    throw new Error(`Could not click text '${label}'.`);
  }

  async function clickApplyIfPossible(page: Page, options: { required: boolean }): Promise<boolean> {
    const settingsFrames = page.locator("div.dashboard-settings-frame");
    if ((await settingsFrames.count()) !== 1) {
      const message = "Could not resolve exactly one scoped Sisense dashboard settings frame for Apply.";
      if (options.required) throw new Error(message);
      console.log(`${message} Continuing with selected filter state.`);
      return false;
    }

    const bottomMenus = settingsFrames.first().locator("div.bottom-menu-frame");
    if ((await bottomMenus.count()) !== 1) {
      const message = "Could not resolve exactly one scoped Sisense bottom menu for Apply.";
      if (options.required) throw new Error(message);
      console.log(`${message} Continuing with selected filter state.`);
      return false;
    }

    const apply = bottomMenus.first().locator("div.button.action-medium.apply-button");
    const visible: Locator[] = [];
    for (let index = 0; index < await apply.count(); index += 1) {
      const button = apply.nth(index);
      if ((await isVisible(button, 1_000)) && (await button.innerText()).trim().toLowerCase() === "apply") visible.push(button);
    }
    if (visible.length !== 1) {
      const message = "Could not resolve exactly one scoped Sisense Apply control.";
      if (options.required) throw new Error(message);
      console.log(`${message} Continuing with selected filter state.`);
      return false;
    }

    const button = visible[0];
    const disabled = await button.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      return (
        htmlElement.getAttribute("aria-disabled") === "true" ||
        htmlElement.classList.contains("disabled") ||
        htmlElement.className.includes("inactive") ||
        htmlElement.closest("button")?.disabled === true ||
        htmlElement.closest("[aria-disabled='true']") !== null ||
        htmlElement.closest(".disabled") !== null ||
        htmlElement.closest("[class*='inactive']") !== null
      );
    }).catch(() => false);
    if (disabled) {
      const message = "Sisense Apply button is disabled; filters appear unchanged.";
      if (options.required) throw new Error(message);
      console.log(message);
      return false;
    }
    if (await clickIfReachable(button, 5_000)) return true;
    const message = "Could not click scoped Sisense Apply button.";
    if (options.required) throw new Error(message);
    console.log(`${message} Continuing with selected filter state.`);
    return false;
  }

  async function assertVisibleFilterState(page: Page, kind: "aggregation" | "date range", label: string): Promise<string> {
    const summaryDimension = kind === "aggregation" ? "Aggregation" : "DateRange";
    const group = await resolveProviderSummaryGroup(page, summaryDimension);
    const labels = group.locator(":scope > div.filter > span.label");
    if ((await labels.count()) === 1 && await isVisible(labels.first(), 1_000)) {
      const observed = (await labels.first().innerText()).trim();
      if (observed === label) return observed;
    }
    throw new Error(`Requested ${kind} '${label}' is not visibly active.`);
  }

  async function assertVisibleFilterValue(
    page: Page,
    dimension: "True_Nature_Artists" | "True_Nature_Tracks",
    label: string,
  ): Promise<string> {
    const group = await resolveProviderSummaryGroup(page, dimension);
    const labels = group.locator(":scope > div.filter > span.label");
    if ((await labels.count()) === 1 && await isVisible(labels.first(), 1_000)) {
      const observed = (await labels.first().innerText()).trim();
      if (observed === label) return observed;
    }
    throw new Error(`Requested ${dimension} filter is not visibly active.`);
  }

  async function clickIfReachable(locator: Locator, timeoutMs: number): Promise<boolean> {
    try {
      await locator.waitFor({ state: "attached", timeout: timeoutMs });
      await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch {
      try {
        await locator.evaluate((element) => {
          const target = element as HTMLElement;
          target.scrollIntoView({ block: "center", inline: "center" });
          const clickable = target.closest("label") ?? target.closest("li") ?? target;
          (clickable as HTMLElement).click();
        }, { timeout: timeoutMs });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function clickElementIfReachable(element: ElementHandle, timeoutMs: number): Promise<boolean> {
    try {
      await element.scrollIntoViewIfNeeded({ timeout: timeoutMs });
      await element.click({ timeout: timeoutMs });
      return true;
    } catch {
      try {
        await element.evaluate((node) => {
          const target = node as HTMLElement;
          target.scrollIntoView({ block: "center", inline: "center" });
          const clickable = target.closest("label") ?? target.closest("li") ?? target;
          (clickable as HTMLElement).click();
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function isVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  function storageConfigured(): boolean {
    return Boolean(process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
  }

  function shouldFailAfterRawStaging(): boolean {
    if (process.env.SISENSE_TEST_FAIL_AFTER_RAW_STAGING !== "1") return false;
    return true;
  }

  function assertForcedFailureSeamTarget(): void {
    if (process.env.SISENSE_TEST_FAIL_AFTER_RAW_STAGING !== "1") return;
    assertDisposableForcedFailureTarget({
      databaseUrl,
      schema: process.env.SISENSE_DB_SCHEMA,
      fixtureDb: process.env.ANALYTICS_FIXTURE_DB,
      fixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
    });
  }

  function safeFileName(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180);
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hashText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function hashBuffer(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(",")}}`;
  }

  function tableName(name: string): string {
    return `"${schema}"."${sqlIdentifier(name)}"`;
  }

  function sqlIdentifier(value: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new Error(`Invalid SQL identifier '${value}'`);
    }
    return value;
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function isPlaywrightTimeoutError(error: unknown): boolean {
    return error instanceof errors.TimeoutError;
  }

  function fail(message: string): never {
    throw new Error(message);
  }

}
