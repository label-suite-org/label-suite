import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  type CampaignCharacterLimit,
  type CampaignDocumentDerived,
} from "./campaign-rich-text";

export type ReviewedRichTextState = "missing" | "draft" | "reviewed" | "stale";

export interface ReviewedRichTextMetadata {
  reviewStatus: "draft" | "reviewed";
  reviewedHash: string | null;
}

export interface ReviewedRichText extends CampaignDocumentDerived {
  state: ReviewedRichTextState;
  usedFallback: boolean;
}

export function deriveReviewedRichText(
  input: unknown,
  metadata: ReviewedRichTextMetadata,
  characterLimit: CampaignCharacterLimit = 20_000,
): ReviewedRichText {
  const derived = deriveCampaignDocument(input, characterLimit);
  const state: ReviewedRichTextState = !derived.plainText.trim()
    ? "missing"
    : metadata.reviewStatus !== "reviewed"
      ? "draft"
      : metadata.reviewedHash === derived.hash
        ? "reviewed"
        : "stale";

  return { ...derived, state, usedFallback: false };
}

export function normalizeReviewedRichText(
  input: unknown,
  fallbackText: string | null | undefined,
  metadata: ReviewedRichTextMetadata,
  characterLimit: CampaignCharacterLimit = 20_000,
): ReviewedRichText {
  if (input == null) {
    return deriveReviewedRichText(
      legacyTextToCampaignDocument(fallbackText ?? ""),
      { reviewStatus: "draft", reviewedHash: null },
      characterLimit,
    );
  }
  try {
    return deriveReviewedRichText(input, metadata, characterLimit);
  } catch {
    const fallback = deriveReviewedRichText(
      legacyTextToCampaignDocument(fallbackText ?? ""),
      { reviewStatus: "draft", reviewedHash: null },
      characterLimit,
    );
    return { ...fallback, usedFallback: true };
  }
}
