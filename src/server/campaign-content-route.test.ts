import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "./errors";

const campaignContent = vi.hoisted(() => ({
  getCampaignContentContext: vi.fn(),
  previewCampaignTemplateContent: vi.fn(),
  reviewCampaignTemplateForCampaign: vi.fn(),
  saveCampaignContentTemplate: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireCapability: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole === "owner" || locals.membershipRole === "operator") {
      return locals.orgId ?? "org-1";
    }
    throw new HttpError("Insufficient permissions", 403);
  },
}));

const campaignContentPayloadSchema = z.object({
  release_id: z.string().nullable().optional(),
  artist_id: z.string().nullable().optional(),
  document_ids: z.array(z.string()).default([]),
  media_asset_ids: z.array(z.string()).default([]),
}).strict();

vi.mock("./campaign-content", () => ({
  ...campaignContent,
  saveCampaignContentPayloadSchema: z.object({
    template_id: z.string().nullable().optional(),
    source_references: campaignContentPayloadSchema.optional(),
  }),
  reviewCampaignTemplatePayloadSchema: z.object({
    template_id: z.string().nullable().optional(),
    source_references: campaignContentPayloadSchema.optional(),
  }),
  previewCampaignContentPayloadSchema: z.object({
    template_id: z.string().nullable().optional(),
    source_references: campaignContentPayloadSchema.optional(),
    operator_id: z.string().nullable().optional(),
  }),
}));

describe("campaign content routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignContent.getCampaignContentContext.mockResolvedValue({
      campaign: {
        id: "campaign-1",
        campaign_name: "North Drop",
        linked_release_id: "release-1",
        linked_artist_id: "artist-1",
        release_title: null,
        release_status: null,
        artist_name: "North Artist",
        campaign_audience_id: "audience-1",
        campaign_audience_name: "Press",
      },
      templates: [],
      selection: null,
      source_options: { documents: [], media_assets: [] },
    });
    campaignContent.previewCampaignTemplateContent.mockResolvedValue({
      can_send: false,
      status: "no-send",
      campaign_id: "campaign-1",
      template_id: "template-1",
      preview_subject: "North Press",
      preview_body: "Now pitching North",
      blockers: [],
      provenance: {
        campaign: {
          id: "campaign-1",
          name: "North Drop",
          linked_release_id: "release-1",
          linked_artist_id: "artist-1",
          linked_audience_id: "audience-1",
        },
        operator: {
          id: "user-1",
        },
        provider: "brevo",
        recipient: {
          audience_id: "audience-1",
          audience_name: "Press",
          source_references: {
            release_id: "release-1",
            artist_id: "artist-1",
            document_ids: ["doc-1"],
            media_asset_ids: ["media-1"],
          },
        },
      },
      template_version: 2,
      reviewed_version: 2,
    });
    campaignContent.saveCampaignContentTemplate.mockResolvedValue({ ok: true });
    campaignContent.reviewCampaignTemplateForCampaign.mockResolvedValue({ ok: true });
  });

  it("denies campaign content operations to read-only members", async () => {
    const { GET, POST, PUT } = await import("../pages/api/campaigns/[id]/content");

    const responseGet = await GET({
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(responseGet.status).toBe(403);
    expect(campaignContent.getCampaignContentContext).not.toHaveBeenCalled();

    const postRequest = new Request("https://labels.example/api/campaigns/campaign-1/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const responsePost = await POST({
      request: postRequest,
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(responsePost.status).toBe(403);
    expect(campaignContent.previewCampaignTemplateContent).not.toHaveBeenCalled();

    const putRequest = new Request("https://labels.example/api/campaigns/campaign-1/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const responsePut = await PUT({
      request: putRequest,
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(responsePut.status).toBe(403);
    expect(campaignContent.saveCampaignContentTemplate).not.toHaveBeenCalled();
  });

  it("loads campaign content context through GET", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/content");

    const response = await GET({ params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator" } } as never);

    expect(response.status).toBe(200);
    expect(campaignContent.getCampaignContentContext).toHaveBeenCalledWith("org-1", "campaign-1");
    await expect(response.json()).resolves.toMatchObject({
      campaign: { id: "campaign-1", campaign_name: "North Drop" },
      selection: null,
    });
  });

  it("generates a no-send preview through POST", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/content");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_id: "template-1",
        operator_id: "spoofed-user",
        source_references: { document_ids: ["doc-1"], media_asset_ids: ["media-1"] },
      }),
    });

    const response = await POST({
      request,
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "operator", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(200);
    const [, , previewPayload] = campaignContent.previewCampaignTemplateContent.mock.calls[0] ?? [];
    expect(previewPayload).toMatchObject({
      template_id: "template-1",
      operator_id: "user-1",
      source_references: {
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      can_send: false,
      status: "no-send",
      provenance: { campaign: { id: "campaign-1", name: "North Drop" } },
    });
  });

  it("reviews a selected template through POST action=review", async () => {
    const { POST } = await import("../pages/api/campaigns/[id]/content");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "review",
        template_id: "template-1",
        source_references: { document_ids: ["doc-1"], media_asset_ids: ["media-1"] },
      }),
    });

    const response = await POST({
      request,
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "operator", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(200);
    expect(campaignContent.reviewCampaignTemplateForCampaign).toHaveBeenCalledWith(
      "org-1",
      "campaign-1",
      expect.objectContaining({
        action: "review",
        template_id: "template-1",
        source_references: {
          document_ids: ["doc-1"],
          media_asset_ids: ["media-1"],
        },
      }),
      "user-1",
    );
  });

  it("persists reviewed template choices through PUT", async () => {
    const { PUT } = await import("../pages/api/campaigns/[id]/content");
    const request = new Request("https://labels.example/api/campaigns/campaign-1/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template_id: "template-1" }),
    });

    const response = await PUT({
      request,
      params: { id: "campaign-1" },
      locals: { orgId: "org-1", membershipRole: "operator", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(200);
    expect(campaignContent.saveCampaignContentTemplate).toHaveBeenCalledWith("org-1", "campaign-1", { template_id: "template-1" }, "user-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
