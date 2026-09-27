import { describe, expect, it } from "vitest";
import { buildImportCompleteness, parseSisenseMetric } from "./sisense-import-snapshot";

describe("parseSisenseMetric", () => {
  it("accepts decimal and scientific notation emitted by Periscope", () => {
    expect(parseSisenseMetric("3.157589983599736")).toBe(3.157589983599736);
    expect(parseSisenseMetric("-3.447205342377939E-4")).toBeCloseTo(-0.0003447205342377939);
    expect(parseSisenseMetric("1.2e+3")).toBe(1200);
  });

  it("continues to reject labels and malformed numeric values", () => {
    expect(parseSisenseMetric("New York")).toBeNull();
    expect(parseSisenseMetric("1.2.3")).toBeNull();
  });
});

describe("buildImportCompleteness", () => {
  it("records the unique supplied widgets as a complete saved snapshot", () => {
    expect(buildImportCompleteness(["spotify-streams-source", "tracks-by-growth-rate", "spotify-streams-source"]))
      .toEqual({
        version: 2,
        expectedWidgetKeys: ["spotify-streams-source", "tracks-by-growth-rate"],
        downloadedWidgetKeys: ["spotify-streams-source", "tracks-by-growth-rate"],
        observedEmptyWidgets: [],
        skippedWidgets: [],
        state: "complete",
      });
  });
});
