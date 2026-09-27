import { describe, expect, it } from "vitest";

import { classifySisenseDiagnosticLog } from "./sisense-diagnostic-log-probe";

const summary = {
  version: 1,
  runId: "sisense_20260803120000_1234abcd",
  mode: "scrape",
  requestedDateRange: "7 Days",
  requestedAggregation: "Daily",
  observedAt: "2026-08-03T12:00:00.000Z",
  providerFilterState: { artist: "True Blue", dateRange: "7 Days", aggregation: "Daily", track: "Fountain" },
  databaseLockHeld: true,
  effectiveWidgetKeys: ["apple-streams-source", "tracks-by-growth-rate"],
  effectiveWidgetCount: 2,
  downloadedWidgetKeys: ["apple-streams-source"],
  observedEmptyWidgets: [{ key: "tracks-by-growth-rate", reason: "Query returned no matching rows." }],
  skippedWidgets: [],
  completenessState: "complete",
  fileCount: 1,
  files: [{ widgetKey: "apple-streams-source", rowCount: 7, sha256: "a".repeat(64) }],
} as const;

describe("Sisense diagnostic log probe", () => {
  it("accepts one bounded diagnostic failure marker and retains only its allowlisted code", () => {
    const outcome = classifySisenseDiagnosticLog(`provider text: The password is hunter2 at https://example.invalid/private\nSISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({
      version: 1,
      code: "provider_filters",
      secret: "hunter2",
      url: "https://example.invalid/private",
      providerText: "The provider said this should never be retained.",
    })}\n`);

    expect(outcome).toEqual({
      kind: "valid_failure_marker",
      terminal: "error",
      failure: { version: 1, code: "provider_filters" },
    });
    expect(JSON.stringify(outcome)).not.toContain("hunter2");
    expect(JSON.stringify(outcome)).not.toContain("example.invalid");
    expect(JSON.stringify(outcome)).not.toContain("provider said");
  });

  it.each([
    ["missing", "", "diagnostic_marker_count"],
    ["malformed", "SISENSE_DIAGNOSTIC_FAILURE {not-json}", "diagnostic_failure_marker_json"],
    ["duplicate", `SISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "configuration" })}\nSISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "configuration" })}`, "diagnostic_failure_marker_count"],
    ["oversized", `SISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "configuration", padding: "x".repeat(1_000) })}`, "diagnostic_failure_marker_too_large"],
    ["unknown code", `SISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "provider_password_hunter2" })}`, "diagnostic_failure_marker_schema"],
  ])("fails %s diagnostic failure evidence closed", (_label, marker, code) => {
    expect(classifySisenseDiagnosticLog(`${marker}\n`)).toMatchObject({
      kind: "log_without_marker",
      terminal: "error",
      code,
    });
  });

  it("fails closed when a success summary and a diagnostic failure marker conflict", () => {
    expect(classifySisenseDiagnosticLog(
      `SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify(summary)}\nSISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "widget_export_resolution" })}\nCommand executed successfully\n`,
    )).toEqual({
      kind: "log_without_marker",
      terminal: "done",
      code: "diagnostic_marker_conflict",
    });
  });

  it("does not treat a diagnostic failure marker as transport-proof evidence", () => {
    expect(classifySisenseDiagnosticLog(
      `SISENSE_DIAGNOSTIC_FAILURE ${JSON.stringify({ version: 1, code: "provider_navigation_authentication" })}\n`,
      "transport-proof",
    )).toEqual({
      kind: "log_without_marker",
      terminal: "error",
      code: "transport_proof_marker_count",
    });
  });

  it("accepts the exact marker emitted by sisense-sync and retains only validated evidence", () => {
    const outcome = classifySisenseDiagnosticLog(`boot\nSISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify(summary)}\nCommand executed successfully\n`);
    expect(outcome).toMatchObject({ kind: "valid_marker", terminal: "done", summary });
  });

  it("does not accept the obsolete marker spelling or malformed widget file fields", () => {
    expect(classifySisenseDiagnosticLog(`SISENSE_DIAGNOSTIC_RESULT=${JSON.stringify(summary)}\nCommand executed successfully`))
      .toMatchObject({ kind: "log_without_marker", code: "diagnostic_marker_count" });
    expect(classifySisenseDiagnosticLog(`SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify({ ...summary, files: [{ widgetId: "apple-streams-source" }] })}\nCommand executed successfully`))
      .toMatchObject({ kind: "log_without_marker", code: "diagnostic_marker_schema" });
  });

  it("accepts exactly one bounded transport proof marker and strips untrusted fields", () => {
    const proof = {
      version: 1,
      expectedRevision: "a".repeat(40),
      observedRevision: "a".repeat(40),
      secret: "discard",
    };

    expect(classifySisenseDiagnosticLog(
      `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify(proof)}\nCommand executed successfully\n`,
      "transport-proof",
    )).toEqual({
      kind: "valid_transport_proof",
      terminal: "done",
      proof: {
        version: 1,
        expectedRevision: "a".repeat(40),
        observedRevision: "a".repeat(40),
      },
    });
  });

  it.each([
    ["missing", "Command executed successfully\n", "transport_proof_marker_count"],
    ["malformed", "LABEL_SUITE_TRANSPORT_PROOF {not-json}\nCommand executed successfully\n", "transport_proof_marker_json"],
    ["duplicate", `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({ version: 1, expectedRevision: "a".repeat(40), observedRevision: "a".repeat(40) })}\nLABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({ version: 1, expectedRevision: "a".repeat(40), observedRevision: "a".repeat(40) })}\nCommand executed successfully\n`, "transport_proof_marker_count"],
    ["oversized", `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({ version: 1, expectedRevision: "a".repeat(40), observedRevision: "a".repeat(40), padding: "x".repeat(1_000) })}\nCommand executed successfully\n`, "transport_proof_marker_too_large"],
  ])("fails %s transport proof evidence closed", (_label, log, code) => {
    expect(classifySisenseDiagnosticLog(log, "transport-proof"))
      .toMatchObject({ kind: "log_without_marker", terminal: "done", code });
  });

  it.each([
    ["no delimiter", "LABEL_SUITE_TRANSPORT_PROOF{not-json}"],
    ["a tab delimiter", "LABEL_SUITE_TRANSPORT_PROOF\t{not-json}"],
  ])("rejects a valid proof followed by a second marker with %s", (_label, malformedMarker) => {
    const validMarker = `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({
      version: 1,
      expectedRevision: "a".repeat(40),
      observedRevision: "a".repeat(40),
    })}`;

    expect(classifySisenseDiagnosticLog(
      `${validMarker}\n${malformedMarker}\nCommand executed successfully\n`,
      "transport-proof",
    )).toMatchObject({
      kind: "log_without_marker",
      terminal: "done",
      code: "transport_proof_marker_count",
    });
  });

  it.each([
    ["effective count mismatch", { ...summary, effectiveWidgetCount: 99 }],
    ["file count mismatch", { ...summary, fileCount: 99 }],
    ["oversized files", {
      ...summary,
      fileCount: 65,
      files: Array.from({ length: 65 }, (_, index) => ({
        widgetKey: `widget-${index}`,
        rowCount: 1,
        sha256: "a".repeat(64),
      })),
    }],
  ])("rejects %s before producing sanitized marker evidence", (_label, malformed) => {
    expect(classifySisenseDiagnosticLog(`SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify(malformed)}\nCommand executed successfully\n`))
      .toMatchObject({ kind: "log_without_marker", code: "diagnostic_marker_schema" });
  });
});
