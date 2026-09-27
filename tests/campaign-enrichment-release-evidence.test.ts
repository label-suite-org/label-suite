import { describe, expect, it } from "vitest";
import {
  canonicalLeadEvidence,
  requireCompleteActivitySourceStates,
} from "./campaign-enrichment-release-evidence";

const canonicalLead = {
  id: "e2e-lead",
  campaign_id: "e2e-campaign",
  exact_edit_track_id: "e2e-track",
  target_name: "Synthetic target",
  target_type: "radio_show",
  target_url: "https://example.test/target",
  contact_route: "synthetic@example.test",
  contact_route_verified_at: "2026-08-10T10:00:00.000Z",
  discovery_source: "Synthetic release gate",
  recommending_person: "Synthetic recommender",
  introduction_available: false,
  musical_fit: "Synthetic fit",
  relationship_warmth: 1,
  editorial_fit: 2,
  useful_reach: 1,
  direct_free_access: 2,
  pipeline_stage: "qualified",
  pitch_angle: "Synthetic angle",
  last_contacted_at: null,
  follow_up_at: null,
  outcome: null,
  evidence_url: "https://example.test/evidence",
  published_at: null,
  updated_at: "2026-08-10T11:00:00.000Z",
};

describe("campaign enrichment release-gate evidence", () => {
  it("requires every Campaign Activity source to be uniquely complete", () => {
    const complete = [
      { source: "outreach_events", state: "complete", message: null },
      { source: "tasks", state: "complete", message: null },
      { source: "email_logs", state: "complete", message: null },
      { source: "lead_milestones", state: "complete", message: null },
      { source: "review_state", state: "complete", message: null },
    ];

    expect(requireCompleteActivitySourceStates({ sourceStates: complete })).toEqual(complete);
    expect(() => requireCompleteActivitySourceStates({
      sourceStates: complete.map((entry) => entry.source === "email_logs"
        ? { ...entry, state: "unavailable", message: "Email logs unavailable" }
        : entry),
    })).toThrow("email_logs");
    expect(() => requireCompleteActivitySourceStates({ sourceStates: complete.slice(0, 4) }))
      .toThrow("review_state");
    expect(() => requireCompleteActivitySourceStates({ sourceStates: [...complete, complete[0]] }))
      .toThrow("outreach_events");
  });

  it("projects every canonical lead DTO field plus exact-edit and revision evidence", () => {
    const evidence = canonicalLeadEvidence({
      canonical_lead: canonicalLead,
      exact_edit: "Synthetic exact edit",
      lead_revision: "a".repeat(64),
      missing_enrichment_fields: ["programming_focus"],
      claim: { status: "claimed", expires_at: "2026-08-10T12:00:00.000Z" },
      pending_suggestions: [{ id: "expected-proposal-change" }],
    });

    expect(evidence).toEqual({
      lead: canonicalLead,
      exact_edit: "Synthetic exact edit",
      lead_revision: "a".repeat(64),
      missing_enrichment_fields: ["programming_focus"],
    });
    expect(evidence).not.toHaveProperty("claim");
    expect(evidence).not.toHaveProperty("pending_suggestions");
  });

  it("fails closed when the authoritative DTO omits, adds, or corrupts canonical data", () => {
    const item = {
      canonical_lead: canonicalLead,
      exact_edit: "Synthetic exact edit",
      lead_revision: "a".repeat(64),
      missing_enrichment_fields: ["programming_focus"],
    };

    const { target_name: _missing, ...missingField } = canonicalLead;
    expect(() => canonicalLeadEvidence({ ...item, canonical_lead: missingField })).toThrow("target_name");
    expect(() => canonicalLeadEvidence({
      ...item,
      canonical_lead: { ...canonicalLead, unexpected: "not canonical" },
    })).toThrow("unexpected");
    expect(() => canonicalLeadEvidence({ ...item, lead_revision: "not-a-revision" }))
      .toThrow("lead_revision");
    expect(() => canonicalLeadEvidence({
      ...item,
      canonical_lead: { ...canonicalLead, relationship_warmth: 4 },
    })).toThrow("relationship_warmth");
    expect(() => canonicalLeadEvidence({
      ...item,
      canonical_lead: { ...canonicalLead, updated_at: "not-a-timestamp" },
    })).toThrow("updated_at");
  });
});
