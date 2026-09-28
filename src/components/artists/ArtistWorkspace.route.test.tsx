/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtistWorkspace, readinessDestinationTarget } from "./ArtistWorkspace";

let container: HTMLDivElement;
let root: Root;
let reactActEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;

const baseArtist = {
  id: "artist-1",
  name: "Artist One",
  bio: "Short bio",
  pro: "KODA",
  spotify_id: "spotify:artist:1",
  spotify_followers: 1200,
  spotify_popularity: 45,
  ipi: "12345",
  instagram: "@artist",
  tiktok: "artisttok",
  relationship: "roster" as const,
};

beforeEach(() => {
  reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const location = {
    href: "http://localhost/artists/artist-1?tab=overview&focus=bio",
    pathname: "/artists/artist-1",
    hash: "",
    search: "?tab=overview&focus=bio",
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => "http://localhost/artists/artist-1?tab=overview&focus=bio",
  } as unknown as Location;

  vi.stubGlobal("location", location);
  vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ArtistWorkspace readiness destinations", () => {
  it("maps image and rights actions to exact workspace panels", () => {
    expect(readinessDestinationTarget("tab:visuals")).toEqual({
      tab: "visuals",
      targetId: "artist-image-uploader",
    });
    expect(readinessDestinationTarget("tab:documents")).toEqual({
      tab: "rights",
      targetId: "artist-documents-panel",
    });
    expect(readinessDestinationTarget("tab:rights")).toEqual({
      tab: "rights",
      targetId: "artist-rights-panel",
    });
  });

  it("keeps field-edit destinations on the overview editor surface", () => {
    expect(readinessDestinationTarget("overview:bio")).toEqual({
      tab: "overview",
      targetId: null,
    });
    expect(readinessDestinationTarget("overview:spotify_popularity")).toEqual({
      tab: "overview",
      targetId: null,
    });
  });

  it("opens the edit dialog when a mutable workspace receives a focus-field route", async () => {
    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={baseArtist}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate
          initialTab="overview"
          initialFocusField="bio"
        />,
      );
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Edit Artist");
    const bioField = dialog.querySelector('[role="textbox"][aria-label="Bio"]');
    expect(bioField?.getAttribute("contenteditable")).toBe("true");
    expect(dialog.textContent).toContain("Draft");
  });

  it("does not submit unchanged biography fields when saving another artist field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={{ ...baseArtist, bio_review_status: "reviewed", bio_reviewed_hash: "existing-review" }}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate
          initialFocusField="pro"
        />,
      );
    });

    const form = document.querySelector('[role="dialog"] form');
    if (!form) throw new Error("Artist edit form was not rendered");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("bio");
    expect(payload).not.toHaveProperty("bio_document");
    expect(payload.pro).toBe("KODA");
  });

  it("renders reviewed rich biography output without executable markup or narrow-screen overflow", async () => {
    const unsafeLookingText = '<script data-tenant="other">alert(1)</script> Safe biography';
    const bioDocument = {
      type: "doc" as const,
      content: [{
        type: "paragraph" as const,
        content: [{ type: "text" as const, text: unsafeLookingText, marks: [{ type: "bold" as const }] }],
      }],
    };
    const { deriveCampaignDocument } = await import("../../lib/campaign-rich-text");
    const derived = deriveCampaignDocument(bioDocument, 20_000);

    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={{
            ...baseArtist,
            bio: derived.plainText,
            bio_document: derived.document,
            bio_review_status: "reviewed",
            bio_reviewed_hash: derived.hash,
          }}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate
        />,
      );
    });

    const rendered = container.querySelector('[data-testid="artist-bio-rendered"]');
    expect(rendered?.textContent).toBe(unsafeLookingText);
    expect(rendered?.querySelector("script")).toBeNull();
    expect(rendered?.className).toContain("break-words");
    expect(rendered?.className).toContain("[&_a]:break-all");
    expect(container.querySelector('[data-testid="artist-bio-state"]')?.textContent).toContain("reviewed");
  });

  it("requires an explicit replacement before malformed biography text can be edited and saved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={{ ...baseArtist, bio_document: { type: "script", content: [] }, bio_review_status: "reviewed", bio_reviewed_hash: "older" }}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate
          initialFocusField="bio"
        />,
      );
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("shown safely");
    expect(dialog.querySelector('[role="textbox"][aria-label="Bio"]')?.getAttribute("contenteditable")).toBe("false");
    const replaceButton = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Replace invalid biography");
    expect(replaceButton?.disabled).toBe(false);

    await act(async () => {
      replaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.querySelector('[role="textbox"][aria-label="Bio"]')?.getAttribute("contenteditable")).toBe("true");
    const reviewButton = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Save before review");
    expect(reviewButton?.disabled).toBe(true);

    const form = document.querySelector('[role="dialog"] form');
    if (!form) throw new Error("Artist edit form was not rendered");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload.bio).toBe("Short bio");
    expect(payload.bio_document).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Short bio" }] }],
    });
  });

  it("does not open the edit dialog for read-only users, even with a focus-field route", async () => {
    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={baseArtist}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate={false}
          initialTab="overview"
          initialFocusField="bio"
        />,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("selects the requested visuals tab when a readiness destination route is provided", async () => {
    await act(async () => {
      root.render(
        <ArtistWorkspace
          artist={baseArtist}
          releases={[]}
          assets={[]}
          campaigns={[]}
          documents={[]}
          rights={[]}
          tasks={[]}
          primaryContact={null}
          contactOptions={[]}
          canMutate
          initialReadinessDestination="tab:visuals"
        />,
      );
    });

    expect(container.querySelector("#artist-image-uploader")).not.toBeNull();
  });
});
