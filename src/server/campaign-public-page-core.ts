import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  deriveCampaignDocument,
  type CampaignDocument,
} from "../lib/campaign-rich-text";

const HTTPS_URL_MESSAGE = "URL must use HTTPS";

/** A public link may never point at a non-HTTPS or provider-controlled scheme. */
const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, HTTPS_URL_MESSAGE);

function normalizeReleaseNoteDocument(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const record = value as Record<string, unknown>;
  const source = Object.hasOwn(record, "release_note_document")
    ? record.release_note_document
    : record.release_note;
  try {
    const derived = deriveCampaignDocument(source, 20_000);
    return {
      ...record,
      release_note_document: derived.document,
      release_note: derived.plainText,
    };
  } catch {
    return value;
  }
}

const canonicalCampaignDocumentSchema = z.custom<CampaignDocument>((value) => {
  try {
    return JSON.stringify(deriveCampaignDocument(value, 20_000).document) === JSON.stringify(value);
  } catch {
    return false;
  }
}, "Release note document is invalid");

export const campaignPublicPageContentSchema = z.preprocess(normalizeReleaseNoteDocument, z.object({
  label_line: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  release_note: z.string().max(20_000).refine((value) => value.trim().length > 0, "Release note is required"),
  release_note_document: canonicalCampaignDocumentSchema,
  artwork_asset_id: z.string().trim().min(1),
  focus_track_ids: z.array(z.string().trim().min(1)).min(1).max(12),
  listen_url: httpsUrl,
  download_url: httpsUrl.nullable(),
  metadata_url: httpsUrl.nullable(),
  contact_name: z.string().trim().min(1).max(160),
  contact_email: z.string().trim().email(),
  network_statement: z.literal("Shared with our independent radio network."),
}).strict());

export type CampaignPublicPageContent = z.infer<typeof campaignPublicPageContentSchema>;

export function isCampaignPublicPageContentHashValid(content: unknown, storedHash: unknown): boolean {
  if (typeof storedHash !== "string" || storedHash.length === 0) return false;
  const parsed = campaignPublicPageContentSchema.safeParse(content);
  if (!parsed.success) return false;
  if (stableContentHash(parsed.data) === storedHash) return true;
  if (!content || typeof content !== "object" || Array.isArray(content) || Object.getPrototypeOf(content) !== Object.prototype) return false;
  const rawContent = content as Record<string, unknown>;
  return !Object.hasOwn(rawContent, "release_note_document") && stableContentHash(rawContent) === storedHash;
}

function stableContentHash(value: unknown): string {
  return bytesToHex(sha256(JSON.stringify(sortForContentHash(value))));
}

function sortForContentHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForContentHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForContentHash(item)]));
  }
  return value;
}

export interface PublicPageReleaseSnapshot {
  id: string;
  campaignId: string;
  trackIds: readonly string[];
  sourceSnapshot: string;
  releaseDate?: string | null;
  catalogNumber?: string | null;
  tracks?: readonly PublicPageTrack[];
}

export interface PublicPageArtworkSnapshot {
  id: string;
  releaseId: string | null;
  approvalStatus: string | null;
  fileLink: string | null;
  sourceSnapshot: string;
}

export interface PublicPageTrackCredit {
  name: string;
  role: string;
}

export interface PublicPageTrack {
  id: string;
  title: string;
  duration: number | null;
  credits: readonly PublicPageTrackCredit[];
}

export type PublicPageTrackDisplay = Omit<PublicPageTrack, "id">;
declare const serverDerivedPublicHtml: unique symbol;
export type ServerDerivedPublicHtml = string & { readonly [serverDerivedPublicHtml]: true };
export type PublicPageEditorialContent = Omit<CampaignPublicPageContent, "artwork_asset_id" | "focus_track_ids" | "release_note_document"> & {
  release_note_html: ServerDerivedPublicHtml;
};

/**
 * All source state needed to decide whether a revision is safe to review.
 * The service owns loading this snapshot; this core module intentionally has
 * no database access and cannot accidentally widen the tenant boundary.
 */
export interface PublicPageReviewInput {
  content: CampaignPublicPageContent;
  campaignId: string;
  release: PublicPageReleaseSnapshot;
  artwork: PublicPageArtworkSnapshot;
  sourceSnapshot: string;
}

export interface BuildPublicPageProjectionInput extends PublicPageReviewInput {
  publishedAt: string | Date;
  updatedAt: string | Date;
  release: PublicPageReleaseSnapshot & {
    releaseDate: string | null;
    catalogNumber: string | null;
    tracks: readonly PublicPageTrack[];
  };
}

export interface PublicPageProjection {
  content: PublicPageEditorialContent;
  artworkUrl: string;
  tracks: PublicPageTrackDisplay[];
  releaseDate: string | null;
  catalogNumber: string | null;
  publishedAt: string;
  updatedAt: string;
}

export type PublicPageReviewBlocker =
  | "content"
  | "label_line"
  | "title"
  | "release_note"
  | "release_note_document"
  | "artwork_asset_id"
  | "focus_track_ids"
  | "listen_url"
  | "download_url"
  | "metadata_url"
  | "contact_name"
  | "contact_email"
  | "network_statement"
  | "campaign_ownership"
  | "release_ownership"
  | "review_source_invalid"
  | "artwork_asset_not_in_release"
  | "artwork_asset_not_approved"
  | "artwork_url"
  | "focus_track_not_in_release"
  | "source_snapshot_stale"
  | `focus_track_not_in_release:${string}`;

/** The exact canonical form enforced by campaign_public_pages.slug. */
export function normalizePublicPageSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isReviewInput(value: unknown): value is { content: unknown } {
  return typeof value === "object" && value !== null && "content" in value;
}

