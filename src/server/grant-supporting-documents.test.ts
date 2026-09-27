import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));

import { buildApplicationWritingGuide, GRANT_DOCUMENT_ROLES, linkGrantSupportingDocumentSchema, replaceGrantSupportingDocumentsSchema } from "./grant-supporting-documents";

describe("grant supporting documents", () => {
  it("exposes the four deterministic evidence roles", () => {
    expect(GRANT_DOCUMENT_ROLES).toEqual(["submitted_application", "award_decision", "expense_documentation", "other"]);
  });

  it("accepts only the four evidence roles on link and replace boundaries", () => {
    for (const asset_role of GRANT_DOCUMENT_ROLES) {
      expect(linkGrantSupportingDocumentSchema.parse({ document_id: "doc-1", asset_role }).asset_role).toBe(asset_role);
      expect(replaceGrantSupportingDocumentsSchema.parse({ documents: [{ document_id: "doc-1", asset_role }] }).documents[0].asset_role).toBe(asset_role);
    }
    expect(() => linkGrantSupportingDocumentSchema.parse({ document_id: "doc-1", asset_role: "budget" })).toThrow();
    expect(() => replaceGrantSupportingDocumentsSchema.parse({ documents: [{ document_id: "doc-1", asset_role: "budget" }] })).toThrow();
  });

  it("builds a source-labelled writing guide with pending and failed evidence visible", () => {
    const guide = buildApplicationWritingGuide(
      { angle_narrative: "A focused release story", response_notes: "Funder asked for outcomes", evaluation: "Strong fit" },
      { requirements: "CV and budget", eligible_uses: "Recording", assessment_body: "Clarity", description: "Support for releases" },
      [
        { name: "Submitted form.pdf", asset_role: "submitted_application", readiness_status: "ready", extraction_status: "ready", extracted_text_preview: "The submitted answer", extraction_error: null },
        { name: "Expense documentation.pdf", asset_role: "expense_documentation", readiness_status: "ready", extraction_status: "failed", extracted_text_preview: null, extraction_error: "Parser failed" },
      ],
      [{ requirementName: "Budget", required: true, readinessStatus: "missing" }, { requirementName: "Stale report", required: true, readinessStatus: "stale" }],
    );

    expect(guide.map((block) => block.title)).toEqual([
      "Grant requirements", "Eligible uses", "Application angle", "Response notes", "Evaluation", "Submitted application evidence", "Missing evidence",
    ]);
    expect(guide.find((block) => block.title === "Submitted application evidence")?.source).toContain("Submitted form.pdf");
    expect(guide.find((block) => block.title === "Missing evidence")?.content).toContain("Expense documentation.pdf: extraction failed");
    expect(guide.find((block) => block.title === "Missing evidence")?.content).toContain("Budget: missing");
    expect(guide.find((block) => block.title === "Missing evidence")?.source).toContain("Application checklist");
  });
});
