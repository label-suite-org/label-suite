import { describe, expect, it } from "vitest";
import {
  campaignEnrichmentClaimRequestSchema,
  campaignEnrichmentEvidenceSchema,
  campaignEnrichmentProposalSubmissionSchema,
  campaignEnrichmentQueueQuerySchema,
  type CampaignEnrichmentQueueItem,
  localToolClaimConflictDetailsSchema,
  localToolScopeSchema,
} from "./campaign-enrichment-local-tool-contract";

describe("campaign enrichment local-tool contract", () => {
  it("allows only the three proposal scopes and the read-only diagnostic scope", () => {
    expect(localToolScopeSchema.options).toEqual([
      "campaign.enrichment.read",
      "campaign.enrichment.claim",
      "campaign.enrichment.propose",
      "operator.diagnostics.read",
    ]);
  });

  it("rejects acceptance fields and non-HTTPS evidence", () => {
    expect(campaignEnrichmentProposalSubmissionSchema.safeParse({
      claim_id: "claim-1",
      expected_lead_revision: "a".repeat(64),
      idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
      proposals: [{
        field: "pipeline_stage",
        value: "ready",
        rationale: "Change stage",
        evidence: [{
          title: "Source",
          url: "http://example.com",
          retrieved_at: "2026-08-10T12:00:00.000Z",
          citation_text: "Evidence",
        }],
      }],
      client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
    }).success).toBe(false);
  });

  it("applies bounded queue and claim defaults", () => {
    expect(campaignEnrichmentQueueQuerySchema.parse({})).toEqual({ state: "all", limit: 20 });
    expect(campaignEnrichmentClaimRequestSchema.parse({ expected_lead_revision: "a".repeat(64) }))
      .toEqual({ expected_lead_revision: "a".repeat(64), lease_minutes: 20 });
    expect(campaignEnrichmentQueueQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(campaignEnrichmentClaimRequestSchema.safeParse({ expected_lead_revision: "A".repeat(64) }).success).toBe(false);
  });

  it("rejects duplicate fields, unsafe evidence, and unknown payload fields", () => {
    const submission = {
      claim_id: "claim-1",
      expected_lead_revision: "a".repeat(64),
      idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
      proposals: [{
        field: "musical_fit",
        value: "Fits the station's late-night selection.",
        rationale: "Recent programming has compatible artists.",
        evidence: [{
          title: "Programme archive",
          url: "https://example.com/programme",
          retrieved_at: "2026-08-10T12:00:00.000Z",
          citation_text: "The programme featured compatible artists.",
        }],
      }],
      client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
    };

    expect(campaignEnrichmentProposalSubmissionSchema.safeParse({
      ...submission,
      proposals: [...submission.proposals, submission.proposals[0]],
    }).success).toBe(false);
    expect(campaignEnrichmentProposalSubmissionSchema.safeParse({
      ...submission,
      proposals: [{ ...submission.proposals[0], evidence: [{ ...submission.proposals[0].evidence[0], url: "http://example.com/programme" }] }],
    }).success).toBe(false);
    expect(campaignEnrichmentProposalSubmissionSchema.safeParse({ ...submission, accepted: true }).success).toBe(false);
  });

  it("rejects canonically duplicate evidence within one proposal", () => {
    const evidence = {
      title: "Programme archive",
      url: "https://example.com/programme",
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "The programme featured compatible artists.",
    };
    const submission = {
      claim_id: "claim-1",
      expected_lead_revision: "a".repeat(64),
      idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
      proposals: [{
        field: "musical_fit",
        value: "Fits the station's late-night selection.",
        rationale: "Recent programming has compatible artists.",
        evidence: [evidence, {
          title: "  programme   ARCHIVE ",
          url: "https://EXAMPLE.com:443/programme",
          retrieved_at: "2026-08-10T14:00:00.000+02:00",
          citation_text: " the programme featured  compatible artists. ",
        }],
      }],
      client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
    };

    const result = campaignEnrichmentProposalSubmissionSchema.safeParse(submission);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["proposals", 0, "evidence", 1] }),
      ]));
    }
  });

  it("preserves an unknown introduction availability value", () => {
    const item: CampaignEnrichmentQueueItem = {
      item_id: "lead-1",
      campaign_id: "campaign-1",
      campaign_name: "Fountain Edits",
      lead_id: "lead-1",
      target_name: "Night Shift",
      target_url: "https://example.com/night-shift",
      discovery_source: "Research",
      recommending_person: null,
      introduction_available: null,
      relationship_warmth: 0,
      musical_fit: null,
      exact_edit: null,
      editorial_fit: 0,
      useful_reach: 0,
      direct_free_access: 0,
      missing_enrichment_fields: ["musical_fit"],
      lead_revision: "a".repeat(64),
      pipeline_stage: "identified",
      claim: { status: "unclaimed", expires_at: null },
    };

    expect(item.introduction_available).toBeNull();
  });

  it("allows only a bounded expiry timestamp in claim-conflict details", () => {
    expect(localToolClaimConflictDetailsSchema.parse({
      expires_at: "2026-08-10T12:20:00.000Z",
    })).toEqual({ expires_at: "2026-08-10T12:20:00.000Z" });
    expect(localToolClaimConflictDetailsSchema.safeParse({
      expires_at: "not-a-timestamp",
    }).success).toBe(false);
    expect(localToolClaimConflictDetailsSchema.safeParse({
      expires_at: "2026-08-10T12:20:00.000Z",
      token_id: "token-foreign",
      claimant_email: "other-org-contact@example.com",
    }).success).toBe(false);
  });

  it("rejects malformed or oversized evidence URLs", () => {
    const evidence = {
      title: "Programme archive",
      url: "https://example.com/programme",
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "The programme featured compatible artists.",
    };

    expect(campaignEnrichmentEvidenceSchema.safeParse({
      ...evidence,
      url: "not-a-url",
    }).success).toBe(false);
    expect(campaignEnrichmentEvidenceSchema.safeParse({
      ...evidence,
      url: `https://example.com/${"a".repeat(2_048)}`,
    }).success).toBe(false);
  });
});
