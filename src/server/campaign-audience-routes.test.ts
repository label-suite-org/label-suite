import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "./errors";

const audienceService = vi.hoisted(() => ({
  listCampaignAudiences: vi.fn(),
  listCampaignAudienceContactOptions: vi.fn(),
  listCampaignAudienceStationOptions: vi.fn(),
  previewCampaignAudience: vi.fn(),
  getCampaignAudienceForCampaign: vi.fn(),
  createCampaignAudience: vi.fn(),
  attachCampaignAudience: vi.fn(),
  detachCampaignAudience: vi.fn(),
}));

vi.mock("./tenant", () => ({
  requireCapability: (locals: { orgId?: string; membershipRole?: string }) => {
    if (locals.membershipRole === "owner" || locals.membershipRole === "operator") {
      return locals.orgId ?? "org-1";
    }
    throw new HttpError("Insufficient permissions", 403);
  },
}));

vi.mock("./campaign-audiences", () => ({
  ...audienceService,
  createCampaignAudienceSchema: z.object({
    name: z.string(),
    description: z.string().nullable().optional(),
    contact_member_ids: z.array(z.string()).default([]),
    station_member_ids: z.array(z.string()).default([]),
    membership_rules: z.object({
      include_contact_roles: z.array(z.string()).default([]),
      exclude_contact_roles: z.array(z.string()).default([]),
      require_contact_email: z.boolean().default(true),
      exclude_contact_ids: z.array(z.string()).default([]),
      include_station_states: z.array(z.string()).default([]),
      exclude_station_states: z.array(z.string()).default([]),
      require_station_email: z.boolean().default(true),
      exclude_station_ids: z.array(z.string()).default([]),
    }),
  }),
  attachCampaignAudienceSchema: z.object({
    audience_id: z.string(),
  }),
}));

