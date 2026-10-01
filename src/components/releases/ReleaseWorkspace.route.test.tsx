import { describe, expect, it } from "vitest";
import { briefActionNavigationTarget, releaseFocusId, routeFromLocation } from "./ReleaseWorkspace";

describe("ReleaseWorkspace routing helpers", () => {
  it("maps overview focus links to the exact cover editor input", () => {
    expect(routeFromLocation("?section=overview&focus=cover", "#release-overview")).toEqual({
      section: "overview",
      focus: "cover",
    });
    expect(releaseFocusId("cover")).toBe("release-cover-input");
    expect(routeFromLocation("?section=details&focus=upc", "#release-details")).toEqual({ section: "details", focus: "upc" });
  });

  it("keeps both current and existing budget links openable", () => {
    expect(routeFromLocation("", "#release-budget").section).toBe("budget");
    expect(routeFromLocation("", "#dsp-pitches").section).toBe("budget");
  });

  it("keeps grounded blocker routes exact for track and work-scope evidence", () => {
    expect(briefActionNavigationTarget("track-readiness", "/releases/release-1/tracks?track=track-1&focus=isrc")).toBe(
      "/releases/release-1/tracks?track=track-1&focus=isrc",
    );
    expect(briefActionNavigationTarget("track-readiness", "/works/work-9?scope=publishing&focus=publishing")).toBe(
      "/works/work-9?scope=publishing&focus=publishing",
    );
    expect(briefActionNavigationTarget("cover", "/releases/release-1?section=overview&focus=cover")).toBeNull();
  });
});
