import { beforeEach, describe, expect, it, vi } from "vitest";

const content = vi.hoisted(() => ({ getCampaignContentContext: vi.fn(), saveCampaignContentTemplate: vi.fn() }));
const audience = vi.hoisted(() => ({
  attachCampaignAudience: vi.fn(), detachCampaignAudience: vi.fn(), getCampaignAudienceForCampaign: vi.fn(), listCampaignAudiences: vi.fn(),
}));

vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("./campaign-content", () => content);
vi.mock("./campaign-audiences", () => audience);

import { mutateNativeCampaignSections, projectNativeRichDocument } from "./campaign-sections";

describe("native rich-document projection", () => {
  it("does not expose malformed or oversized documents as editable JSON", () => {
    expect(projectNativeRichDocument({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20_001) }] }] })).toEqual({
      available: false,
      read_only: true,
      reason: "invalid_or_oversized_document",
    });
    expect(projectNativeRichDocument({ type: "unsupported", payload: "legacy" })).toEqual({
      available: false,
      read_only: true,
      reason: "invalid_or_oversized_document",
    });
  });
});

describe("native campaign section mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    content.saveCampaignContentTemplate.mockResolvedValue({ ok: true, revision: 5 });
    audience.attachCampaignAudience.mockResolvedValue({ ok: true, revision: 5 });
    audience.detachCampaignAudience.mockResolvedValue({ ok: true, revision: 5 });
  });

  it("uses canonical writers with CAS and an audit record while declaring no-send consequences", async () => {
    const response = await mutateNativeCampaignSections("org-a", "campaign-a", {
      action: "select_template", template_id: "template-a", expected_revision: 4,
    }, "user-a");

    expect(content.saveCampaignContentTemplate).toHaveBeenCalledWith("org-a", "campaign-a", { template_id: "template-a" }, "user-a", {
      expectedRevision: 4,
      audit: expect.objectContaining({ actorUserId: "user-a", eventType: "campaign.sections.select_template", metadata: { action: "select_template", no_send: true } }),
    });
    expect(response).toMatchObject({ campaign: { revision: 5 }, consequences: { can_send: false, send_performed: false, channel_changes: "none" } });
  });

  it("limits mutations to existing audience attach or detach", async () => {
    await mutateNativeCampaignSections("org-a", "campaign-a", { action: "attach_audience", audience_id: "audience-a", expected_revision: 4 }, "user-a");
    expect(audience.attachCampaignAudience).toHaveBeenCalledWith("org-a", "campaign-a", { audience_id: "audience-a" }, expect.objectContaining({ expectedRevision: 4 }));

    await mutateNativeCampaignSections("org-a", "campaign-a", { action: "detach_audience", expected_revision: 4 }, "user-a");
    expect(audience.detachCampaignAudience).toHaveBeenCalledWith("org-a", "campaign-a", expect.objectContaining({ expectedRevision: 4 }));
  });
});
