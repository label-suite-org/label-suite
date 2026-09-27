import { describe, expect, it } from "vitest";
import { parseTrackRoute, trackFocusId } from "./TrackEditorWorkspace";

describe("TrackEditorWorkspace routing helpers", () => {
  it("parses deep links to the requested track editor field", () => {
    expect(parseTrackRoute("?track=track-2&focus=audio")).toEqual({
      trackId: "track-2",
      focus: "audio",
    });
    expect(parseTrackRoute("?track=track-2&focus=isrc")).toEqual({
      trackId: "track-2",
      focus: "isrc",
    });
    expect(parseTrackRoute("?track=track-3&focus=work")).toEqual({
      trackId: "track-3",
      focus: "work",
    });
    expect(parseTrackRoute("?track=track-4&focus=unknown")).toEqual({
      trackId: "track-4",
      focus: null,
    });
    expect(trackFocusId("audio")).toBe("track-audio");
    expect(trackFocusId("isrc")).toBe("track-isrc");
    expect(trackFocusId("work")).toBe("track-work");
  });
});
