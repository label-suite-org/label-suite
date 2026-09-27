import { describe, expect, it } from "vitest";
import {
  buildPublicPageProjection,
  campaignPublicPageContentSchema,
  getPublicPageReviewBlockers,
  isCampaignPublicPageContentHashValid,
  normalizePublicPageSlug,
  type PublicPageReviewInput,
} from "./campaign-public-page-core";
import type { CampaignDocument } from "../lib/campaign-rich-text";

function doc(text: string): CampaignDocument {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function headingDoc(text: string, level: 2 | 3): CampaignDocument {
  return { type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text }] }] };
}

const valid = campaignPublicPageContentSchema.parse({
  label_line: "True Nature presents",
  title: "Fountain Edits",
  release_note: "A short note for independent radio programmers.",
  artwork_asset_id: "asset-cover-1",
  focus_track_ids: ["track-1", "track-2"],
  listen_url: "https://listen.example.test/fountain-edits",
  download_url: "https://download.example.test/fountain-edits.zip",
  metadata_url: null,
  contact_name: "Malthe Lund Madsen",
  contact_email: "radio@example.test",
  network_statement: "Shared with our independent radio network.",
});
const { release_note_document: _validReleaseNoteDocument, ...legacyValid } = valid;

const reviewInput: PublicPageReviewInput = {
  content: valid,
  campaignId: "campaign-1",
  release: {
    id: "release-1",
    campaignId: "campaign-1",
    trackIds: ["track-1", "track-2", "track-3"],
    sourceSnapshot: "release-snapshot-2",
  },
  artwork: {
    id: "asset-cover-1",
    releaseId: "release-1",
    approvalStatus: "approved",
    fileLink: "https://cdn.example.test/artwork.jpg",
    sourceSnapshot: "release-snapshot-2",
  },
  sourceSnapshot: "release-snapshot-2",
};

