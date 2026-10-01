import { describe, expect, it } from "vitest";

import { buildArtistProfileReadiness } from "./artist-readiness";

describe("buildArtistProfileReadiness", () => {
  it("maps missing fields to exact editor or tab actions", () => {
    const readiness = buildArtistProfileReadiness({
      image_url: null,
      hasPrimaryImage: false,
      bio: null,
      pro: "",
      ipi: "",
      spotify_id: null,
      spotify_followers: null,
      spotify_popularity: null,
      instagram: "",
      tiktok: "",
    });

    expect(readiness.complete).toBe(0);
    expect(readiness.missing).toEqual([
      "Image",
      "Bio",
      "PRO",
      "IPI",
      "Spotify ID",
      "Instagram",
      "TikTok",
    ]);
    expect(readiness.rows.find((row) => row.label === "Image")).toMatchObject({
      label: "Image",
      ok: false,
      action: { kind: "open_tab", tab: "visuals", destination: "tab:visuals" },
    });
    expect(readiness.rows.find((row) => row.label === "Bio")).toMatchObject({
      label: "Bio",
      ok: false,
      action: { kind: "edit", focusField: "bio", destination: "overview:bio" },
    });
    expect(readiness.rows.find((row) => row.label === "PRO")).toMatchObject({
      label: "PRO",
      ok: false,
      action: { kind: "edit", focusField: "pro", destination: "overview:pro" },
    });
    expect(readiness.rows.find((row) => row.label === "IPI")).toMatchObject({
      label: "IPI",
      ok: false,
      action: { kind: "edit", focusField: "ipi", destination: "overview:ipi" },
    });
    expect(readiness.rows.find((row) => row.label === "Spotify ID")).toMatchObject({
      label: "Spotify ID",
      ok: false,
      action: { kind: "edit", focusField: "spotify_id", destination: "overview:spotify_id" },
    });
    expect(readiness.rows.some(row => ["Followers", "Popularity"].includes(row.label))).toBe(false);
    expect(readiness.rows.find((row) => row.label === "Instagram")).toMatchObject({
      label: "Instagram",
      ok: false,
      action: { kind: "edit", focusField: "instagram", destination: "overview:instagram" },
    });
    expect(readiness.rows.find((row) => row.label === "TikTok")).toMatchObject({
      label: "TikTok",
      ok: false,
      action: { kind: "edit", focusField: "tiktok", destination: "overview:tiktok" },
    });
  });

  it("uses explicit destinations for all readiness rows", () => {
    const readiness = buildArtistProfileReadiness({
      hasPrimaryImage: false,
      image_url: "",
      bio: "",
      pro: "",
      ipi: "",
      spotify_id: "",
      spotify_followers: null,
      spotify_popularity: null,
      instagram: "",
      tiktok: "",
    });

    expect(readiness.rows.map((row) => row.action?.destination)).toEqual([
      "tab:visuals",
      "overview:bio",
      "overview:pro",
      "overview:ipi",
      "overview:spotify_id",
      "overview:instagram",
      "overview:tiktok",
    ]);
  });

  it("adds workspace remediation rows when asset, document, and rights counts are provided", () => {
    const readiness = buildArtistProfileReadiness({
      hasPrimaryImage: true,
      image_url: "https://example.com/artist.jpg",
      imageAssetCount: 0,
      documentsCount: 0,
      rightsCount: 0,
      bio: "Artist bio",
      pro: "KODA",
      ipi: "12345",
      spotify_id: "spotify:artist:1",
      spotify_followers: 10,
      spotify_popularity: 20,
      instagram: "@artist",
      tiktok: "@artist",
    });

    expect(readiness.missing).toEqual(["Images", "Documents", "Rights rows"]);
    expect(readiness.rows.find((row) => row.label === "Images")).toMatchObject({
      label: "Images",
      ok: false,
      action: { kind: "open_tab", tab: "visuals", destination: "tab:visuals" },
    });
    expect(readiness.rows.find((row) => row.label === "Documents")).toMatchObject({
      label: "Documents",
      ok: false,
      action: { kind: "open_tab", tab: "rights", destination: "tab:documents" },
    });
    expect(readiness.rows.find((row) => row.label === "Rights rows")).toMatchObject({
      label: "Rights rows",
      ok: false,
      action: { kind: "open_tab", tab: "rights", destination: "tab:rights" },
    });
  });

  it("does not require provider metrics to complete a profile", () => {
    const readiness = buildArtistProfileReadiness({
      image_url: "https://example.com/image.jpg",
      hasPrimaryImage: true,
      bio: "Artist bio",
      pro: "KODA",
      ipi: "12345",
      spotify_id: "abc-123",
      spotify_followers: null,
      spotify_popularity: null,
      instagram: "@artist",
      tiktok: "artist",
    });

    expect(readiness.complete).toBe(100);
    expect(readiness.missing).toEqual([]);
    expect(readiness.rows.filter((row) => row.ok)).toHaveLength(7);
    expect(readiness.rows.every((row) => !row.action || row.action.kind === "edit" || row.action.kind === "open_tab")).toBe(true);
    expect(readiness.rows.every((row) => row.action && "destination" in row.action)).toBe(true);
  });
});