function request(path: string, method: string, body?: unknown) {
  return new Request(`https://labels.example${path}`, {
    method,
    headers: { origin: "https://labels.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("campaign audience routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audienceService.listCampaignAudiences.mockResolvedValue([]);
    audienceService.listCampaignAudienceContactOptions.mockResolvedValue([]);
    audienceService.listCampaignAudienceStationOptions.mockResolvedValue([]);
    audienceService.previewCampaignAudience.mockResolvedValue({
      audience_id: "audience-1",
      audience_name: "North",
      audience_description: null,
      counts: {
        included_contacts: 0,
        excluded_contacts: 0,
        included_stations: 0,
        excluded_stations: 0,
        explicit_contact_members: 0,
        explicit_station_members: 0,
      },
      included_contacts: [],
      excluded_contacts: [],
      included_stations: [],
      excluded_stations: [],
    });
    audienceService.getCampaignAudienceForCampaign.mockResolvedValue(null);
    audienceService.createCampaignAudience.mockResolvedValue({ id: "audience-1", ok: true });
    audienceService.attachCampaignAudience.mockResolvedValue({ ok: true });
    audienceService.detachCampaignAudience.mockResolvedValue({ ok: true });
  });

  it("denies read-only members access to audience option lists", async () => {
    const { GET } = await import("../pages/api/campaign-audiences");
    const response = await GET({ locals: { orgId: "org-1", membershipRole: "member" } } as never);

    expect(response.status).toBe(403);
    expect(audienceService.listCampaignAudiences).not.toHaveBeenCalled();
  });

  it("allows operators to load audience option lists", async () => {
    const { GET } = await import("../pages/api/campaign-audiences");
    const response = await GET({ locals: { orgId: "org-1", membershipRole: "operator" } } as never);

    expect(response.status).toBe(200);
    expect(audienceService.listCampaignAudiences).toHaveBeenCalledWith("org-1");
    expect(audienceService.listCampaignAudienceContactOptions).toHaveBeenCalledWith("org-1");
    expect(audienceService.listCampaignAudienceStationOptions).toHaveBeenCalledWith("org-1");
  });

  it("denies read-only members access to audience previews", async () => {
    const { GET } = await import("../pages/api/campaign-audiences/[id]");
    const response = await GET({ params: { id: "audience-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);

    expect(response.status).toBe(403);
    expect(audienceService.previewCampaignAudience).not.toHaveBeenCalled();
  });

  it("denies read-only members access to campaign audience previews", async () => {
    const { GET } = await import("../pages/api/campaigns/[id]/audience");
    const response = await GET({ params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);

    expect(response.status).toBe(403);
    expect(audienceService.getCampaignAudienceForCampaign).not.toHaveBeenCalled();
  });

  it("allows operators to create a campaign audience", async () => {
    const { POST } = await import("../pages/api/campaign-audiences");

    const response = await POST({
      request: request("/api/campaign-audiences", "POST", {
        name: "Regional",
        description: "Scoped",
        contact_member_ids: ["contact-a"],
        station_member_ids: [],
        membership_rules: {
          include_contact_roles: ["presenter"],
          exclude_contact_roles: [],
          require_contact_email: true,
          exclude_contact_ids: [],
          include_station_states: ["NY"],
          exclude_station_states: [],
          require_station_email: true,
          exclude_station_ids: [],
        },
      }),
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(201);
    expect(audienceService.createCampaignAudience).toHaveBeenCalledWith("org-1", {
      name: "Regional",
      description: "Scoped",
      contact_member_ids: ["contact-a"],
      station_member_ids: [],
      membership_rules: {
        include_contact_roles: ["presenter"],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: ["NY"],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      },
    });
  });

  it("denies read-only members access to audience create", async () => {
    const { POST } = await import("../pages/api/campaign-audiences");
    const response = await POST({
      request: request("/api/campaign-audiences", "POST", { name: "Regional", membership_rules: {} }),
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);

    expect(response.status).toBe(403);
    expect(audienceService.createCampaignAudience).not.toHaveBeenCalled();
  });

  it("allows operators to attach and detach campaign audience links", async () => {
    const attachRoute = await import("../pages/api/campaigns/[id]/audience");
    const attachResponse = await attachRoute.POST({
      request: request("/api/campaigns/campaign-1/audience", "POST", { audience_id: "audience-1" }),
      locals: { orgId: "org-1", membershipRole: "operator" },
      params: { id: "campaign-1" },
    } as never);

    expect(attachResponse.status).toBe(200);
    expect(audienceService.attachCampaignAudience).toHaveBeenCalledWith("org-1", "campaign-1", { audience_id: "audience-1" });

    const detachResponse = await attachRoute.DELETE({
      locals: { orgId: "org-1", membershipRole: "operator" },
      params: { id: "campaign-1" },
    } as never);
    expect(detachResponse.status).toBe(200);
    expect(audienceService.detachCampaignAudience).toHaveBeenCalledWith("org-1", "campaign-1");
  });

  it("denies read-only members from campaign audience attachment lifecycle", async () => {
    const attachRoute = await import("../pages/api/campaigns/[id]/audience");

    const attachResponse = await attachRoute.POST({
      request: request("/api/campaigns/campaign-1/audience", "POST", { audience_id: "audience-1" }),
      locals: { orgId: "org-1", membershipRole: "member" },
      params: { id: "campaign-1" },
    } as never);
    expect(attachResponse.status).toBe(403);
    expect(audienceService.attachCampaignAudience).not.toHaveBeenCalled();

    const detachResponse = await attachRoute.DELETE({
      locals: { orgId: "org-1", membershipRole: "member" },
      params: { id: "campaign-1" },
    } as never);
    expect(detachResponse.status).toBe(403);
    expect(audienceService.detachCampaignAudience).not.toHaveBeenCalled();
  });

  it("allows operators to inspect campaign audience link state", async () => {
    audienceService.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Regional",
        audience_description: null,
        counts: {
          included_contacts: 0,
          excluded_contacts: 0,
          included_stations: 0,
          excluded_stations: 0,
          explicit_contact_members: 0,
          explicit_station_members: 0,
        },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [],
        excluded_stations: [],
      },
    });
    const { GET } = await import("../pages/api/campaigns/[id]/audience");

    const response = await GET({ params: { id: "campaign-1" }, locals: { orgId: "org-1", membershipRole: "operator" } } as never);

    expect(response.status).toBe(200);
    expect(audienceService.getCampaignAudienceForCampaign).toHaveBeenCalledWith("org-1", "campaign-1");
  });
});
