export const DIAGNOSTIC_FAILURE_CODES = [
  "configuration",
  "database_setup",
  "browser_launch",
  "provider_navigation_authentication",
  "provider_filters",
  "widget_export_resolution",
  "diagnostic_artifact_writing",
  "diagnostic_summary_writing",
  "unexpected",
] as const;

export type DiagnosticFailureCode = (typeof DIAGNOSTIC_FAILURE_CODES)[number];

export type DiagnosticFailure = {
  version: 1;
  code: DiagnosticFailureCode;
};

export function isDiagnosticFailureCode(value: unknown): value is DiagnosticFailureCode {
  return typeof value === "string" && (DIAGNOSTIC_FAILURE_CODES as readonly string[]).includes(value);
}
