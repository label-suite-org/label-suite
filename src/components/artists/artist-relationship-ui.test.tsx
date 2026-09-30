import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtistRosterRow } from "../../server/artists";
import { ArtistForm } from "./ArtistForm";
import { ArtistRoster } from "./ArtistRoster";

const baseArtist: ArtistRosterRow = {
  id: "artist-1",
  name: "Artist One",
  image_url: null,
  bio: null,
  spotify_id: null,
  spotify_followers: null,
  spotify_popularity: null,
  pro: null,
  ipi: null,
  instagram: null,
  tiktok: null,
  relationship: null,
  contact_id: null,
  release_count: 0,
  campaign_count: 0,
  open_task_count: 0,
  next_release_id: null,
  next_release_title: null,
  next_release_date: null,
  next_release_status: null,
  next_release_cover_art_url: null,
  latest_release_id: null,
  latest_release_title: null,
  latest_release_date: null,
  latest_release_cover_art_url: null,
  missing_profile_fields: ["bio", "PRO"],
};

describe("artist relationship UI", () => {
  it("groups artists by stored relationship and keeps unclassified artists explicit", () => {
    const html = renderToStaticMarkup(
      <ArtistRoster
        artists={[
          { ...baseArtist, id: "artist-1", name: "Roster Artist", relationship: "roster" },
          { ...baseArtist, id: "artist-2", name: "Collaborator Artist", relationship: "collaborator" },
          { ...baseArtist, id: "artist-3", name: "Unknown Artist", relationship: null },
        ]}
        canMutate
      />,
    );

    expect(html).toContain("Roster artists");
    expect(html).toContain("Collaborators");
    expect(html).toContain("Unclassified artists");
    expect(html).toContain("Artist profiles that still need their roster relationship set.");
    expect(html).not.toContain("Core roster: True Blue, Former Actress, and Emanuella.");
  });

  it("surfaces relationship provenance and missing-contact state", () => {
    const html = renderToStaticMarkup(
      <ArtistRoster
        artists={[{
          ...baseArtist,
          name: "Unmatched Artist",
          airtable_record_id: "rec-artist-1",
        }]}
        canMutate={false}
      />,
    );

    expect(html).toContain("Evidence: Unclassified in Label Suite · no artist contact · Airtable mapping rec-artist-1");
  });

  it("renders relationship and contact controls in the artist editor", () => {
    const html = renderToStaticMarkup(
      <ArtistForm
        onClose={() => undefined}
        initial={{ id: "artist-1", name: "Artist One", relationship: "collaborator", contact_id: "contact-1" }}
        contactOptions={[
          { id: "contact-1", name: "Malthe Lund Madsen" },
          { id: "contact-2", name: "Lorenzo" },
        ]}
      />,
    );

    expect(html).toContain("Roster relationship");
    expect(html).toContain("Primary contact");
    expect(html).toContain("Malthe Lund Madsen");
    expect(html).toContain("Collaborator");
  });
});

it("keeps optional creation fields in a disclosure and opens them when editing", () => {
  const create = renderToStaticMarkup(<ArtistForm onClose={() => undefined} />);
  expect(create).toContain("Artist image (optional)");
  expect(create).toContain("Profile details (optional)");
  expect(create).not.toContain('<details open=""');
  const edit = renderToStaticMarkup(<ArtistForm initial={{ id: "artist-1", name: "Test Artist", pro: "KODA" }} onClose={() => undefined} />);
  expect(edit).toContain('<details open=""');
  expect(edit).toContain('value="KODA"');
});
