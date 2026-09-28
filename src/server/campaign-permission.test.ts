import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const database = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
vi.mock("../lib/db", () => ({ db: database }));
import { updateCampaignEngagement, updateCampaignEngagementSchema } from "./campaign-os";

const orgId = "org-1";
const campaignId = "campaign-1";

describe("Creator Engagement permission updates", () => {
  let current: Record<string, unknown>;
  let saved: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    saved = null;
    current = { id: "engagement-1", contact_id: "contact-1", status: "identified", outreach_channel: "email", outreach_permission_status: "unknown", outreach_permission_basis: null, outreach_permission_recorded_at: null, outreach_permission_revoked_at: null };
    database.select.mockImplementation(() => ({ from: () => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
      limit: async () => new PgDialect().sqlToQuery(condition).params.includes(orgId) ? [current] : [],
    }) }) }));
    database.update.mockImplementation(() => ({ set: (values: Record<string, unknown>) => ({ where: async () => { saved = values; } }) }));
  });

  it("changes notes without resetting status, channel, or permission", async () => {
    const input = updateCampaignEngagementSchema.parse({ id: "engagement-1", relationship_notes: "Follow up later" });
    await updateCampaignEngagement(orgId, campaignId, input);
    expect(saved).toMatchObject({ relationship_notes: "Follow up later" });
    expect(saved).not.toHaveProperty("status");
    expect(saved).not.toHaveProperty("outreach_channel");
    expect(saved).not.toHaveProperty("outreach_permission_status");
  });

  it("still allows notes on a legacy permission record missing evidence", async () => {
    current = { ...current, status: "contacted", outreach_permission_status: "permitted" };
    await updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", relationship_notes: "Request documentation" }));
    expect(saved).toMatchObject({ relationship_notes: "Request documentation" });
    expect(saved).not.toHaveProperty("outreach_permission_status");
  });

  it("blocks moving into a contact state without recorded permission", async () => {
    const input = updateCampaignEngagementSchema.parse({ id: "engagement-1", status: "contacted" });
    await expect(updateCampaignEngagement(orgId, campaignId, input)).rejects.toMatchObject({ status: 409 });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("allows a contact transition with a recorded basis and time", async () => {
    const input = updateCampaignEngagementSchema.parse({ id: "engagement-1", status: "contacted", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z" });
    await updateCampaignEngagement(orgId, campaignId, input);
    expect(saved).toMatchObject({ status: "contacted", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") });
  });

  it.each([{ contact_id: "contact-2" }, { outreach_channel: "DM" }])("does not carry permission to a changed Contact or channel: %j", async (change) => {
    current = { ...current, outreach_permission_status: "permitted", outreach_permission_basis: "Original opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") };
    await expect(updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", ...change }))).rejects.toMatchObject({ status: 409 });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("allows correcting a Contact while permission is still unknown", async () => {
    await updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", contact_id: "contact-2" }));
    expect(saved).toMatchObject({ contact_id: "contact-2" });
    expect(saved).not.toHaveProperty("outreach_permission_status");
  });

  it("blocks moving an already contacted engagement to another channel with unknown permission", async () => {
    current = { ...current, status: "contacted", outreach_permission_status: "permitted", outreach_permission_basis: "Email opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") };
    await expect(updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", outreach_channel: "DM", outreach_permission_status: "unknown" }))).rejects.toMatchObject({ status: 409 });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("accepts a channel change with explicit fresh permission evidence", async () => {
    current = { ...current, outreach_permission_status: "permitted", outreach_permission_basis: "Original email opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") };
    await updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", outreach_channel: "DM", outreach_permission_status: "permitted", outreach_permission_basis: "Direct DM opt-in", outreach_permission_recorded_at: "2026-09-28T11:00:00.000Z" }));
    expect(saved).toMatchObject({ outreach_channel: "DM", outreach_permission_basis: "Direct DM opt-in", outreach_permission_recorded_at: new Date("2026-09-28T11:00:00.000Z") });
  });

  it("records revocation after earlier contact without resetting historical status", async () => {
    current = { ...current, status: "contacted", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") };
    const input = updateCampaignEngagementSchema.parse({ id: "engagement-1", outreach_permission_status: "revoked", outreach_permission_revoked_at: "2026-09-28T12:00:00.000Z" });
    await updateCampaignEngagement(orgId, campaignId, input);
    expect(saved).toMatchObject({ outreach_permission_status: "revoked", outreach_permission_revoked_at: new Date("2026-09-28T12:00:00.000Z") });
    expect(saved).not.toHaveProperty("status");
  });

  it("requires a time when permission is newly revoked", async () => {
    current = { ...current, outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: new Date("2026-09-28T10:00:00.000Z") };
    await expect(updateCampaignEngagement(orgId, campaignId, updateCampaignEngagementSchema.parse({ id: "engagement-1", outreach_permission_status: "revoked" }))).rejects.toMatchObject({ status: 409 });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("does not update an engagement in another organisation", async () => {
    const input = updateCampaignEngagementSchema.parse({ id: "engagement-1", relationship_notes: "Wrong workspace" });
    await expect(updateCampaignEngagement("other-org", campaignId, input)).rejects.toMatchObject({ status: 404 });
    expect(database.update).not.toHaveBeenCalled();
  });
});
