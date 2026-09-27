import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const delivery = vi.hoisted(() => ({
  getCampaignEmailProvider: vi.fn(() => ({ id: "brevo" as const })),
  sendEmailThroughCampaignProvider: vi.fn(),
}));

const audiences = vi.hoisted(() => ({
  getCampaignAudienceForCampaign: vi.fn(),
}));

const tenant = vi.hoisted(() => ({
  requireCapability: vi.fn(() => "org-1"),
}));

const publicPage = vi.hoisted(() => ({
  isCampaignPublicPageRevisionFresh: vi.fn(async () => true),
}));

const dbState = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("./email", () => delivery);
vi.mock("./campaign-audiences", () => audiences);
vi.mock("./tenant", () => tenant);
vi.mock("./campaign-public-page", () => publicPage);
vi.mock("../lib/db", () => dbState);

function mockSelectOnce(rows: unknown[]) {
  dbState.db.select.mockReturnValueOnce(mockSelectChain(rows));
}

function mockSelectChain(rows: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

function mockEmailLogInsert() {
  const values = vi.fn().mockResolvedValue([]);
  dbState.db.insert.mockReturnValueOnce({
    values,
  });
  return values;
}

function mockCampaignStationInsert() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({
    onConflictDoUpdate,
  });
  dbState.db.insert.mockReturnValueOnce({
    values,
  });
  return { values, onConflictDoUpdate };
}

function mockCampaignContext(overrides: Record<string, unknown> = {}) {
  mockSelectOnce([{
    id: "campaign-1",
    campaign_name: "North Drop",
    linked_release_id: null,
    linked_artist_id: null,
    release_title: null,
    release_status: null,
    artist_name: null,
    campaign_audience_id: null,
    campaign_audience_name: null,
    content_provider: "brevo",
    content_operator_id: "reviewer-1",
    reviewed_template_id: null,
    content_source_version: null,
    content_source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    ...overrides,
  }]);
}

