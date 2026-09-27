import { describe, expect, test } from "vitest";
import {
  buildCampaignLeadDedupeKey,
  campaignLeadScoresSchema,
  createCampaignDogfoodEntrySchema,
  scoreCampaignLeadPriority,
  updateCampaignDogfoodEntrySchema,
  updateCampaignLeadSchema,
} from "./campaign-outreach-core";

describe("campaign earned-media priority", () => {
  test("adds the agreed four dimensions to a transparent 0–10 score", () => {
    expect(scoreCampaignLeadPriority({
      relationship_warmth: 3,
      editorial_fit: 3,
      useful_reach: 2,
      direct_free_access: 2,
    })).toBe(10);
  });

  test("rejects values outside the dimension bounds", () => {
    expect(() => campaignLeadScoresSchema.parse({
      relationship_warmth: 4,
      editorial_fit: 3,
      useful_reach: 2,
      direct_free_access: 2,
    })).toThrow();
  });
});

describe("campaign lead dedupe", () => {
  test("prefers canonical station IDs over names and URLs", () => {
    expect(buildCampaignLeadDedupeKey({
      station_id: "station-123",
      target_url: "https://example.com/submissions",
      target_name: "Example FM",
    })).toBe("station:station-123");
  });

  test("normalizes equivalent channel URLs", () => {
    const first = buildCampaignLeadDedupeKey({ target_name: "Do Funkk", target_url: "https://YOUTUBE.com/@DoFunkk/" });
    const second = buildCampaignLeadDedupeKey({ target_name: "Different name", target_url: "https://youtube.com/@DoFunkk" });
    expect(first).toBe(second);
  });

  test("falls back to a normalized name until a canonical route is confirmed", () => {
    expect(buildCampaignLeadDedupeKey({ target_name: "  Some   Uncertain Sir  " })).toBe("name:some uncertain sir");
  });
});

describe("campaign lead updates", () => {
  test("accepts one bounded inline update without a stage mutation", () => {
    expect(updateCampaignLeadSchema.parse({
      id: "lead-1",
      campaign_id: "campaign-1",
      editorial_fit: 3,
    })).toMatchObject({ editorial_fit: 3 });
  });

  test("rejects browser-facing pipeline stage updates", () => {
    expect(() => updateCampaignLeadSchema.parse({
      id: "lead-1",
      campaign_id: "campaign-1",
      pipeline_stage: "ready",
    })).toThrow();
  });

  test("keeps introduction availability explicitly unknown when it has not been confirmed", () => {
    expect(updateCampaignLeadSchema.parse({
      id: "lead-1",
      campaign_id: "campaign-1",
      introduction_available: null,
    }).introduction_available).toBeNull();
  });

  test("rejects empty updates", () => {
    expect(() => updateCampaignLeadSchema.parse({ id: "lead-1", campaign_id: "campaign-1" })).toThrow();
  });
});

describe("campaign dogfood links", () => {
  test("accepts nullable focused-workflow links without persistence lookups", () => {
    expect(createCampaignDogfoodEntrySchema.parse({
      campaign_id: "campaign-1",
      entry_type: "friction",
      title: "Approval flow needs a clearer task link",
      linked_lead_id: "lead-1",
      linked_draft_id: null,
      linked_enrichment_run_id: "run-1",
    })).toMatchObject({ linked_lead_id: "lead-1", linked_draft_id: null, linked_enrichment_run_id: "run-1" });

    expect(updateCampaignDogfoodEntrySchema.parse({
      id: "dogfood-1",
      campaign_id: "campaign-1",
      linked_lead_id: null,
    }).linked_lead_id).toBeNull();
  });
});
