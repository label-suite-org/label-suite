import { describe, expect, it } from "vitest";
import { mapCanonicalDailySourceRows } from "./analytics-canonical-sources";

describe("canonical analytics daily sources", () => {
  it("maps tenant-owned source rows into trend data without legacy views", () => {
    expect(mapCanonicalDailySourceRows([
      { date: "2026-07-29", widgetKey: "spotify-streams-source", source: "radio", streams: "12" },
      { date: "2026-07-29", widgetKey: "apple-streams-source", source: "playlist", streams: 8 },
      { date: null, widgetKey: "spotify-streams-source", source: "ignored", streams: 4 },
    ])).toEqual([
      { date: "2026-07-29", platform: "spotify", source: "radio", streams: 12 },
      { date: "2026-07-29", platform: "apple", source: "playlist", streams: 8 },
    ]);
  });
});
