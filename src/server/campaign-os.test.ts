import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));
import {
  createCampaignEngagementSchema,
  createCampaignPostSchema,
  setCampaignTerritoriesSchema,
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
    })).toMatchObject({ outreach_permission_status: "permitted" });
  });

  it("accepts only valid ISO country codes and manual post URLs", () => {
    expect(setCampaignTerritoriesSchema.parse({ country_codes: ["DK", "DE"] }).country_codes).toEqual(["DK", "DE"]);
    expect(() => setCampaignTerritoriesSchema.parse({ country_codes: ["Denmark"] })).toThrow("two-letter ISO");
    expect(createCampaignPostSchema.parse({ url: "https://example.test/post", platform: "TikTok", manual_metrics: { views: 120 } })).toMatchObject({ platform: "TikTok" });
    expect(createCampaignPostSchema.parse({ url: "http://example.test/post", platform: "TikTok" })).toMatchObject({ platform: "TikTok" });
    expect(() => createCampaignPostSchema.parse({ url: "javascript:alert(1)", platform: "TikTok" })).toThrow();
    expect(() => createCampaignPostSchema.parse({ url: "data:text/html,hello", platform: "TikTok" })).toThrow();
  });
});
