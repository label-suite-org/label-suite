import { describe, expect, test } from "vitest";
import {
  buildAcceptedDraftContext,
  calculateSuggestedFollowUp,
  decideSuggestionSchema,
  generateDraftSchema,
  getDraftApprovalBlockers,
  getLeadReadyBlockers,
  groupLeadQueue,
  manualRadioUpdateDraftSchema,
  overrideLeadStageSchema,
  recordSentSchema,
  type LeadQueueItem,
  type LeadReadinessInput,
} from "./campaign-communicator-core";
import type { CampaignDocument } from "../lib/campaign-rich-text";

const NOW = new Date("2026-08-04T10:00:00Z");

function doc(text: string): CampaignDocument {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function queueLead(overrides: Partial<LeadQueueItem> = {}): LeadQueueItem {
  return {
    id: "lead-1",
    pipeline_stage: "qualified",
    priority_score: 5,
    follow_up_at: null,
    last_contacted_at: null,
    updated_at: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

function readyLead(overrides: Partial<LeadReadinessInput> = {}): LeadReadinessInput {
  return {
    contact_route: "music@example.com",
    contact_route_verified_at: "2026-08-01T10:00:00.000Z",
    exact_edit_track_id: "track-1",
    campaign_wide_update: false,
    musical_fit: "A strong fit for their leftfield programming.",
    pitch_angle: "Offer the DJ Python Remix as the clearest entry point.",
    batch_update_assigned: false,
    recommending_person: "Mia",
    introduction_available: true,
    approved_draft_id: "draft-1",
    has_open_task: true,
    readiness_task_waiver_reason: null,
    ...overrides,
  };
}

describe("campaign communicator queue", () => {
  test("groups due follow-ups ahead of priority-sorted current work", () => {
    const overdueLead = queueLead({
      id: "overdue",
      priority_score: 1,
      pipeline_stage: "sent",
      follow_up_at: new Date("2026-08-02T10:00:00Z"),
    });
    const highScoreLead = queueLead({
      id: "high-score",
      priority_score: 10,
      pipeline_stage: "qualified",
    });

    expect(groupLeadQueue([overdueLead, highScoreLead], NOW).followUp[0].id).toBe(overdueLead.id);
    expect(groupLeadQueue([overdueLead, highScoreLead], NOW).now).toEqual([highScoreLead]);
  });

  test("keeps sent leads without a due follow-up in waiting", () => {
    const sentLead = queueLead({ id: "sent", pipeline_stage: "sent" });

    expect(groupLeadQueue([sentLead], NOW).waiting).toEqual([sentLead]);
  });

  test("puts terminal leads in completed", () => {
    const terminalLeads = ["confirmed", "published", "nurture"] as const;

    expect(groupLeadQueue(terminalLeads.map((pipeline_stage) => queueLead({ id: pipeline_stage, pipeline_stage })), NOW).completed)
      .toHaveLength(terminalLeads.length);
  });
});

describe("campaign communicator readiness", () => {
  test("accepts a lead that satisfies every Ready requirement", () => {
    expect(getLeadReadyBlockers(readyLead())).toEqual([]);
  });

  test("reports every missing Ready requirement with stable identifiers", () => {
    expect(getLeadReadyBlockers(readyLead({
      contact_route: null,
      contact_route_verified_at: null,
      exact_edit_track_id: null,
      musical_fit: null,
      pitch_angle: null,
      recommending_person: "Mia",
      introduction_available: null,
      approved_draft_id: null,
      has_open_task: false,
      readiness_task_waiver_reason: null,
    }))).toEqual([
      "contact_route",
      "contact_route_verified_at",
      "exact_edit_or_update",
      "musical_fit",
      "pitch_angle_or_batch",
      "introduction_state",
      "approved_draft",
      "task_or_reason",
    ]);
  });

  test("does not require a recommender state when no recommender is recorded", () => {
    expect(getLeadReadyBlockers(readyLead({ recommending_person: null, introduction_available: null }))).not.toContain("introduction_state");
  });

  test("does not make a draft approve itself", () => {
    const lead = readyLead({ approved_draft_id: null });

    expect(getLeadReadyBlockers(lead)).toContain("approved_draft");
    expect(getDraftApprovalBlockers(lead)).not.toContain("approved_draft");
  });
});

describe("campaign communicator draft context", () => {
  test("includes only accepted suggestions with usable citation evidence", () => {
    const accepted = {
      id: "accepted",
      status: "accepted",
      suggested_value: { musical_fit: "Strong fit" },
      evidence: [{
        title: "Target programming page",
        url: "https://example.com/programming",
        retrieved_at: "2026-08-04T10:00:00.000Z",
        citation_text: "The target programmes atmospheric electronic music.",
      }],
    };
    const rejected = {
      id: "rejected",
      status: "rejected",
      suggested_value: { contact_route: "not-used@example.com" },
      evidence: accepted.evidence,
    };
    const uncitedAccepted = {
      id: "uncited-accepted",
      status: "accepted",
      suggested_value: { contact_route: "unverified@example.com" },
      evidence: [],
    };

    expect(buildAcceptedDraftContext({ campaign_name: "Fountain", suggestions: [accepted, rejected, uncitedAccepted] }).suggestions).toEqual([accepted]);
  });
});

describe("campaign communicator route payloads", () => {
  test("accepts only the explicit mutation inputs", () => {
    expect(decideSuggestionSchema.parse({ decision: "accepted", expected_lead_updated_at: "2026-08-04T10:00:00.000Z" }).decision).toBe("accepted");
    expect(generateDraftSchema.parse({ campaign_id: "campaign-1" }).instruction).toBeNull();
    expect(recordSentSchema.parse({
      campaign_id: "campaign-1",
      approved_draft_id: "draft-1",
      channel: "email",
      sent_at: "2026-08-04T10:00:00.000Z",
    }).destination).toBeNull();
    expect(overrideLeadStageSchema.parse({
      campaign_id: "campaign-1",
      pipeline_stage: "nurture",
      reason: "Target requested no further pitches.",
    }).pipeline_stage).toBe("nurture");
  });

  test("rejects unrecognised route payload fields", () => {
    expect(() => recordSentSchema.parse({
      campaign_id: "campaign-1",
      approved_draft_id: "draft-1",
      channel: "email",
      sent_at: "2026-08-04T10:00:00.000Z",
      pipeline_stage: "sent",
    })).toThrow();
  });

  test("accepts a canonical document or legacy body for manual radio drafts", () => {
    expect(manualRadioUpdateDraftSchema.parse({
      page_revision_id: "revision-1",
      subject: "Fountain Edits",
      body_document: doc("Listen here"),
    })).toMatchObject({ body_document: doc("Listen here") });

    expect(manualRadioUpdateDraftSchema.parse({
      page_revision_id: "revision-1",
      subject: "Fountain Edits",
      body: "Listen here",
    })).toMatchObject({ body: "Listen here" });
  });
});

test("suggests a follow-up fourteen days after a recorded send", () => {
  expect(calculateSuggestedFollowUp(new Date("2026-08-04T10:00:00Z")).toISOString()).toBe("2026-08-18T10:00:00.000Z");
});
