/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReleaseDataPanel, ReleaseWorkspace } from "./ReleaseWorkspace";
import { buildReleaseCockpit } from "../../server/analytics-command-center-core";

describe("ReleaseWorkspace", () => {
  it("names the actual imported period and withholds stale release totals", () => {
    const cockpit = buildReleaseCockpit({ releaseId: "fixture", releaseTitle: "Fixture", artistName: null, format: null, releaseDate: null, trackCount: 0,
      dailySources: [{ date: "2026-09-05", platform: "spotify", source: "fixture", streams: 12 }], tracks: [], cities: [], playlists: [], shazams: [] });
    expect(cockpit.periods.find(period => period.key === "7d")?.label).toBe("7 days ending 2026-09-05");
    const html = renderToStaticMarkup(<ReleaseDataPanel cockpit={{ ...cockpit, dataQuality: "stale" }} hasScopedAnalytics={true} />);
    expect(html).toContain("Source data is stale");
    expect(html).toContain("2026-09-05");
    expect(html).not.toContain("Period streams");
  });
  it("focuses a correction, preserves it when departure is cancelled, and restores its trigger on close", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, "", "/releases/release-1?section=overview&returnTo=today");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await act(async () => root.render(<ReleaseWorkspace
        release={{ id: "release-1", title: "Fixture", upc_ean: "123" }}
        readiness={{ release: { id: "release-1", title: "Fixture", updated_at: "2026-09-27T10:00:00Z", upc_ean: "123", cover_art_url: null, release_date: null, format: null }, readiness: { isReady: false, missing: ["Cover art"] }, observed_at: "2026-09-27T10:00:00Z" }}
        tracks={[]} budgetItems={[]} pitches={[]} works={[]} artists={[]} cockpit={null} samplyReview={null} canManage={true} timeline={null} parentReleases={[]} campaigns={[]} documents={[]} mediaAssets={[]}
      />));
      const trigger = host.querySelector<HTMLButtonElement>("#release-correct-upc")!;
      await act(async () => { trigger.focus(); trigger.click(); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      const input = host.querySelector<HTMLInputElement>("#release-upc-ean")!;
      expect(document.activeElement).toBe(input);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "789");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const close = [...host.querySelectorAll("button")].find(button => button.textContent === "Close correction")!;
      await act(async () => close.click());
      expect(confirm).toHaveBeenCalledOnce();
      expect(input.value).toBe("789");
      expect(host.contains(input)).toBe(true);
      confirm.mockReturnValue(true);
      await act(async () => close.click());
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(host.contains(input)).toBe(false);
      expect(document.activeElement).toBe(trigger);
      expect(window.location.search).toContain("returnTo=today");
    } finally {
      act(() => root.unmount()); host.remove(); confirm.mockRestore(); vi.unstubAllGlobals();
      if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });
  it("uses theme-token backgrounds for header and readiness surfaces", () => {
    const html = renderToStaticMarkup(
      <ReleaseWorkspace
        release={{
          id: "release-1",
          title: "Issue 51 release",
          artist_name: "Demo Artist",
          release_ready: false,
          release_date: "2026-08-01",
          format: "single",
          status: "draft",
        }}
        tracks={[]}
        budgetItems={[]}
        pitches={[]}
        works={[]}
        artists={[]}
        cockpit={null}
        samplyReview={null}
        canManage={true}
        timeline={null}
        parentReleases={[]}
        campaigns={[]}
        documents={[]}
        mediaAssets={[]}
      />,
    );

    expect(html).toContain("bg-card");
    expect(html).not.toContain("bg-[linear-gradient(180deg,#fff,#fafafa)]");
    expect(html).toContain("bg-primary");
    expect(html).toContain("border");
    expect(html).not.toContain("bg-white");
    expect(html).toContain("focus-visible:ring-ring");
    expect(html).toContain("focus-visible:ring-offset-background");
    expect(html).toContain("group-focus-visible:opacity-100");
  });

  it("keeps release action controls off fixed dark/light-only shades", () => {
    const html = renderToStaticMarkup(
      <ReleaseWorkspace
        release={{
          id: "release-2",
          title: "Samply linked",
          artist_name: "Sample Artist",
          release_ready: true,
          release_date: "2026-07-01",
          format: "EP",
          status: "scheduled",
        }}
        tracks={[]}
        budgetItems={[]}
        pitches={[]}
        works={[]}
        artists={[]}
        cockpit={null}
        samplyReview={null}
        canManage={true}
        timeline={null}
        parentReleases={[]}
        campaigns={[]}
        documents={[]}
        mediaAssets={[]}
      />,
    );

    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("bg-neutral-900");
    expect(html).not.toContain("text-white");
  });

  it("shows canonical record and read-only Airtable evidence boundaries", () => {
    const html = renderToStaticMarkup(
      <ReleaseWorkspace
        release={{
          id: "release-3",
          title: "Evidence release",
          artist_name: "Evidence Artist",
          catalog_number: "TN-003",
          release_ready: false,
          release_date: "2026-08-01",
          format: "single",
          status: "draft",
        }}
        tracks={[{
          id: "track-1",
          title: "Linked track",
          release_id: "release-3",
          work_id: "work-1",
          clearance_pub: 1,
          clearance_master: 0,
        }]}
        budgetItems={[]}
        pitches={[]}
        works={[{ id: "work-1", title: "Linked work", isrc: null }]}
        artists={[]}
        cockpit={null}
        samplyReview={null}
        canManage={true}
        timeline={null}
        parentReleases={[]}
        campaigns={[]}
        documents={[]}
        mediaAssets={[]}
      />,
    );

    expect(html).toContain("Record authority &amp; sign-off evidence");
    expect(html).toContain("Release → catalog entry");
    expect(html).toContain("Label Suite release, catalog, track, work, and rights fields are canonical");
    expect(html).toContain("Airtable may be consulted as read-only reference evidence");
  });
});
