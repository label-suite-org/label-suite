import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));
import {
  createCampaignEngagementSchema,
  createCampaignDeliverableSchema,
  createCampaignPostSchema,
  setCampaignTerritoriesSchema,
  updateCampaignEngagementSchema,
  updateCampaignDeliverableSchema,
} from "./campaign-os";

describe("Campaign OS input contract", () => {
  it("requires an explicit basis before a Creator Engagement permits outreach", () => {
    expect(() => createCampaignEngagementSchema.parse({
      contact_id: "contact-1",
      outreach_permission_status: "permitted",
    })).toThrow("Permission basis is required");
  });

  it("accepts a documented campaign-specific Outreach Permission", () => {
    expect(createCampaignEngagementSchema.parse({
      contact_id: "contact-1",
      outreach_channel: "email",
      outreach_permission_status: "permitted",
      outreach_permission_basis: "Creator opted in during a direct conversation",
      outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z",
    })).toMatchObject({ outreach_permission_status: "permitted" });
  });

  it("does not add status, channel, or permission defaults to a notes-only update", () => {
    expect(updateCampaignEngagementSchema.parse({ id: "engagement-1", relationship_notes: "Follow up next week" })).toEqual({ id: "engagement-1", relationship_notes: "Follow up next week" });
  });

  it("requires recorded permission before creating a contacted engagement", () => {
    expect(() => createCampaignEngagementSchema.parse({ contact_id: "contact-1", status: "contacted" })).toThrow("Recorded outreach permission is required before contact");
    expect(() => createCampaignEngagementSchema.parse({ contact_id: "contact-1", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in" })).toThrow("Permission recorded time is required");
    expect(() => createCampaignEngagementSchema.parse({ contact_id: "contact-1", outreach_permission_status: "revoked" })).toThrow("Revocation time is required");
  });

  it("accepts only valid ISO country codes and manual post URLs", () => {
    expect(setCampaignTerritoriesSchema.parse({ country_codes: ["DK", "DE", "TW"] }).country_codes).toEqual(["DK", "DE", "TW"]);
    expect(() => setCampaignTerritoriesSchema.parse({ country_codes: ["Denmark"] })).toThrow("two-letter ISO");
    expect(() => setCampaignTerritoriesSchema.parse({ country_codes: ["ZZ"] })).toThrow("two-letter ISO");
    expect(() => setCampaignTerritoriesSchema.parse({ country_codes: ["EU"] })).toThrow("two-letter ISO");
    expect(createCampaignPostSchema.parse({ url: "https://example.test/post", platform: "TikTok", manual_metrics: { views: 120 } })).toMatchObject({ platform: "TikTok" });
    expect(createCampaignPostSchema.parse({ url: "http://example.test/post", platform: "TikTok" })).toMatchObject({ platform: "TikTok" });
    expect(() => createCampaignPostSchema.parse({ url: "javascript:alert(1)", platform: "TikTok" })).toThrow();
    expect(() => createCampaignPostSchema.parse({ url: "data:text/html,hello", platform: "TikTok" })).toThrow();
  });

  it("keeps deliverable updates partial and evidence links on the web", () => {
    expect(updateCampaignDeliverableSchema.parse({ id: "deliverable-1", expected_updated_at: null, notes: "Reviewed" })).toEqual({ id: "deliverable-1", expected_updated_at: null, notes: "Reviewed" });
    expect(createCampaignDeliverableSchema.parse({ engagement_id: "engagement-1", description: "Video", evidence_url: "https://example.test/evidence" })).toMatchObject({ approval_status: "pending", evidence_url: "https://example.test/evidence" });
    for (const evidence_url of ["javascript:alert(1)", "data:text/html,hello", "ftp://example.test/evidence"]) {
      expect(() => createCampaignDeliverableSchema.parse({ engagement_id: "engagement-1", description: "Video", evidence_url })).toThrow();
      expect(() => updateCampaignDeliverableSchema.parse({ id: "deliverable-1", expected_updated_at: null, evidence_url })).toThrow();
    }
  });
});
