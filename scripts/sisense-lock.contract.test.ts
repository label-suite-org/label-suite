import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const importer = readFileSync(new URL("./sisense-sync.ts", import.meta.url), "utf8");
const runModule = readFileSync(new URL("./sisense-ingestion-run.ts", import.meta.url), "utf8");

describe("Sisense Ingestion Run boundary", () => {
  it("routes the command through the shared lifecycle instead of owning phase choreography", () => {
    expect(importer).toContain("runSisenseIngestionRun");
    expect(importer).not.toContain("let lockTransactionOpen");
    expect(importer).not.toContain("let importTransactionOpen");
  });

  it("keeps transaction-scoped locking and failure cleanup at the lifecycle seam", () => {
    expect(runModule).toContain("acquireLock");
    expect(runModule).toContain("rollbackPublication");
    expect(runModule).toContain("recordFailure");
    expect(runModule).toContain("await releaseLock?.()");
    expect(runModule).toContain("SisenseIngestionLockError");
  });

  it("keeps browser and saved-file acquisition behind the same adapter result", () => {
    expect(importer).toContain("importModeFiles(client, requestedDateRange, requestedAggregation, baseScope)");
    expect(importer).toContain("scrapeDashboard(requestedDateRange, requestedAggregation, baseScope, providerScope)");
    expect(importer).toContain("return { files: scrape.files, completeness: scrape.completeness }");
  });
});
