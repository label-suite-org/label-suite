import { describe, expect, it } from "vitest";
import {
  buildRequirements,
  canApplyEnrichmentReport,
  planDeadlineRounds,
} from "./seed-grant-enrichment-v2";

describe("grant enrichment safety contract", () => {
  it("blocks apply mode when matching errors are present", () => {
    expect(canApplyEnrichmentReport({ ambiguous: [], notFound: [], validationErrors: [], errors: [] })).toBe(true);
    expect(canApplyEnrichmentReport({ ambiguous: [{ airtableId: "rec-x", inputName: "x", candidates: [] }], notFound: [], validationErrors: [], errors: [] })).toBe(false);
  });

  it("plans deadline reconciliation even when grant fields are unchanged", () => {
    const plan = planDeadlineRounds(
      "true-nature",
      "grant-1",
      [{
        deadline_date: "2026-09-17",
        timezone: "Europe/Copenhagen",
        classification: "confirmed",
        label: "Round 3",
        source_url: "https://example.com/grant",
      }],
      [],
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe("insert");
    expect(plan[0].classification).toBe("confirmed");
  });

  it("preserves imported application requirements while adding enrichment context", () => {
    const existing = "Detailed imported application instructions and attachments.";
    expect(buildRequirements(existing, "Short restriction summary", "Short applicant requirement"))
      .toBe(existing);
  });
});
