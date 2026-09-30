import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runSisenseIngestionRun, type SisenseAcquisition } from "./sisense-ingestion-run";

let directory: string;
let acquisition: SisenseAcquisition;
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("SISENSE_DB_SCHEMA", undefined);
  vi.stubEnv("SISENSE_TEST_FAIL_AFTER_RAW_STAGING", undefined);
  vi.stubEnv("SISENSE_DASHBOARD_URL", "https://sisense.example.test");
  directory = await mkdtemp(path.join(tmpdir(), "sisense-run-"));
  await writeFile(path.join(directory, "streams.csv"), "date,streams\n2026-07-28,12\n");
  acquisition = {
    files: [{ widgetKey: "fixture-streams", widgetTitle: null, fileName: "streams.csv", localPath: path.join(directory, "streams.csv"), requestedDateRange: "All Dates", requestedAggregation: "Daily", scope: { artistId: null, releaseId: null, trackId: null } }],
    completeness: { version: 2, expectedWidgetKeys: ["fixture-streams"], downloadedWidgetKeys: ["fixture-streams"], observedEmptyWidgets: [], skippedWidgets: [], state: "complete" },
    providerFilterState: { artist: null, track: null, dateRange: "All Dates", aggregation: "Daily" },
    providerFilterObservedAt: "2026-07-29T00:00:00.000Z", runDir: directory,
  };
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

it("normalizes deterministic provider acquisition and saved files through the same dry run", async () => {
  const acquire = vi.fn().mockResolvedValue(acquisition);
  const browser = await runSisenseIngestionRun({ args: ["--org", "fixture-org"], acquire });
  const saved = await runSisenseIngestionRun({ args: ["--org", "fixture-org", "--mode", "import", "--file", acquisition.files[0].localPath, "--widget-key", "fixture-streams"] });
  expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ orgId: "fixture-org", scope: { artistId: null, releaseId: null, trackId: null }, requestedDateRange: "All Dates", requestedAggregation: "Daily" }));
  expect(browser?.stats).toEqual({ filesDownloaded: 1, rowsImported: 1, rowsInserted: 1, rowsUpdated: 0, rowsUnchanged: 0 });
  expect(saved?.stats).toEqual(browser?.stats);
  expect(browser?.sourceFreshness).toEqual({ version: 1, reportingThrough: "2026-07-28T00:00:00.000Z" });
  expect(saved?.sourceFreshness).toEqual(browser?.sourceFreshness);
  expect(saved?.acquisition.files).toEqual(browser?.acquisition.files);
});

it("rejects partial acquisition before reading its files", async () => {
  acquisition.completeness!.state = "partial";
  acquisition.files[0].localPath = path.join(directory, "missing.csv");
  await expect(runSisenseIngestionRun({ acquire: async () => acquisition })).rejects.toThrow("Sisense acquisition is partial; refusing to publish incomplete analytics.");
});

it("writes the exact scrape diagnostic marker and raw-file summary through the run", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const result = await runSisenseIngestionRun({ args: ["--mode", "scrape"], acquire: async () => acquisition });
  const summary = JSON.parse(await readFile(path.join(directory, "diagnostic-summary.json"), "utf8"));
  expect(summary).toMatchObject({ version: 1, mode: "scrape", databaseLockHeld: false, completenessState: "complete", fileCount: 1, files: [{ widgetKey: "fixture-streams", rowCount: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  expect(output).toHaveBeenCalledWith(`SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify(summary)}`);
  expect(result?.stats.rowsImported).toBe(0);
});

it("rejects saved partial manifests through the same completeness gate", async () => {
  acquisition.completeness!.state = "partial";
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(acquisition));
  await expect(runSisenseIngestionRun({ args: ["--mode", "import", "--dir", directory] })).rejects.toThrow("Sisense acquisition is partial; refusing to publish incomplete analytics.");
});

it("allows an intentional single-file replay but rejects missing files in a directory replay", async () => {
  acquisition.completeness!.expectedWidgetKeys.push("second-widget");
  acquisition.completeness!.downloadedWidgetKeys.push("second-widget");
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(acquisition));
  const selected = await runSisenseIngestionRun({ args: ["--mode", "import", "--file", acquisition.files[0].localPath] });
  expect(selected?.stats.rowsImported).toBe(1);
  expect(selected?.acquisition.completeness?.downloadedWidgetKeys).toEqual(["fixture-streams"]);
  await expect(runSisenseIngestionRun({ args: ["--mode", "import", "--dir", directory] })).rejects.toThrow("Selected import files do not match the manifest's downloaded widget set.");
});

it("retains a legacy manifest's internal scope without provider filter metadata", async () => {
  acquisition.files[0].scope = { artistId: "artist-a", releaseId: "release-a", trackId: "track-a" };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ files: acquisition.files, completeness: acquisition.completeness }));
  const replay = await runSisenseIngestionRun({ args: ["--mode", "import", "--dir", directory] });
  expect(replay?.stats.rowsImported).toBe(1);
  expect(replay?.acquisition.files[0].scope).toEqual(acquisition.files[0].scope);
});
