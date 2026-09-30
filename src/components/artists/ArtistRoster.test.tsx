import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ArtistRosterRow } from "../../server/artists";
import { ArtistRoster } from "./ArtistRoster";

function makeArtist(overrides: Partial<ArtistRosterRow>): ArtistRosterRow {
  return {
    id: "artist-1",
    name: "Artist",
    relationship: "roster",
    contact_id: null,
    image_url: null,
    bio: "Short bio",
    spotify_id: "spotify:artist:1",
    spotify_followers: 1200,
    spotify_popularity: 42,
    pro: "KODA",
    ipi: "12345",
    instagram: "@artist",
    tiktok: "artisttok",
    release_count: 1,
    campaign_count: 0,
    open_task_count: 0,
    next_release_id: null,
    next_release_title: null,
    next_release_date: null,
    next_release_status: null,
    next_release_cover_art_url: null,
    latest_release_id: "release-1",
    latest_release_title: "Latest Release",
    latest_release_date: "2026-06-01",
    latest_release_cover_art_url: null,
    missing_profile_fields: [],
    ...overrides,
  };
}

describe("ArtistRoster browsing rows", () => {
  it("renders representative upcoming, incomplete, complete, and empty-catalog artists with textual readiness", () => {
    const html = renderToStaticMarkup(
      <ArtistRoster
        artists={[
          makeArtist({
            id: "artist-upcoming",
            name: "Upcoming Artist",
            image_url: "artists/upcoming.jpg",
            next_release_id: "release-upcoming",
            next_release_title: "Future Signal",
            next_release_date: "2026-08-14",
          }),
          makeArtist({
            id: "artist-incomplete",
            name: "Incomplete Artist",
            image_url: "artists/incomplete.jpg",
            bio: null,
            pro: null,
            ipi: null,
            latest_release_title: "Needs Metadata",
          }),
          makeArtist({
            id: "artist-complete",
            name: "Complete Artist",
            image_url: "artists/complete.jpg",
            latest_release_title: "Fully Ready",
          }),
          makeArtist({
            id: "artist-empty",
            name: "Empty Catalog Artist",
            release_count: 0,
            latest_release_id: null,
            latest_release_title: null,
            latest_release_date: null,
            bio: "",
          }),
        ]}
        canMutate
      />,
    );

    expect(html).toContain("Upcoming Artist");
    expect(html).toContain("Upcoming");
    expect(html).toContain('href="/artists/artist-upcoming"');
    expect(html).toContain('href="/releases/release-upcoming"');
    expect(html).toContain("Incomplete Artist");
    expect(html).toContain("Missing Bio, PRO +1");
    expect(html).toContain('href="/artists/artist-incomplete?tab=overview&amp;focus=bio"');
    expect(html).toContain("Complete Artist");
    expect(html).toContain("100% ready");
    expect(html).toContain("Empty Catalog Artist");
    expect(html).toContain("No catalog yet");
    expect(html).not.toContain("Add a short bio to give the roster more identity at a glance.");
    expect(html).not.toContain('aria-label="Edit Upcoming Artist"');
    expect(html).not.toContain('aria-label="Delete Upcoming Artist"');
  });

  it("deep-links readiness summaries to the exact remediation route", () => {
    const html = renderToStaticMarkup(
      <ArtistRoster
        artists={[
          makeArtist({
            id: "artist-image-gap",
            name: "Image Gap Artist",
            image_url: null,
            bio: "Present bio",
            pro: "KODA",
            ipi: "12345",
            spotify_id: "spotify:artist:image-gap",
            spotify_followers: 1200,
            spotify_popularity: 42,
            instagram: "@imagegap",
            tiktok: "imagegaptok",
          }),
          makeArtist({
            id: "artist-bio-gap",
            name: "Bio Gap Artist",
            image_url: "artists/bio-gap.jpg",
            bio: null,
            pro: null,
            ipi: "12345",
          }),
        ]}
        canMutate
      />,
    );

    expect(html).toContain('href="/artists/artist-image-gap?tab=visuals&amp;destination=tab%3Avisuals"');
    expect(html).toContain('href="/artists/artist-bio-gap?tab=overview&amp;focus=bio"');
  });
});
