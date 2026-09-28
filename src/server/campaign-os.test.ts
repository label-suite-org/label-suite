import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));
import {
  createCampaignEngagementSchema,
  createCampaignPostSchema,
  setCampaignTerritoriesSchema,
  updateCampaignEngagementSchema,
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
  });

  it("accepts only valid ISO country codes and manual post URLs", () => {
    expect(setCampaignTerritoriesSchema.parse({ country_codes: ["DK", "DE"] }).country_codes).toEqual(["DK", "DE"]);
    expect(() => setCampaignTerritoriesSchema.parse({ country_codes: ["Denmark"] })).toThrow("two-letter ISO");
    expect(createCampaignPostSchema.parse({ url: "https://example.test/post", platform: "TikTok", manual_metrics: { views: 120 } })).toMatchObject({ platform: "TikTok" });
  });
});