function hasReviewSourceState(value: { content: unknown }): value is PublicPageReviewInput {
  const candidate = value as Partial<PublicPageReviewInput>;
  const release = candidate.release;
  const artwork = candidate.artwork;
  const nonEmpty = (item: unknown): item is string => typeof item === "string" && item.trim().length > 0;
  return Boolean(
    nonEmpty(candidate.campaignId) &&
    nonEmpty(candidate.sourceSnapshot) &&
    release &&
    typeof release === "object" &&
    nonEmpty(release.id) &&
    nonEmpty(release.campaignId) &&
    Array.isArray(release.trackIds) &&
    release.trackIds.every(nonEmpty) &&
    nonEmpty(release.sourceSnapshot) &&
    artwork &&
    typeof artwork === "object" &&
    nonEmpty(artwork.id) &&
    nonEmpty(artwork.releaseId) &&
    (typeof artwork.approvalStatus === "string" || artwork.approvalStatus === null) &&
    (typeof artwork.fileLink === "string" || artwork.fileLink === null) &&
    nonEmpty(artwork.sourceSnapshot),
  );
}

function contentForReview(value: unknown): unknown {
  return isReviewInput(value) ? value.content : value;
}

function pushSchemaBlockers(value: unknown, blockers: PublicPageReviewBlocker[]): value is CampaignPublicPageContent {
  const parsed = campaignPublicPageContentSchema.safeParse(value);
  if (parsed.success) return true;

  for (const issue of parsed.error.issues) {
    const path = issue.path[0];
    if (typeof path === "string" && !blockers.includes(path as PublicPageReviewBlocker)) {
      blockers.push(path as PublicPageReviewBlocker);
    }
  }
  if (blockers.length === 0) blockers.push("content");
  return false;
}

/**
 * Return deterministic review blockers from content plus an explicit source
 * snapshot. Passing content alone is supported for content-only validation;
 * ownership and freshness checks require the typed PublicPageReviewInput.
 */
export function getPublicPageReviewBlockers(value: PublicPageReviewInput | CampaignPublicPageContent | Record<string, unknown>): PublicPageReviewBlocker[] {
  const blockers: PublicPageReviewBlocker[] = [];
  const contentValue = contentForReview(value);
  const contentIsValid = pushSchemaBlockers(contentValue, blockers);

  if (!isReviewInput(value) || !contentIsValid) return blockers;
  if (!hasReviewSourceState(value)) {
    blockers.push("review_source_invalid");
    return blockers;
  }

  const { content, campaignId, release, artwork, sourceSnapshot } = value;
  if (release.campaignId !== campaignId) blockers.push("release_ownership");
  if (artwork.releaseId !== release.id) blockers.push("artwork_asset_not_in_release");
  if (artwork.id !== content.artwork_asset_id) blockers.push("artwork_asset_not_in_release");
  if (artwork.approvalStatus !== "approved") blockers.push("artwork_asset_not_approved");

  if (!isHttpsUrl(artwork.fileLink)) blockers.push("artwork_url");
  const missingFocusTrackIds = content.focus_track_ids.filter((id) => !release.trackIds.includes(id));
  if (missingFocusTrackIds.length > 0) {
    blockers.push("focus_track_not_in_release");
    blockers.push(...missingFocusTrackIds.map((id) => `focus_track_not_in_release:${id}` as const));
  }

  if (
    !sourceSnapshot ||
    release.sourceSnapshot !== sourceSnapshot ||
    artwork.sourceSnapshot !== sourceSnapshot
  ) {
    blockers.push("source_snapshot_stale");
  }

  return uniqueBlockers(blockers);
}

function isHttpsUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function uniqueBlockers(blockers: PublicPageReviewBlocker[]): PublicPageReviewBlocker[] {
  return [...new Set(blockers)];
}

function asIsoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid publication timestamp");
  return date.toISOString();
}

function copyTrack(track: PublicPageTrack): PublicPageTrackDisplay {
  return {
    title: track.title,
    duration: track.duration,
    credits: track.credits.map((credit) => ({ name: credit.name, role: credit.role })),
  };
}

/**
 * Build the intentionally narrow object consumed by the public renderer.
 * No organisation IDs, storage keys, source snapshots, or provider metadata
 * cross this boundary.
 */
export function buildPublicPageProjection(input: BuildPublicPageProjectionInput): PublicPageProjection {
  const content = campaignPublicPageContentSchema.parse(input.content);
  const releaseNote = deriveCampaignDocument(content.release_note_document, 20_000);
  const blockers = getPublicPageReviewBlockers(input);
  if (blockers.length > 0) throw new Error(`Public page source is not reviewable: ${blockers.join(", ")}`);
  if (!isHttpsUrl(input.artwork.fileLink)) throw new Error("Public artwork URL must use HTTPS");

  const tracksById = new Map(input.release.tracks.map((track) => [track.id, track]));
  const tracks = content.focus_track_ids.map((trackId) => {
    const track = tracksById.get(trackId);
    if (!track) throw new Error(`Canonical track ${trackId} is missing`);
    return copyTrack(track);
  });

  return {
    content: {
      label_line: content.label_line,
      title: content.title,
      release_note: releaseNote.plainText,
      release_note_html: releaseNote.html as ServerDerivedPublicHtml,
      listen_url: content.listen_url,
      download_url: content.download_url,
      metadata_url: content.metadata_url,
      contact_name: content.contact_name,
      contact_email: content.contact_email,
      network_statement: content.network_statement,
    },
    artworkUrl: input.artwork.fileLink,
    tracks,
    releaseDate: input.release.releaseDate ?? null,
    catalogNumber: input.release.catalogNumber ?? null,
    publishedAt: asIsoTimestamp(input.publishedAt),
    updatedAt: asIsoTimestamp(input.updatedAt),
  };
}
