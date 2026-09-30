/* @vitest-environment jsdom */
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { CatalogBrowser } from "./CatalogBrowser";

vi.mock("@/lib/storage-client", () => ({ resolveFileUrl: vi.fn(async (key: string) => key === "audio-key" ? "https://example.test/audio.wav" : "https://example.test/art.png") }));

const props: ComponentProps<typeof CatalogBrowser> = {
  artists: [{ id: "a", name: "First artist", image_url: null }, { id: "b", name: "Second artist", image_url: null }],
  releases: ["a", "b"].map(id => ({ id: `release-${id}`, artist_id: id, title: `Release ${id}`, artist_name: `${id} artist`, format: null, status: null, release_date: null, upc_ean: null, cover_art_url: null, release_ready: false, parent_release_id: null })),
  tracks: ["a", "b"].map(id => ({ id: `track-${id}`, title: `Track ${id}`, release_id: `release-${id}`, position: 1, version: null, isrc: null, audio_url: null, duration: null, track_ready: false, track_missing: "Audio", work_id: null, work_title: null })),
  canMutate: false, selectedTrackId: "track-b",
};

it("opens only the selected track's artist/release branch and preserves exact editor and numbering links", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CatalogBrowser {...props} />));
    const nav = host.querySelector('nav[aria-label="Artists, releases and tracks"]')!;
    expect(nav.textContent).toContain("Second artist");
    expect(nav.textContent).not.toContain("First artist");
    expect(nav.textContent).toContain("Track b");
    expect(nav.textContent).not.toContain("Track a");
    expect(host.querySelector("h1")?.textContent).toBe("Track b");
    expect(host.querySelector('a[href="/releases/release-b/tracks?track=track-b"]')?.textContent).toBe("View record");
    const browserToggle = [...host.querySelectorAll("button")].find(item => item.textContent?.includes("Hide browser"))!;
    await act(async () => browserToggle.click());
    expect(browserToggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => browserToggle.click());
    await act(async () => (nav.querySelector('button[aria-controls="catalog-artist-list"]') as HTMLButtonElement).click());
    expect(nav.textContent).toContain("First artist");
    const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLElement[];
    await act(async () => tabs.find(item => item.textContent === "More")!.click());
    expect(host.querySelector('a[href="/catalog?view=numbering"]')).not.toBeNull();
    await act(async () => tabs.find(item => item.textContent === "Files")!.click());
    expect(host.textContent).toContain("No audio linked yet.");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("searches tracks outside the open branch without losing the selected record", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CatalogBrowser {...props} />));
    const browserToggle = [...host.querySelectorAll("button")].find(item => item.textContent?.includes("Hide browser"))!;
    await act(async () => browserToggle.click());
    expect(browserToggle.getAttribute("aria-expanded")).toBe("false");
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Track a");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const nav = host.querySelector('nav[aria-label="Artists, releases and tracks"]')!;
    expect(browserToggle.getAttribute("aria-expanded")).toBe("true");
    expect(nav.querySelector('a[href="/catalog?track=track-a"]')).not.toBeNull();
    expect(nav.textContent).not.toContain("Track b");
    expect(host.querySelector("h1")?.textContent).toBe("Track b");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("resolves linked artwork and audio into image and native player elements", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CatalogBrowser {...props}
      releases={props.releases.map(item => ({ ...item, cover_art_url: "cover-key" }))}
      tracks={props.tracks.map(item => ({ ...item, audio_url: "audio-key" }))} />));
    expect(host.querySelector('section[aria-label="Selected record"] img')?.getAttribute("src")).toBe("https://example.test/art.png");
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("https://example.test/audio.wav");
    expect(host.querySelector("audio")?.hasAttribute("controls")).toBe(true);
    expect(host.textContent).not.toContain("No audio linked yet.");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
