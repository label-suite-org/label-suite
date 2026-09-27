import type { CommandDailySourceRow } from "../server/analytics-command-center-core";

export interface CanonicalDailySourceDbRow {
  date: string | null;
  widgetKey: string;
  source: string | null;
  streams: string | number | null;
}

/** Converts tenant-owned metric rows into the command-center trend shape. */
export function mapCanonicalDailySourceRows(rows: readonly CanonicalDailySourceDbRow[]): CommandDailySourceRow[] {
  return rows
    .filter((row) => row.date)
    .map((row) => ({
      date: row.date!,
      platform: row.widgetKey === "apple-streams-source" ? "apple" : "spotify",
      source: row.source,
      streams: row.streams === null ? null : Number(row.streams),
    }));
}
