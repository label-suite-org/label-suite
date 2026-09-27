import type { DiagnosticSummary } from "./sisense-diagnostic-controller";
import {
  isDiagnosticFailureCode,
  type DiagnosticFailure,
} from "./sisense-diagnostic-failure";

export type DiagnosticMode = "diagnostic" | "transport-proof";

export type TransportProof = {
  version: 1;
  expectedRevision: string;
  observedRevision: string;
};

export type ProbeOutcome =
  | { kind: "valid_marker"; terminal: "done" | "error"; summary: DiagnosticSummary }
  | { kind: "valid_failure_marker"; terminal: "done" | "error"; failure: DiagnosticFailure }
  | { kind: "valid_transport_proof"; terminal: "done" | "error"; proof: TransportProof }
  | {
      kind: "log_without_marker";
      terminal: "done" | "error";
      code:
        | "diagnostic_marker_count"
        | "diagnostic_marker_json"
        | "diagnostic_marker_schema"
        | "diagnostic_marker_conflict"
        | "diagnostic_failure_marker_count"
        | "diagnostic_failure_marker_delimiter"
        | "diagnostic_failure_marker_json"
        | "diagnostic_failure_marker_schema"
        | "diagnostic_failure_marker_too_large"
        | "transport_proof_marker_count"
        | "transport_proof_marker_delimiter"
        | "transport_proof_marker_json"
        | "transport_proof_marker_schema"
        | "transport_proof_marker_too_large";
    }
  | {
      kind: "retrieval_unavailable";
      code: "deployment_log_timeout" | "deployment_log_too_large" | "deployment_log_connection" | "deployment_log_invalid";
    };

const diagnosticMarkerPattern = /^SISENSE_DIAGNOSTIC_SUMMARY (\{.*\})$/gm;
const diagnosticFailureMarkerToken = "SISENSE_DIAGNOSTIC_FAILURE";
const maxDiagnosticFailureMarkerBytes = 256;
const transportProofMarkerToken = "LABEL_SUITE_TRANSPORT_PROOF";
const maxTransportProofMarkerBytes = 512;

/**
 * Classifies a completed Dokploy log without retaining the raw log or parser
 * errors. Transport failures are intentionally represented by the adapter as
 * `retrieval_unavailable`, rather than being serialized to the attempt ledger.
 */
export function classifySisenseDiagnosticLog(log: string, mode: DiagnosticMode = "diagnostic"): ProbeOutcome {
  return mode === "transport-proof"
    ? classifyTransportProofLog(log)
    : classifyDiagnosticLog(log);
}

function classifyDiagnosticLog(log: string): ProbeOutcome {
  const terminal = terminalStatus(log);
  const summary = classifyDiagnosticSummary(log, terminal);
  const failureMarkers = log.split(/\r?\n/).filter(isDiagnosticFailureMarkerCandidate);

  if (summary.kind === "valid_marker") {
    return failureMarkers.length
      ? { kind: "log_without_marker", terminal, code: "diagnostic_marker_conflict" }
      : summary;
  }
  if (failureMarkers.length) return classifyDiagnosticFailureMarker(failureMarkers, terminal);
  return summary;
}

function classifyDiagnosticSummary(log: string, terminal: "done" | "error"): ProbeOutcome {
  const markers = [...log.matchAll(diagnosticMarkerPattern)];
  if (markers.length !== 1) return { kind: "log_without_marker", terminal, code: "diagnostic_marker_count" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(markers[0][1]);
  } catch {
    return { kind: "log_without_marker", terminal, code: "diagnostic_marker_json" };
  }

  if (!isDiagnosticSummary(parsed)) {
    return { kind: "log_without_marker", terminal, code: "diagnostic_marker_schema" };
  }
  return { kind: "valid_marker", terminal, summary: sanitizeSummary(parsed) };
}

