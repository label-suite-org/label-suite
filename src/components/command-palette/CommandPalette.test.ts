import { describe, expect, it } from "vitest";
import {
  clampActiveIndex,
  recordSearchStatusMessage,
  resolveCommandHref,
} from "./CommandPalette";

describe("command palette helpers", () => {
  it("normalizes record search status text by active mode", () => {
    expect(recordSearchStatusMessage("loading")).toBe("Searching records.");
    expect(recordSearchStatusMessage("error")).toBe("Record search is temporarily unavailable.");
    expect(recordSearchStatusMessage("idle")).toBe("");
    expect(recordSearchStatusMessage("empty")).toBe("No record results found.");
  });

  it("keeps the active index pinned to available command results", () => {
    expect(clampActiveIndex(-1, 3)).toBe(0);
    expect(clampActiveIndex(5, 3)).toBe(2);
    expect(clampActiveIndex(1, 3)).toBe(1);
    expect(clampActiveIndex(0, 0)).toBe(0);
  });

  it("preserves analytics scope when activating Forecast", () => {
    expect(resolveCommandHref(
      { id: "nav.forecast", href: "/analytics?section=forecast" },
      "/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d",
    )).toBe("/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d&section=forecast");
  });
});
