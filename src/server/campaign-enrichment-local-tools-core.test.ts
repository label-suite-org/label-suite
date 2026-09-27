import { describe, expect, it } from "vitest";
import type { CampaignEnrichmentQueueItem } from "../lib/campaign-enrichment-local-tool-contract";
import {
  buildLeadRevision,
  buildSubmissionHash,
  compareEnrichmentQueueItems,
} from "./campaign-enrichment-local-tools-core";

const revision = "a".repeat(64);

function queueItem(overrides: Partial<CampaignEnrichmentQueueItem>): CampaignEnrichmentQueueItem {
  return {
    item_id: "lead-cold",
    campaign_id: "campaign-1",
    campaign_name: "Fountain Edits",
    lead_id: "cold",
    target_name: "Cold Radio",
    target_url: "https://example.com",
    discovery_source: "Research",
    recommending_person: null,
    introduction_available: false,
    relationship_warmth: 0,
    musical_fit: null,
    exact_edit: "Fountain Edit",
    editorial_fit: 3,
    useful_reach: 2,
    direct_free_access: 2,
    missing_enrichment_fields: ["musical_fit"],
    lead_revision: revision,
    pipeline_stage: "identified",
    claim: { status: "unclaimed", expires_at: null },
    ...overrides,
  };
}

const lead = {
  id: "lead-1",
  campaign_id: "campaign-1",
  exact_edit_track_id: "track-1",
  target_name: "Night Shift",
  target_type: "radio_show",
  target_url: "https://example.com/night-shift",
  contact_route: "music@example.com",
  contact_route_verified_at: "2026-08-10T12:00:00.000Z",
  discovery_source: "Friend recommendation",
  recommending_person: "A friend",
  introduction_available: true,
  musical_fit: "Leftfield electronic music",
  relationship_warmth: 3,
  editorial_fit: 3,
  useful_reach: 2,
  direct_free_access: 2,
  pipeline_stage: "qualified",
  pitch_angle: "Exclusive first play",
  last_contacted_at: null,
  follow_up_at: null,
  outcome: null,
  evidence_url: null,
  published_at: null,
  updated_at: "2026-08-10T12:00:00.000Z",
};

const accepted = {
  id: "suggestion-accepted",
  suggestion_type: "musical_fit",
  status: "accepted" as const,
  updated_at: "2026-08-10T12:05:00.000Z",
};
const pending = { ...accepted, id: "suggestion-pending", status: "pending" as const };

const submission = {
  claim_id: "claim-1",
  expected_lead_revision: revision,
  idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
  proposals: [{
    field: "musical_fit" as const,
    value: "Fits the late-night selection.",
    rationale: "Recent programming has compatible artists.",
    evidence: [{
      title: "Programme archive",
      url: "https://example.com/programme",
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "The programme featured compatible artists.",
    }],
  }],
  client: { name: "label-suite-codex" as const, version: "0.1.0", session_label: null },
};

describe("campaign enrichment local-tool core", () => {
  it("orders introductions and friend recommendations before cold score", () => {
    const coldHighScore = queueItem({ lead_id: "cold" });
    const friendRecommendation = queueItem({
      lead_id: "friend",
      discovery_source: "Friend recommendation",
      relationship_warmth: 1,
      editorial_fit: 0,
      useful_reach: 0,
      direct_free_access: 0,
    });
    const warmIntroduction = queueItem({
      lead_id: "intro",
      introduction_available: true,
      discovery_source: "Existing relationship",
      relationship_warmth: 0,
      editorial_fit: 0,
      useful_reach: 0,
      direct_free_access: 0,
    });

    const ordered = [coldHighScore, friendRecommendation, warmIntroduction]
      .sort(compareEnrichmentQueueItems);

    expect(ordered.map((item) => item.lead_id)).toEqual(["intro", "friend", "cold"]);
  });

  it("uses a stable lead ID tie-breaker", () => {
    const ordered = [queueItem({ lead_id: "z" }), queueItem({ lead_id: "a" })]
      .sort(compareEnrichmentQueueItems);

    expect(ordered.map((item) => item.lead_id)).toEqual(["a", "z"]);
  });

  it("keeps unknown introduction availability below a confirmed introduction", () => {
    const ordered = [
      queueItem({ lead_id: "unknown", introduction_available: null }),
      queueItem({ lead_id: "intro", introduction_available: true }),
    ].sort(compareEnrichmentQueueItems);

    expect(ordered.map((item) => item.lead_id)).toEqual(["intro", "unknown"]);
  });

  it("changes lead revision for accepted research but not pending research", () => {
    expect(buildLeadRevision(lead, [accepted])).not.toBe(buildLeadRevision(lead, []));
    expect(buildLeadRevision(lead, [pending])).toBe(buildLeadRevision(lead, []));
  });

  it("keeps the revision stable when accepted suggestions arrive in a different order", () => {
    const anotherAccepted = { ...accepted, id: "suggestion-another", suggestion_type: "pitch_angle" };

    expect(buildLeadRevision(lead, [accepted, anotherAccepted]))
      .toBe(buildLeadRevision(lead, [anotherAccepted, accepted]));
  });

  it("ignores the idempotency key but detects content changes in a submission hash", () => {
    expect(buildSubmissionHash(submission)).toBe(buildSubmissionHash({
      ...submission,
      idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a45",
    }));
    expect(buildSubmissionHash(submission)).not.toBe(buildSubmissionHash({
      ...submission,
      proposals: [{ ...submission.proposals[0], rationale: "Different rationale." }],
    }));
  });
});
