import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERFORMANCE_BUDGET_MS,
  logAnalyticsIngestionHealth,
  logEvent,
  observeOperation,
  requestPerformanceBudget,
} from "./observability";

describe("structured observability", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits parseable correlation fields", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logEvent({
      severity: "info",
      event: "request.completed",
      requestId: "request-1",
      route: "/api/catalog",
      orgId: "org-1",
      durationMs: 12.5,
      outcome: "succeeded",
    });

    const record = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      severity: "info",
      event: "request.completed",
      requestId: "request-1",
      route: "/api/catalog",
      orgId: "org-1",
      durationMs: 12.5,
      outcome: "succeeded",
    });
    expect(record.timestamp).toBeTypeOf("string");
  });

  it("times successful and failed operations without changing behavior", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(observeOperation("catalog.workspace", "org-1", async () => 42)).resolves.toBe(42);
    await expect(observeOperation("catalog.workspace", "org-1", async () => {
      throw new TypeError("database unavailable");
    })).rejects.toThrow("database unavailable");

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ outcome: "succeeded" });
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
      outcome: "failed",
      errorClass: "TypeError",
    });
  });

  it("classifies request performance budgets", () => {
    expect(requestPerformanceBudget("/api/catalog", "GET")).toBe(PERFORMANCE_BUDGET_MS.apiRead);
    expect(requestPerformanceBudget("/api/catalog", "POST")).toBe(PERFORMANCE_BUDGET_MS.apiMutation);
    expect(requestPerformanceBudget("/catalog", "GET")).toBe(PERFORMANCE_BUDGET_MS.ssr);
    expect(PERFORMANCE_BUDGET_MS.jobHeartbeat).toBeLessThanOrEqual(60_000);
  });

  it("logs only compact ingestion-health fields, never raw analytics evidence", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logAnalyticsIngestionHealth({
      orgId: "org-1",
      stale: true,
      failedRuns: 2,
      unreviewedDuplicateCandidates: 3,
      lastSuccessfulRunAt: new Date("2026-07-29T10:00:00Z"),
      sourceObservedAt: new Date("2026-07-29T10:00:00Z"),
      reportingThrough: new Date("2026-07-28T00:00:00Z"),
      freshnessBasis: "row_reporting_date",
      coverage: "complete",
      rawEvidence: [{ isrc: "secret-isrc" }],
    } as never);

    const serialized = String(output.mock.calls[0]?.[0]);
    const record = JSON.parse(serialized);
    expect(record).toMatchObject({
      event: "analytics.ingestion_health",
      severity: "warn",
      orgId: "org-1",
      stale: true,
      failedRuns: 2,
      unreviewedDuplicateCandidates: 3,
    });
    expect(serialized).not.toContain("secret-isrc");
  });
});