describe("campaign email send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.db.select.mockReset();
    dbState.db.select.mockImplementation(() => mockSelectChain([]));
    dbState.db.insert.mockReset();
    delivery.getCampaignEmailProvider.mockReturnValue({ id: "brevo" });
    audiences.getCampaignAudienceForCampaign.mockResolvedValue(null);
  });

  it("skips delivery when placeholder source data is blank", async () => {
    mockSelectOnce([
      {
        id: "station-1",
        email: "station@example.com",
        name: "",
        dj_name: null,
        call_sign: null,
        city: null,
      },
    ]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        subject: "Hello {{station_name}}",
        body: "Campaign update",
        sender_email: "sender@example.com",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          station_id: "station-1",
          station_name: "",
          email: "station@example.com",
          status: "skipped",
          error: "Missing template values: station_name",
        },
      ],
      total: 0,
    });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("blocks template-based send when template is unreviewed", async () => {
    mockSelectOnce([{
      id: "template-1",
      review_status: "draft",
      source_version: 1,
      current_version: 1,
      source_references: {},
    }]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        subject: "Hello",
        body: "Campaign update",
        template_id: "template-1",
        sender_email: "sender@example.com",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Template is not reviewed" });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("blocks template-based send when template is stale", async () => {
    mockSelectOnce([{
      id: "template-2",
      review_status: "reviewed",
      source_version: 1,
      current_version: 2,
      source_references: {},
    }]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        subject: "Hello",
        body: "Campaign update",
        template_id: "template-2",
        sender_email: "sender@example.com",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Template is stale and requires re-review" });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("sends reviewed source-backed placeholders using the campaign's persisted reviewed references", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Drop EP",
      release_status: "scheduled",
      artist_name: "North Artist",
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: "template-1",
      content_source_version: 2,
      content_source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    }]);
    mockSelectOnce([]);
    mockSelectOnce([{ id: "radio-draft-other-org", org_id: "org-2", campaign_id: "campaign-1", lead_id: null }]);
    mockSelectOnce([{
      id: "template-1",
      review_status: "reviewed",
      source_version: 2,
      current_version: 2,
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    }]);
    mockSelectOnce([{ title: "North Drop EP", status: "scheduled" }]);
    mockSelectOnce([{ name: "North Artist" }]);
    mockSelectOnce([{ name: "Press Kit", created_at: new Date("2026-07-01T00:00:00Z") }]);
    mockSelectOnce([{ name: "Cover Art", created_at: new Date("2026-07-02T00:00:00Z") }]);
    mockSelectOnce([{
      id: "station-1",
      email: "station@example.com",
      name: "Station One",
      dj_name: "DJ North",
      call_sign: "NTH",
      city: "Copenhagen",
    }]);
    delivery.sendEmailThroughCampaignProvider.mockResolvedValue({
      status: "sent",
      messageId: "msg-1",
    });
    const emailLogInsert = mockEmailLogInsert();
    mockCampaignStationInsert();

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        campaign_id: "campaign-1",
        template_id: "template-1",
        subject: "Press {{document_name}}",
        body: "Featuring {{media_asset_name}} for {{campaign_name}}",
        sender_email: "sender@example.com",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ station_id: "station-1", station_name: "Station One", email: "station@example.com", status: "sent", error: undefined }],
      total: 1,
    });
    expect(delivery.sendEmailThroughCampaignProvider).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Press Press Kit",
      htmlBody: "Featuring Cover Art for North Drop",
      toEmail: "station@example.com",
      toName: "DJ North",
      senderEmail: "sender@example.com",
    }));
    expect(emailLogInsert).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: "campaign-1", station_id: "station-1", status: "sent" }));
  });

  it("requires an authenticated operator before previewing or sending", async () => {
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        subject: "Hello",
        body: "Campaign update",
        preview_only: true,
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner" },
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authenticated operator required" });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("returns a no-send preview with provider and operator provenance", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Drop EP",
      release_status: "scheduled",
      artist_name: "North Artist",
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: "template-1",
      content_source_version: 2,
      content_source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    }]);
    mockSelectOnce([]);
    mockSelectOnce([]);
    mockSelectOnce([{
      id: "template-1",
      review_status: "reviewed",
      source_version: 2,
      current_version: 2,
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    }]);
    mockSelectOnce([{ title: "North Drop EP", status: "scheduled" }]);
    mockSelectOnce([{ name: "North Artist" }]);
    mockSelectOnce([{ name: "Press Kit", created_at: new Date("2026-07-01T00:00:00Z") }]);
    mockSelectOnce([{ name: "Cover Art", created_at: new Date("2026-07-02T00:00:00Z") }]);
    mockSelectOnce([{
      id: "station-1",
      email: "station@example.com",
      name: "Station One",
      dj_name: "DJ North",
      call_sign: "NTH",
      city: "Copenhagen",
    }]);
    audiences.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Nordic radio",
        audience_description: null,
        counts: {
          included_contacts: 0,
          excluded_contacts: 0,
          included_stations: 1,
          excluded_stations: 0,
          explicit_contact_members: 0,
          explicit_station_members: 1,
        },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [{ id: "station-1", name: "Station One", detail: "Copenhagen", status: "included", reason: "explicit member" }],
        excluded_stations: [],
      },
    });

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        campaign_id: "campaign-1",
        template_id: "template-1",
        subject: "Press {{document_name}}",
        body: "Featuring {{media_asset_name}} for {{campaign_name}}",
        preview_only: true,
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      can_send: false,
      status: "no-send",
      provider: "brevo",
      operator_id: "operator-1",
      campaign: {
        id: "campaign-1",
        name: "North Drop",
      },
      audience: {
        id: "audience-1",
        name: "Nordic radio",
      },
      template_id: "template-1",
      preview_subject: "Press Press Kit",
      preview_body: "Featuring Cover Art for North Drop",
      recipients: [
        {
          station_id: "station-1",
          station_name: "Station One",
          recipient_name: "DJ North",
          email: "station@example.com",
          status: "ready",
          preview_subject: "Press Press Kit",
          preview_body: "Featuring Cover Art for North Drop",
        },
      ],
      ready_count: 1,
      skipped_count: 0,
    });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("skips stations that are no longer included by the saved campaign audience", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Drop EP",
      release_status: "scheduled",
      artist_name: "North Artist",
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: "template-1",
      content_source_version: 2,
      content_source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: [],
        media_asset_ids: [],
      },
    }]);
    mockSelectOnce([]);
    mockSelectOnce([]);
    mockSelectOnce([{
      id: "template-1",
      review_status: "reviewed",
      source_version: 2,
      current_version: 2,
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: [],
        media_asset_ids: [],
      },
    }]);
    mockSelectOnce([{ title: "North Drop EP", status: "scheduled" }]);
    mockSelectOnce([{ name: "North Artist" }]);
    mockSelectOnce([{
      id: "station-2",
      email: "skip@example.com",
      name: "Skip Station",
      dj_name: "DJ Skip",
      call_sign: "SKP",
      city: "Aarhus",
    }]);
    audiences.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Nordic radio",
        audience_description: null,
        counts: {
          included_contacts: 0,
          excluded_contacts: 0,
          included_stations: 0,
          excluded_stations: 1,
          explicit_contact_members: 0,
          explicit_station_members: 0,
        },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [],
        excluded_stations: [{ id: "station-2", name: "Skip Station", detail: "Aarhus", status: "excluded", reason: "excluded by explicit exclude list" }],
      },
    });

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-2"],
        campaign_id: "campaign-1",
        template_id: "template-1",
        subject: "Hello",
        body: "Campaign update",
        preview_only: true,
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      can_send: false,
      status: "no-send",
      provider: "brevo",
      operator_id: "operator-1",
      campaign: {
        id: "campaign-1",
        name: "North Drop",
      },
      audience: {
        id: "audience-1",
        name: "Nordic radio",
      },
      template_id: "template-1",
      preview_subject: "",
      preview_body: "",
      recipients: [
        {
          station_id: "station-2",
          station_name: "Skip Station",
          recipient_name: "DJ Skip",
          email: "skip@example.com",
          status: "skipped",
          error: "excluded by explicit exclude list",
          preview_subject: "Hello",
          preview_body: "Campaign update",
        },
      ],
      ready_count: 0,
      skipped_count: 1,
    });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("blocks send when the campaign's persisted reviewed references drift from the reviewed template", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Drop EP",
      release_status: "scheduled",
      artist_name: "North Artist",
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: "template-1",
      content_source_version: 2,
      content_source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-2"],
        media_asset_ids: ["media-1"],
      },
    }]);
    mockSelectOnce([]);
    mockSelectOnce([]);
    mockSelectOnce([{
      id: "template-1",
      review_status: "reviewed",
      source_version: 2,
      current_version: 2,
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: ["media-1"],
      },
    }]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        campaign_id: "campaign-1",
        template_id: "template-1",
        subject: "Hello",
        body: "Campaign update",
        sender_email: "sender@example.com",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "user-1" } },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Campaign reviewed source references are stale and require re-save",
    });
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("rejects campaign delivery on the compliance blocker before resolving the provider", async () => {
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://labels.example",
      },
      body: JSON.stringify({
        station_ids: ["station-1"],
        campaign_id: "campaign-1",
        radio_update: true,
        subject: "Ignored client subject",
        body: "Ignored client body",
      }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Batch compliance is unavailable until suppression and unsubscribe controls are reviewed",
      code: "batch_compliance_unavailable",
    });
    expect(delivery.getCampaignEmailProvider).not.toHaveBeenCalled();
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
  });

  it.each([undefined, false])("classifies persisted radio campaigns before legacy delivery when radio_update=%s", async (radioUpdate) => {
    mockCampaignContext();
    mockSelectOnce([]);
    mockSelectOnce([{ id: "radio-draft-1", org_id: "org-1", campaign_id: "campaign-1", lead_id: null }]);
    const { POST } = await import("../pages/api/email/send");
    const payload: Record<string, unknown> = {
      station_ids: ["station-1"],
      campaign_id: "campaign-1",
      subject: "Attacker-controlled subject",
      body: "Attacker-controlled body",
    };
    if (radioUpdate !== undefined) payload.radio_update = radioUpdate;
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify(payload),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Batch compliance is unavailable until suppression and unsubscribe controls are reviewed",
      code: "batch_compliance_unavailable",
    });
    expect(delivery.getCampaignEmailProvider).not.toHaveBeenCalled();
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("requires explicit governed radio_update for persisted radio previews", async () => {
    mockCampaignContext();
    mockSelectOnce([]);
    mockSelectOnce([{ id: "radio-draft-1", org_id: "org-1", campaign_id: "campaign-1", lead_id: null }]);
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", preview_only: true, subject: "Spoof", body: "Spoof" }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "batch_compliance_unavailable" }));
    expect(delivery.getCampaignEmailProvider).not.toHaveBeenCalled();
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["page", [{ id: "page-1", org_id: "org-1", campaign_id: "campaign-1" }], []],
    ["draft", [], [{ id: "radio-draft-1", org_id: "org-1", campaign_id: "campaign-1", lead_id: null }]],
  ])("uses persisted %s state as the radio-lane discriminator", async (_kind, pageRows, draftRows) => {
    mockCampaignContext();
    mockSelectOnce(pageRows);
    if (pageRows.length === 0) mockSelectOnce(draftRows);
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: false, subject: "Spoof", body: "Spoof" }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "batch_compliance_unavailable" }));
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
    expect(dbState.db.insert).not.toHaveBeenCalled();
  });

  it("surfaces unrelated persisted-radio lane lookup failures", async () => {
    mockCampaignContext();
    dbState.db.select.mockImplementationOnce(() => { throw Object.assign(new Error("relation unrelated_table does not exist"), { code: "42P01" }); });
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", subject: "Spoof", body: "Spoof" }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(500);
    expect(delivery.sendEmailThroughCampaignProvider).not.toHaveBeenCalled();
  });

  it("keeps legacy malformed requests at the required-field 400 boundary", async () => {
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"] }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(400);
  });

  it("preserves legacy recipient order and does not deduplicate non-radio previews", async () => {
    mockSelectOnce([{ id: "station-2", email: "same@example.com", name: "Second", dj_name: null, call_sign: null, city: null }]);
    mockSelectOnce([{ id: "station-1", email: " SAME@example.com ", name: "First", dj_name: null, call_sign: null, city: null }]);
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-2", "station-1"], subject: "Hello", body: "Update", preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.recipients.map((recipient: { station_id: string; status: string }) => [recipient.station_id, recipient.status])).toEqual([["station-2", "ready"], ["station-1", "ready"]]);
  });

  it("surfaces unrelated additive-looking database failures instead of silently falling back", async () => {
    dbState.db.select.mockImplementationOnce(() => { throw Object.assign(new Error("relation unrelated_table does not exist"), { code: "42P01" }); });
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: true, preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(500);
  });

  it("surfaces an unrelated missing generic additive column instead of silently falling back", async () => {
    dbState.db.select.mockImplementationOnce(() => { throw Object.assign(new Error("column unrelated_table.content_hash does not exist"), { code: "42703" }); });
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: true, preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(500);
  });

  it("falls back when the governed draft query is missing the additive body_document column", async () => {
    mockCampaignContext();
    dbState.db.select.mockImplementationOnce(() => {
      throw Object.assign(new Error('column "campaign_outreach_drafts.body_document" does not exist'), { code: "42703" });
    });
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: true, preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reviewed_email).toBeNull();
    expect(payload.blockers).toContainEqual(expect.objectContaining({ code: "reviewed_radio_email_required" }));
  });

  it("treats malformed approved draft rows as a reviewed-email blocker instead of throwing", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: null,
      content_source_version: null,
      content_source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    mockSelectOnce([{
      id: "radio-draft-corrupt",
      version: 1,
      approval_hash: "not-used",
      subject: "Approved subject",
      body: 42,
      context_snapshot: null,
    }]);
    audiences.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Nordic radio",
        audience_description: null,
        counts: { included_contacts: 0, excluded_contacts: 0, included_stations: 1, excluded_stations: 0, explicit_contact_members: 1, explicit_station_members: 1 },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [{ id: "station-1", name: "Station One", detail: "Copenhagen", status: "included", reason: "explicit member" }],
        excluded_stations: [],
      },
    });
    mockSelectOnce([{ id: "station-1", email: "station@example.com", name: "Station One", dj_name: null, call_sign: null, city: null }]);
    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: true, preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reviewed_email).toBeNull();
    expect(payload.blockers).toContainEqual(expect.objectContaining({ code: "reviewed_radio_email_required" }));
  });

  it("rejects a mutated reviewed page content hash", async () => {
    const { isPublicPageContentHashValid } = await import("../pages/api/email/send");
    const content = { label_line: "Label", title: "Title", release_note: "Note", artwork_asset_id: "art", focus_track_ids: ["track"], listen_url: "https://example.com/listen", download_url: null, metadata_url: null, contact_name: "Name", contact_email: "name@example.com", network_statement: "Shared with our independent radio network." };
    const hash = hashPageContentForTest(content);
    expect(isPublicPageContentHashValid(content, hash)).toBe(true);
    expect(isPublicPageContentHashValid({ ...content, title: "Mutated" }, hash)).toBe(false);
  });

  it("surfaces placeholder tokens as a radio-copy blocker", async () => {
    const { hasRadioPlaceholderTokens } = await import("../pages/api/email/send");
    expect(hasRadioPlaceholderTokens("Update {{station_name}}", "Shared network copy")).toBe(true);
    expect(hasRadioPlaceholderTokens("Update", "Shared network copy")).toBe(false);
  });

  it("builds an explicit radio preview from the approved leadless draft and exact reviewed page revision", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: null,
      content_source_version: null,
      content_source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    const { hashDraftContent } = await import("./campaign-communicator");
    const draftSubject = "North Drop — radio update";
    const draftBody = "Shared with our independent radio network.\nhttps://fountain.example/page";
    const draftDocument = {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "Shared with our independent radio network.", marks: [{ type: "bold" }] },
        { type: "hardBreak" },
        { type: "text", text: "https://fountain.example/page" },
      ] }],
    };
    const pageContent = {
      label_line: "True Nature",
      title: "North Drop",
      release_note: "A reviewed radio update.",
      artwork_asset_id: "art-1",
      focus_track_ids: ["track-1"],
      listen_url: "https://fountain.example/listen",
      download_url: null,
      metadata_url: null,
      contact_name: "Malthe",
      contact_email: "malthe@example.com",
      network_statement: "Shared with our independent radio network.",
    };
    const pageContentHash = hashPageContentForTest(pageContent);
    mockSelectOnce([{
      id: "radio-draft-1",
      version: 4,
      approval_hash: hashDraftContent(draftSubject, draftDocument),
      subject: draftSubject,
      body: draftBody,
      body_document: draftDocument,
      context_snapshot: { page_revision_id: "page-revision-4", page_revision_version: 4, page_content_hash: pageContentHash },
    }]);
    mockSelectOnce([{
      id: "page-revision-4",
      version: 4,
      content_hash: pageContentHash,
      content: pageContent,
      review_status: "reviewed",
      page_id: "page-1",
      page_status: "published",
      slug: "north-drop",
      current_published_revision_id: "page-revision-4",
    }]);
    audiences.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Nordic radio",
        audience_description: null,
        counts: { included_contacts: 0, excluded_contacts: 0, included_stations: 1, excluded_stations: 0, explicit_contact_members: 1, explicit_station_members: 1 },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [{ id: "station-1", name: "Station One", detail: "Copenhagen", status: "included", reason: "explicit member" }],
        excluded_stations: [],
      },
    });
    mockSelectOnce([{
      id: "station-1",
      email: " Station@Example.com ",
      name: "Station One",
      dj_name: "DJ North",
      call_sign: "NTH",
      city: "Copenhagen",
    }]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({
        station_ids: ["station-1"],
        campaign_id: "campaign-1",
        radio_update: true,
        subject: "Client spoof",
        body: "Client spoof",
        preview_only: true,
      }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.preview_subject).toBe(draftSubject);
    expect(payload.preview_body).toBe(draftBody);
    expect(payload.reviewed_email).toMatchObject({ id: "radio-draft-1", version: 4, approval_hash: expect.any(String) });
    expect(payload.reviewed_page).toMatchObject({ id: "page-revision-4", version: 4, content_hash: pageContentHash, status: "published" });
    expect(payload.blockers).toContainEqual(expect.objectContaining({ code: "batch_compliance_unavailable" }));
    expect(payload.preview_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(delivery.getCampaignEmailProvider).not.toHaveBeenCalled();
  });

  it("blocks a POST preview when the reviewed page content is mutated after hashing", async () => {
    mockSelectOnce([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: "audience-1",
      campaign_audience_name: "Nordic radio",
      content_provider: "brevo",
      content_operator_id: "reviewer-1",
      reviewed_template_id: null,
      content_source_version: null,
      content_source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    const { hashDraftContent } = await import("./campaign-communicator");
    const draftSubject = "North Drop — radio update";
    const draftBody = "Shared with our independent radio network.";
    const pageContent = {
      label_line: "True Nature",
      title: "North Drop",
      release_note: "A reviewed radio update.",
      artwork_asset_id: "art-1",
      focus_track_ids: ["track-1"],
      listen_url: "https://fountain.example/listen",
      download_url: null,
      metadata_url: null,
      contact_name: "Malthe",
      contact_email: "malthe@example.com",
      network_statement: "Shared with our independent radio network.",
    };
    const pageContentHash = hashPageContentForTest(pageContent);
    mockSelectOnce([{
      id: "radio-draft-1",
      version: 4,
      approval_hash: hashDraftContent(draftSubject, draftBody),
      subject: draftSubject,
      body: draftBody,
      context_snapshot: { page_revision_id: "page-revision-4", page_revision_version: 4, page_content_hash: pageContentHash },
    }]);
    mockSelectOnce([{
      id: "page-revision-4",
      version: 4,
      content_hash: pageContentHash,
      content: { ...pageContent, title: "Mutated after review" },
      review_status: "reviewed",
      page_id: "page-1",
      page_status: "published",
      slug: "north-drop",
      current_published_revision_id: "page-revision-4",
    }]);
    audiences.getCampaignAudienceForCampaign.mockResolvedValue({
      campaign_audience_id: "audience-1",
      preview: {
        audience_id: "audience-1",
        audience_name: "Nordic radio",
        audience_description: null,
        counts: { included_contacts: 0, excluded_contacts: 0, included_stations: 1, excluded_stations: 0, explicit_contact_members: 1, explicit_station_members: 1 },
        included_contacts: [],
        excluded_contacts: [],
        included_stations: [{ id: "station-1", name: "Station One", detail: "Copenhagen", status: "included", reason: "explicit member" }],
        excluded_stations: [],
      },
    });
    mockSelectOnce([{ id: "station-1", email: "station@example.com", name: "Station One", dj_name: null, call_sign: null, city: null }]);

    const { POST } = await import("../pages/api/email/send");
    const request = new Request("https://labels.example/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ station_ids: ["station-1"], campaign_id: "campaign-1", radio_update: true, preview_only: true }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: { orgId: "org-1", membershipRole: "owner", user: { id: "operator-1" } } } as never);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reviewed_email).toMatchObject({ id: "radio-draft-1", version: 4 });
    expect(payload.reviewed_page).toBeNull();
    expect(payload.blockers).toContainEqual(expect.objectContaining({ code: "reviewed_public_page_required" }));
    expect(delivery.getCampaignEmailProvider).not.toHaveBeenCalled();
  });
});

function hashPageContentForTest(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item)
    ? item.map(sort)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sort(child)]))
      : item;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}
