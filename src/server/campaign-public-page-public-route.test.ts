import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  buildPublishedCampaignPageMetadata,
  publicPressRouteSourceHasNoHydrationDirective,
  resolvePublishedCampaignPageRoute,
  type PublishedCampaignPage,
} from "./campaign-public-page-public-route";
import { buildPublicPageProjection, campaignPublicPageContentSchema } from "./campaign-public-page-core";
import type { ServerDerivedPublicHtml } from "./campaign-public-page-core";

const page: PublishedCampaignPage = {
  slug: "fountain-edits",
  revision: { id: "revision-1", version: 2 },
  content: {
    label_line: "True Nature · Fountain", title: "Fountain Edits", release_note: "A concise radio update.",
    release_note_html: "<p>A concise radio update.</p>" as ServerDerivedPublicHtml,
    listen_url: "https://listen.example.test/fountain", download_url: null, metadata_url: "https://metadata.example.test/fountain",
    contact_name: "Press desk", contact_email: "press@example.test", network_statement: "Shared with our independent radio network.",
  },
  artworkUrl: "https://cdn.example.test/fountain-artwork.jpg", tracks: [], releaseDate: null, catalogNumber: null,
  publishedAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-03T12:30:00.000Z",
};

describe("public press route contract", () => {
  it("returns 404 for missing, draft, or unpublished loader results", async () => {
    const result = await resolvePublishedCampaignPageRoute("draft-only", async () => null, "https://trusted.example");
    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(404);
  });

  it("builds canonical and Open Graph source metadata from the validated site origin", async () => {
    const loader = vi.fn(async () => page);
    const result = await resolvePublishedCampaignPageRoute("fountain-edits", loader, "https://trusted.example/app");
    expect(loader).toHaveBeenCalledWith("fountain-edits");
    expect("metadata" in result).toBe(true);
    if ("metadata" in result) expect(result.metadata).toEqual({ title: "Fountain Edits · True Nature · Fountain", description: "A concise radio update.", canonical: "https://trusted.example/press/fountain-edits", artworkUrl: page.artworkUrl });
  });

  it("fails closed when the configured origin is invalid", () => {
    vi.stubEnv("PUBLIC_SITE_URL", "http://user:password@attacker.example");
    expect(() => buildPublishedCampaignPageMetadata(page)).toThrow("PUBLIC_SITE_URL must use http or https without credentials");
    vi.unstubAllEnvs();
  });

  it("keeps the Astro route hydration-free", async () => {
    expect(await publicPressRouteSourceHasNoHydrationDirective()).toBe(true);
    const source = await readFile(new URL("../pages/press/[slug].astro", import.meta.url), "utf8");
    expect(source).not.toContain("Astro.url.origin");
    expect(source).not.toMatch(/client\s*:/);
  });

  it("exposes only inert server-derived markup for hostile legacy content and rejects hostile document nodes", async () => {
    const hostileLegacy = `<script>alert(1)</script><iframe src="javascript:alert(1)"></iframe><img src=x onerror=alert(1) style=color:red>`;
    const { release_note_html: _projectionOnlyHtml, ...editableContent } = page.content;
    expect(() => campaignPublicPageContentSchema.parse({
      ...editableContent,
      artwork_asset_id: "asset-cover-1",
      focus_track_ids: ["track-1"],
      release_note: "Fallback",
      release_note_document: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "javascript:alert(1)", onerror: "alert(1)", style: "color:red" } }],
      },
    })).toThrow();

    const content = campaignPublicPageContentSchema.parse({
      ...editableContent,
      artwork_asset_id: "asset-cover-1",
      focus_track_ids: ["track-1"],
      release_note: hostileLegacy,
    });
    const projection = buildPublicPageProjection({
      content,
      campaignId: "campaign-1",
      release: {
        id: "release-1",
        campaignId: "campaign-1",
        trackIds: ["track-1"],
        sourceSnapshot: "snapshot-1",
        releaseDate: null,
        catalogNumber: null,
        tracks: [{ id: "track-1", title: "Fountain", duration: null, credits: [] }],
      },
      artwork: {
        id: "asset-cover-1",
        releaseId: "release-1",
        approvalStatus: "approved",
        fileLink: "https://cdn.example.test/artwork.jpg",
        sourceSnapshot: "snapshot-1",
      },
      sourceSnapshot: "snapshot-1",
      publishedAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:00:00.000Z",
    });
    const result = await resolvePublishedCampaignPageRoute("fountain-edits", async () => ({
      slug: "fountain-edits",
      revision: { id: "revision-safe", version: 1 },
      ...projection,
    }), "https://trusted.example");
    if (!("page" in result)) throw new Error("Expected the published projection");

    const safeHtml = (result.page.content as typeof result.page.content & { release_note_html: string }).release_note_html;
    const emittedTags = safeHtml?.match(/<[^>]+>/g)?.join("") ?? "";
    expect(emittedTags).not.toMatch(/<script|<iframe|<img|\sonerror\s*=|\sstyle\s*=|href=["']javascript:/i);
    expect(safeHtml).toContain("&lt;script&gt;");
  });
});
