import { describe, expect, it } from "vitest";
import { deriveReviewedRichText, normalizeReviewedRichText } from "./reviewed-rich-text";

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

describe("reviewed rich text", () => {
  it.each([
    ["missing", paragraph(""), null, "draft", "missing"],
    ["draft", paragraph("Draft biography"), null, "draft", "draft"],
    ["reviewed", paragraph("Reviewed biography"), "current", "reviewed", "reviewed"],
    ["stale", paragraph("Changed biography"), "older", "reviewed", "stale"],
  ])("keeps %s content distinct", (_label, document, reviewedHash, reviewStatus, expectedState) => {
    const current = deriveReviewedRichText(document, {
      reviewedHash: reviewedHash === "current" ? "f1f2-placeholder" : reviewedHash,
      reviewStatus: reviewStatus as "draft" | "reviewed",
    });
    const result = reviewedHash === "current"
      ? deriveReviewedRichText(document, { reviewedHash: current.hash, reviewStatus: "reviewed" })
      : current;

    expect(result.state).toBe(expectedState);
  });

  it("preserves malformed stored content as safely escaped compatibility text", () => {
    expect(normalizeReviewedRichText(
      { type: "script", content: [] },
      '<img src=x onerror="alter-tenant">',
      { reviewStatus: "reviewed", reviewedHash: "stale" },
    )).toMatchObject({
      html: "<p>&lt;img src=x onerror=&quot;alter-tenant&quot;&gt;</p>",
      plainText: '<img src=x onerror="alter-tenant">',
      state: "draft",
      usedFallback: true,
    });
  });
});
