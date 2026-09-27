import { describe, expect, it } from "vitest";
import { buildOperationalUpdate, parseLegacyRules, planOperationalEnrichment } from "./seed-grant-operational-enrichment";

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-test",
    org_id: "true-nature",
    name: "Test grant",
    funder: "Test funder",
    program: null,
    category: "production",
    url: "https://example.org/grant",
    research_url: null,
    description: null,
    requirements: null,
    applicant_type: "artists",
    eligible_uses: "recording",
    assessment_body: "funder panel",
    response_timing: "8 weeks",
    rules: null,
    research_status: "research",
    research_summary: null,
    research_source: null,
    last_verified_at: null,
    opens_on: null,
    deadline: null,
    max_amount: 50000,
    currency: "DKK",
    priority: "medium",
    status: "open",
    notes: "Airtable source: recTEST123",
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
    ...overrides,
  } as any;
}

describe("operational grant enrichment", () => {
  it("preserves malformed legacy rules explicitly and leaves unknown flags null", () => {
    const update = buildOperationalUpdate(grant({ rules: "legacy text rule" }));
    const rules = JSON.parse(update.rules);
    expect(rules.legacy_rules).toBe("legacy text rule");
    expect(rules.aps_eligible).toBeNull();
    expect(rules.commercial_allowed).toBeNull();
    expect(rules.evidence_status).toBe("needs_verification");
  });

  it("uses existing official provenance without marking the record verified", () => {
    const update = buildOperationalUpdate(grant());
    expect(update.research_source).toBe("https://example.org/grant");
    expect(update.research_summary).toContain("Official entity eligibility");
  });

  it("does not overwrite a verified row", () => {
    const plan = planOperationalEnrichment([grant({ research_status: "verified" })]);
    expect(plan.skippedVerified).toBe(1);
    expect(plan.eligible).toBe(0);
    expect(plan.updates).toHaveLength(0);
  });

  it("is idempotent after applying the planned update", () => {
    const original = grant();
    const update = buildOperationalUpdate(original);
    const applied = grant({ ...update });
    const plan = planOperationalEnrichment([applied]);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toHaveLength(0);
  });

  it("rejects non-object JSON as structured rules", () => {
    expect(parseLegacyRules("[]")).toBeNull();
    expect(parseLegacyRules("not json")).toBeNull();
  });
});
