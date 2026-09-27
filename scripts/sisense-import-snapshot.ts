export interface ImportSnapshotCompleteness {
  version: 2;
  expectedWidgetKeys: string[];
  downloadedWidgetKeys: string[];
  observedEmptyWidgets: Array<{ key: string; reason: string }>;
  skippedWidgets: Array<{ key: string; reason: string }>;
  state: "complete";
}

export function parseSisenseMetric(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^-?[$€£]?\s*[\d,.]+(?:\.\d+)?(?:e[+-]?\d+)?\s*%?$/i.test(trimmed)) return null;
  const normalized = trimmed
    .replace(/[$€£\s,%]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildImportCompleteness(widgetKeys: readonly string[]): ImportSnapshotCompleteness {
  const uniqueWidgetKeys = [...new Set(widgetKeys)];
  return {
    version: 2,
    expectedWidgetKeys: uniqueWidgetKeys,
    downloadedWidgetKeys: uniqueWidgetKeys,
    observedEmptyWidgets: [],
    skippedWidgets: [],
    state: "complete",
  };
}
