// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TrackEditorWorkspace, parseTrackRoute, trackFocusId } from "./TrackEditorWorkspace";

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

it("selects a track for editing and keeps its full checks available on demand", async () => {
  window.history.replaceState(null, "", "/releases/release-1/tracks");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const tracks = [
    { id: "track-1", title: "First song", release_id: "release-1", position: 1, version: "Main", isrc: null, audio_url: null, duration: null, work_id: null, track_ready: false, track_missing: "Audio file, ISRC" },
    { id: "track-2", title: "Second song", release_id: "release-1", position: 2, version: "Main", isrc: "DKABC2600002", audio_url: "https://example.test/audio.wav", duration: 180, work_id: "work-2", track_ready: true },
  ];
  try {
    await act(async () => root.render(<TrackEditorWorkspace release={{ id: "release-1", title: "A release" }} tracks={tracks} works={[{ id: "work-2", title: "Second work", isrc: "DKABC2600002" }]} />));
    const second = [...host.querySelectorAll<HTMLButtonElement>("section[aria-label='Tracks'] button")].find(button => button.textContent?.includes("Second song"))!;
    await act(async () => second.click());
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("aside h2")?.textContent).toBe("Second song");
    expect(host.querySelector<HTMLInputElement>("#track-isrc")?.value).toBe("DKABC2600002");
    const checks = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find(button => button.textContent?.includes("Readiness checks"))!;
    expect(checks.getAttribute("aria-expanded")).toBe("false");
    await act(async () => checks.click());
    expect(checks.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("aside")?.textContent).toContain("Publishing clearance");
    expect(host.querySelector("aside")?.textContent).toContain("No rights entered on this track");
    const filter = [...host.querySelectorAll<HTMLButtonElement>("[aria-label='Filter tracks'] button")].find(button => button.textContent === "Needs work")!;
    await act(async () => filter.click());
    expect(host.querySelector("section[aria-label='Tracks']")?.textContent).not.toContain("Second song");
    expect(host.querySelector("aside h2")?.textContent).toBe("First song");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});


it("keeps a dirty track when switching is cancelled, including filters and page departure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/releases/release-1/tracks");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const tracks = [
    { id: "one", title: "First song", release_id: "release-1", position: 1, version: "Main", isrc: null, audio_url: null, duration: null, work_id: null, track_ready: false },
    { id: "two", title: "Second song", release_id: "release-1", position: 2, version: "Main", isrc: null, audio_url: null, duration: null, work_id: null, track_ready: true },
  ];
  try {
    await act(async () => root.render(<TrackEditorWorkspace release={{ id: "release-1", title: "Release" }} tracks={tracks} works={[]} />));
    const input = [...host.querySelectorAll<HTMLInputElement>("aside input")].find(input => input.value === "First song")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unsaved correction");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const second = [...host.querySelectorAll<HTMLButtonElement>("section button")].find(button => button.textContent?.includes("Second song"))!;
    await act(async () => second.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Discard unsaved track changes?");
    const keep = () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Keep editing")!;
    await act(async () => keep().click());
    expect(input.value).toBe("Unsaved correction");
    expect(host.querySelector("aside h2")?.textContent).toBe("First song");
    const ready = [...host.querySelectorAll<HTMLButtonElement>("[aria-label='Filter tracks'] button")].find(button => button.textContent === "Ready")!;
    await act(async () => ready.click());
    expect(host.querySelector("aside h2")?.textContent).toBe("First song");
    expect(input.value).toBe("Unsaved correction");
    await act(async () => keep().click());
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
    await act(async () => second.click());
    const discard = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Discard changes")!;
    await act(async () => discard.click());
    expect(host.querySelector("aside h2")?.textContent).toBe("Second song");
    const cleanDeparture = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanDeparture);
    expect(cleanDeparture.defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});


it("keeps the accepted track URL when a later history transition is cancelled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/releases/release-1/tracks?track=one");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const tracks = [
    { id: "one", title: "First song", release_id: "release-1", position: 1, version: "Main", isrc: null, audio_url: null, duration: null, work_id: null },
    { id: "two", title: "Second song", release_id: "release-1", position: 2, version: "Main", isrc: null, audio_url: null, duration: null, work_id: null },
  ];
  const editTitle = async (title: string) => {
    const input = host.querySelector<HTMLInputElement>("aside input[required]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, title);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const navigate = async (id: string) => {
    await act(async () => {
      window.history.replaceState(null, "", `/releases/release-1/tracks?track=${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  };
  const choose = async (label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === label)!;
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(<TrackEditorWorkspace release={{ id: "release-1", title: "Release" }} tracks={tracks} works={[]} />));
    await editTitle("First draft");
    await navigate("two");
    await choose("Discard changes");
    expect(window.location.search).toBe("?track=two");
    expect(host.querySelector("aside h2")?.textContent).toBe("Second song");
    await editTitle("Second draft");
    await navigate("one");
    await choose("Keep editing");
    expect(window.location.search).toBe("?track=two");
    expect(host.querySelector<HTMLInputElement>("aside input[required]")?.value).toBe("Second draft");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
