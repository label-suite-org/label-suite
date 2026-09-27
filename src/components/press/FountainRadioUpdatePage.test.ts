import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FountainRadioUpdatePage } from "./FountainRadioUpdatePage";

const page = {
  slug: "fountain-edits",
  revision: { id: "revision-private", version: 4 },
  content: {
    label_line: "True Nature · Fountain",
    title: "Fountain Edits",
    release_note: "A concise set of edits for independent radio programmers.",
    listen_url: "https://listen.example.test/fountain",
    download_url: "https://download.example.test/fountain.zip",
    metadata_url: "https://metadata.example.test/fountain",
    contact_name: "Press desk",
    contact_email: "press@example.test",
    network_statement: "Shared with our independent radio network.",
  },
  artworkUrl: "https://cdn.example.test/fountain-artwork.jpg",
  tracks: [
    {
      title: "Fountain Edit",
      duration: 187,
      credits: [{ name: "Mara Example", role: "Producer" }],
    },
    { title: "Night Version", duration: null, credits: [] },
  ],
  releaseDate: "2026-08-01",
  catalogNumber: "TN-042",
  publishedAt: "2026-08-02T10:00:00.000Z",
  updatedAt: "2026-08-03T12:30:00.000Z",
} as const;

describe("FountainRadioUpdatePage", () => {
  it("renders an editorial, semantic, server-safe page", () => {
    const html = renderToStaticMarkup(createElement(FountainRadioUpdatePage, { page }));

    expect(html).toContain("<main");
    expect(html).toContain("<header");
    expect(html).toContain("<h1>Fountain Edits</h1>");
    expect(html).toContain("<section");
    expect(html).toContain("<ol");
    expect(html).toContain("<address");
    expect(html).toContain("<footer");
    expect(html).toContain("Shared with our independent radio network.");
    expect(html).toContain('href="https://listen.example.test/fountain"');
    expect(html).toContain('href="https://download.example.test/fountain.zip"');
    expect(html).toContain('href="https://metadata.example.test/fountain"');
    expect(html).toContain('href="mailto:press@example.test"');
    expect(html).toContain("Fountain Edit");
    expect(html).toContain("3:07");
    expect(html).toContain("Mara Example");
    expect(html).toContain("2026-08-02");
    expect(html).toContain("2026-08-03");
  });

  it("keeps optional actions absent and does not personalize or leak private fields", () => {
    const html = renderToStaticMarkup(
      createElement(FountainRadioUpdatePage, {
        page: {
          ...page,
          content: { ...page.content, download_url: null, metadata_url: null },
        },
      }),
    );

    expect(html).not.toContain("download.example.test");
    expect(html).not.toContain("metadata.example.test");
    expect(html).not.toContain("station@example.org");
    expect(html).not.toContain("revision-private");
    expect(html).not.toContain("org_id");
    expect(html).not.toContain("source_snapshot");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
  });

  it("escapes user content as text and preserves ordered focus edits", () => {
    const html = renderToStaticMarkup(
      createElement(FountainRadioUpdatePage, {
        page: {
          ...page,
          content: {
            ...page.content,
            title: "Fountain <Edits>",
            release_note: 'A note with <em>no markup</em> & quotes.',
          },
          tracks: [
            { title: "First <edit>", duration: 61, credits: [] },
            { title: "Second edit", duration: 62, credits: [] },
          ],
        },
      }),
    );

    expect(html).toContain("Fountain &lt;Edits&gt;");
    expect(html).toContain("A note with &lt;em&gt;no markup&lt;/em&gt; &amp; quotes.");
    expect(html.indexOf("First &lt;edit&gt;")).toBeLessThan(html.indexOf("Second edit"));
    expect(html).not.toContain("<em>no markup</em>");
  });
});