function classifyDiagnosticFailureMarker(
  markers: string[],
  terminal: "done" | "error",
): ProbeOutcome {
  if (markers.length !== 1) return { kind: "log_without_marker", terminal, code: "diagnostic_failure_marker_count" };

  const marker = markers[0];
  if (marker[diagnosticFailureMarkerToken.length] !== " " || marker[diagnosticFailureMarkerToken.length + 1] !== "{") {
    return { kind: "log_without_marker", terminal, code: "diagnostic_failure_marker_delimiter" };
  }

  const payload = marker.slice(diagnosticFailureMarkerToken.length + 1);
  if (Buffer.byteLength(payload, "utf8") > maxDiagnosticFailureMarkerBytes) {
    return { kind: "log_without_marker", terminal, code: "diagnostic_failure_marker_too_large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: "log_without_marker", terminal, code: "diagnostic_failure_marker_json" };
  }
  if (!isDiagnosticFailure(parsed)) {
    return { kind: "log_without_marker", terminal, code: "diagnostic_failure_marker_schema" };
  }
  return { kind: "valid_failure_marker", terminal, failure: sanitizeDiagnosticFailure(parsed) };
}

function classifyTransportProofLog(log: string): ProbeOutcome {
  const terminal = terminalStatus(log);
  const markers = log
    .split(/\r?\n/)
    .filter(isTransportProofMarkerCandidate);
  if (markers.length !== 1) return { kind: "log_without_marker", terminal, code: "transport_proof_marker_count" };

  const marker = markers[0];
  if (marker[transportProofMarkerToken.length] !== " " || marker[transportProofMarkerToken.length + 1] !== "{") {
    return { kind: "log_without_marker", terminal, code: "transport_proof_marker_delimiter" };
  }

  const payload = marker.slice(transportProofMarkerToken.length + 1);
  if (Buffer.byteLength(payload, "utf8") > maxTransportProofMarkerBytes) {
    return { kind: "log_without_marker", terminal, code: "transport_proof_marker_too_large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: "log_without_marker", terminal, code: "transport_proof_marker_json" };
  }
  if (!isTransportProof(parsed)) {
    return { kind: "log_without_marker", terminal, code: "transport_proof_marker_schema" };
  }
  return { kind: "valid_transport_proof", terminal, proof: sanitizeTransportProof(parsed) };
}

function terminalStatus(log: string): "done" | "error" {
  return log.includes("Command executed successfully") ? "done" : "error";
}

function isDiagnosticSummary(value: unknown): value is DiagnosticSummary {
  if (!isRecord(value) || value.version !== 1 || typeof value.runId !== "string") return false;
  if (
    value.mode !== "scrape" ||
    value.requestedDateRange !== "7 Days" ||
    value.requestedAggregation !== "Daily" ||
    typeof value.observedAt !== "string" ||
    value.databaseLockHeld !== true ||
    !isRecord(value.providerFilterState) ||
    !isScopeLabel(value.providerFilterState.artist) ||
    value.providerFilterState.dateRange !== "7 Days" ||
    value.providerFilterState.aggregation !== "Daily" ||
    !isScopeLabel(value.providerFilterState.track) ||
    !/^sisense_\d{14}_[a-f0-9]{8}$/.test(value.runId) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt) ||
    !isWidgetKeyArray(value.effectiveWidgetKeys) ||
    !isSafeCount(value.effectiveWidgetCount) ||
    !isWidgetKeyArray(value.downloadedWidgetKeys) ||
    !isWidgetIssueArray(value.observedEmptyWidgets, "Query returned no matching rows.") ||
    !isWidgetIssueArray(value.skippedWidgets, "No uniquely observable export action was available after opening the scoped widget menu.") ||
    (value.completenessState !== "complete" && value.completenessState !== "partial" && value.completenessState !== "empty") ||
    !isSafeCount(value.fileCount) ||
    !Array.isArray(value.files) ||
    value.files.length > 64 ||
    value.effectiveWidgetCount !== value.effectiveWidgetKeys.length ||
    value.fileCount !== value.files.length
  ) {
    return false;
  }
  return value.files.every(
    (file) =>
      isRecord(file) &&
      isWidgetKey(file.widgetKey) &&
      isSafeCount(file.rowCount) &&
      typeof file.sha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(file.sha256),
  );
}

function isTransportProof(value: unknown): value is TransportProof {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRevision(value.expectedRevision) &&
    (isRevision(value.observedRevision) || value.observedRevision === "invalid")
  );
}

function isDiagnosticFailure(value: unknown): value is DiagnosticFailure {
  return isRecord(value) && value.version === 1 && isDiagnosticFailureCode(value.code);
}

function isDiagnosticFailureMarkerCandidate(line: string): boolean {
  if (!line.startsWith(diagnosticFailureMarkerToken)) return false;
  const next = line[diagnosticFailureMarkerToken.length];
  return next === undefined || !/[a-z0-9_]/i.test(next);
}

function isTransportProofMarkerCandidate(line: string): boolean {
  if (!line.startsWith(transportProofMarkerToken)) return false;
  const next = line[transportProofMarkerToken.length];
  return next === undefined || !/[a-z0-9_]/i.test(next);
}

function sanitizeSummary(summary: DiagnosticSummary): DiagnosticSummary {
  return {
    version: 1,
    runId: summary.runId,
    mode: "scrape",
    requestedDateRange: "7 Days",
    requestedAggregation: "Daily",
    observedAt: summary.observedAt,
    providerFilterState: {
      artist: summary.providerFilterState.artist,
      dateRange: "7 Days",
      aggregation: "Daily",
      track: summary.providerFilterState.track,
    },
    databaseLockHeld: true,
    effectiveWidgetKeys: [...summary.effectiveWidgetKeys],
    effectiveWidgetCount: summary.effectiveWidgetCount,
    downloadedWidgetKeys: [...summary.downloadedWidgetKeys],
    observedEmptyWidgets: summary.observedEmptyWidgets.map(({ key, reason }) => ({ key, reason })),
    skippedWidgets: summary.skippedWidgets.map(({ key, reason }) => ({ key, reason })),
    completenessState: summary.completenessState,
    fileCount: summary.fileCount,
    files: summary.files.map(({ widgetKey, rowCount, sha256 }) => ({ widgetKey, rowCount, sha256 })),
  };
}

function sanitizeTransportProof(proof: TransportProof): TransportProof {
  return {
    version: 1,
    expectedRevision: proof.expectedRevision,
    observedRevision: proof.observedRevision,
  };
}

function sanitizeDiagnosticFailure(failure: DiagnosticFailure): DiagnosticFailure {
  return { version: 1, code: failure.code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWidgetKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function isWidgetKeyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(isWidgetKey);
}

function isWidgetIssueArray(value: unknown, requiredReason: string): value is Array<{ key: string; reason: string }> {
  return Array.isArray(value) && value.length <= 64 && value.every(
    (entry) => isRecord(entry) && isWidgetKey(entry.key) && entry.reason === requiredReason,
  );
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isScopeLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\0\r\n]/.test(value);
}