describe("campaign public page core", () => {
  it("normalizes slugs using the database canonical form", () => {
    expect(normalizePublicPageSlug(" Fountain Edits ")).toBe("fountain-edits");
    expect(normalizePublicPageSlug("Fountain___Edits / Radio")).toBe("fountain-edits-radio");
    expect(normalizePublicPageSlug("---")).toBe("");
  });

  it("accepts the exact structured content shape and rejects extra fields", () => {
    expect(campaignPublicPageContentSchema.parse(valid)).toEqual(valid);
    expect(() => campaignPublicPageContentSchema.parse({ ...valid, arbitrary_html: "<script>" })).toThrow();
    expect(() => campaignPublicPageContentSchema.parse({ ...valid, listen_url: "javascript:alert(1)" })).toThrow();
    expect(() => campaignPublicPageContentSchema.parse({ ...valid, download_url: "http://download.example.test/file.zip" })).toThrow();
    expect(() => campaignPublicPageContentSchema.parse({ ...valid, metadata_url: "HTTPS://metadata.example.test" })).not.toThrow();
  });

  it("converts legacy release-note text into the canonical Campaign document", () => {
    const parsed = campaignPublicPageContentSchema.parse({
      ...legacyValid,
      release_note: "Legacy note",
    });

    expect(parsed.release_note_document).toEqual(doc("Legacy note"));
    expect(parsed.release_note).toBe("Legacy note");
  });

  it("treats the canonical release-note document as authoritative and applies the Campaign limit", () => {
    const parsed = campaignPublicPageContentSchema.parse({
      ...valid,
      release_note: "Stale compatibility text",
      release_note_document: headingDoc("Fountain", 2),
    });

    expect(parsed.release_note).toBe("Fountain");
    expect(parsed.release_note_document).toEqual(headingDoc("Fountain", 2));
    expect(() => campaignPublicPageContentSchema.parse({ ...legacyValid, release_note: "x".repeat(20_001) })).toThrow(/20000|20,000|characters/i);
    expect(campaignPublicPageContentSchema.parse({ ...legacyValid, release_note: "x".repeat(3_001) }).release_note).toHaveLength(3_001);
  });

  it("accepts historical legacy hashes without weakening canonical document integrity", () => {
    const legacyContent = { ...legacyValid, release_note: "Legacy note" };
    const canonicalContent = campaignPublicPageContentSchema.parse(legacyContent);
    const canonicalHash = "4f9d6ced5c2a29153e32490eb307508c3a8bc048845426885d4892f217c23843";

    expect(isCampaignPublicPageContentHashValid(
      legacyContent,
      "2ecc4e993ac1fbaa558399799f23298e986b5c711c9e8dd37a3251638a8cb107",
    )).toBe(true);
    expect(isCampaignPublicPageContentHashValid(canonicalContent, canonicalHash)).toBe(true);
    expect(isCampaignPublicPageContentHashValid({
      ...canonicalContent,
      release_note_document: doc("Changed after review"),
    }, canonicalHash)).toBe(false);
  });

  it("returns no blockers for current, owned, approved source records", () => {
    expect(getPublicPageReviewBlockers(reviewInput)).toEqual([]);
  });

  it("reports content blockers without querying a database", () => {
    expect(getPublicPageReviewBlockers({ ...valid, network_statement: "" })).toContain("network_statement");
    expect(getPublicPageReviewBlockers({ ...valid, listen_url: "http://listen.example.test" })).toContain("listen_url");
  });

  it("fails closed with a typed context blocker for malformed source state", () => {
    expect(getPublicPageReviewBlockers({ content: valid })).toEqual(["review_source_invalid"]);
  });

  it("rejects empty or malformed source identifiers and never builds a projection", () => {
    const malformedInputs = [
      { ...reviewInput, campaignId: "" },
      { ...reviewInput, release: { ...reviewInput.release, id: "" } },
      { ...reviewInput, release: { ...reviewInput.release, campaignId: " " } },
      { ...reviewInput, release: { ...reviewInput.release, trackIds: ["track-1", ""] } },
      { ...reviewInput, release: { ...reviewInput.release, sourceSnapshot: "" } },
      { ...reviewInput, artwork: { ...reviewInput.artwork, id: " " } },
      { ...reviewInput, artwork: { ...reviewInput.artwork, releaseId: "" } },
      { ...reviewInput, artwork: { ...reviewInput.artwork, sourceSnapshot: "" } },
      { ...reviewInput, sourceSnapshot: " " },
    ];

    for (const input of malformedInputs) {
      expect(getPublicPageReviewBlockers(input)).toContain("review_source_invalid");
      expect(() => buildPublicPageProjection(input as never)).toThrow(/review_source_invalid/);
    }

    expect(() => buildPublicPageProjection({ content: valid } as never)).toThrow();
  });

  it("reports ownership, approval, and source-snapshot blockers from explicit input", () => {
    const blockers = getPublicPageReviewBlockers({
      ...reviewInput,
      artwork: { ...reviewInput.artwork, releaseId: "release-other", approvalStatus: "pending" },
      sourceSnapshot: "release-snapshot-3",
    });

    expect(blockers).toEqual(expect.arrayContaining([
      "artwork_asset_not_in_release",
      "artwork_asset_not_approved",
      "source_snapshot_stale",
    ]));
  });

  it("reports campaign/release mismatch, artwork id mismatch, every missing focus track, and non-HTTPS artwork", () => {
    const blockers = getPublicPageReviewBlockers({
      ...reviewInput,
      release: { ...reviewInput.release, campaignId: "campaign-other", trackIds: ["track-1"] },
      artwork: { ...reviewInput.artwork, id: "asset-other", fileLink: "http://private.example.test/artwork.jpg" },
    });

    expect(blockers).toEqual(expect.arrayContaining([
      "release_ownership",
      "artwork_asset_not_in_release",
      "artwork_url",
      "focus_track_not_in_release:track-2",
    ]));
  });

  it("projects only reviewed, public fields and canonical track details", () => {
    const projection = buildPublicPageProjection({
      ...reviewInput,
      publishedAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:30:00.000Z",
      release: {
        ...reviewInput.release,
        releaseDate: "2026-08-01",
        catalogNumber: "TN-001",
        tracks: [
          { id: "track-1", title: "Fountain", duration: 201, credits: [{ name: "North", role: "Artist" }] },
          { id: "track-2", title: "Edit", duration: null, credits: [] },
        ],
      },
    });

    expect(projection).toEqual({
      content: {
        label_line: valid.label_line,
        title: valid.title,
        release_note: valid.release_note,
        release_note_html: `<p>${valid.release_note}</p>`,
        listen_url: valid.listen_url,
        download_url: valid.download_url,
        metadata_url: valid.metadata_url,
        contact_name: valid.contact_name,
        contact_email: valid.contact_email,
        network_statement: valid.network_statement,
      },
      artworkUrl: "https://cdn.example.test/artwork.jpg",
      tracks: [
        { title: "Fountain", duration: 201, credits: [{ name: "North", role: "Artist" }] },
        { title: "Edit", duration: null, credits: [] },
      ],
      releaseDate: "2026-08-01",
      catalogNumber: "TN-001",
      publishedAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:30:00.000Z",
    });

    expect(projection).not.toHaveProperty("org_id");
    expect(projection).not.toHaveProperty("content.artwork_asset_id");
    expect(projection).not.toHaveProperty("content.focus_track_ids");
    expect(projection).not.toHaveProperty("content.release_note_document");
    expect(projection.tracks[0]).not.toHaveProperty("id");
    expect(projection).not.toHaveProperty("sourceSnapshot");
    expect(JSON.stringify(projection)).not.toContain("storage_key");
  });

  it("projects server-derived HTML and fallback text from the canonical document", () => {
    const content = campaignPublicPageContentSchema.parse({
      ...valid,
      release_note: "Stale compatibility text",
      release_note_document: headingDoc("Fountain", 2),
    });

    const projection = buildPublicPageProjection({
      ...reviewInput,
      content,
      publishedAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:30:00.000Z",
      release: {
        ...reviewInput.release,
        releaseDate: null,
        catalogNumber: null,
        tracks: [
          { id: "track-1", title: "Fountain", duration: 201, credits: [] },
          { id: "track-2", title: "Edit", duration: null, credits: [] },
        ],
      },
    });

    expect(projection.content).toMatchObject({
      release_note: "Fountain",
      release_note_html: "<h2>Fountain</h2>",
    });
  });
});
