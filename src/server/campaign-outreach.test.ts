import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectedRows: unknown[][] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const updatedValues: Array<Record<string, unknown>> = [];

  function result(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      for: () => typeof promise;
      orderBy: () => Promise<unknown[]>;
      limit: () => Promise<unknown[]>;
      returning: () => Promise<unknown[]>;
    };
    promise.for = () => promise;
    promise.orderBy = () => Promise.resolve(rows);
    promise.limit = () => Promise.resolve(rows);
    promise.returning = () => Promise.resolve(rows);
    return promise;
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const rows = selectedRows.shift() ?? [];
        const chain = {
          leftJoin: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          where: vi.fn(() => result(rows)),
          limit: vi.fn(() => result(rows)),
        };
        return chain;
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return Promise.resolve([]);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updatedValues.push(values);
        return { where: vi.fn(() => result([{ id: "lead-1" }])) };
      }),
    })),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  return { db, selectedRows, insertedValues, updatedValues };
});

const communicator = vi.hoisted(() => ({ getCommunicatorContext: vi.fn() }));
const activity = vi.hoisted(() => ({ getCampaignActivitySnapshot: vi.fn() }));

vi.mock("../lib/db", () => ({ db: mocks.db }));
vi.mock("./campaign-communicator", async (importOriginal) => ({
  ...await importOriginal<typeof import("./campaign-communicator")>(),
  getCommunicatorContext: communicator.getCommunicatorContext,
}));
vi.mock("./campaign-activity", () => ({ getCampaignActivitySnapshot: activity.getCampaignActivitySnapshot }));

import { createCampaignDogfoodEntry, getCampaignOutreachWorkspace, updateCampaignLead } from "./campaign-outreach";

describe("campaign outreach communicator persistence", () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    mocks.insertedValues.length = 0;
    mocks.updatedValues.length = 0;
    vi.clearAllMocks();
  });

  test("returns the focused queue and per-lead communicator context", async () => {
    const updatedAt = new Date("2026-08-04T09:00:00.000Z");
    mocks.selectedRows.push(
      [{ id: "campaign-1", campaign_name: "Fountain", linked_release_id: null }],
      [{
        id: "lead-1", campaign_id: "campaign-1", source_id: null, source_title: null,
        contact_id: null, contact_name: null, station_id: null, station_name: null,
        exact_edit_track_id: "track-1", exact_edit_title: "Night Edit", dedupe_key: "lead-1",
        target_name: "Night Radio", target_type: "radio_show", target_url: null,
        contact_route: "editor@example.com", contact_route_verified_at: updatedAt,
        discovery_source: "research", recommending_person: null, introduction_available: null,
        musical_fit: "Leftfield", relationship_warmth: 1, editorial_fit: 3, useful_reach: 1,
        direct_free_access: 2, pipeline_stage: "qualified", pitch_angle: "Exclusive edit",
        last_contacted_at: null, follow_up_at: null, outcome: null, evidence_url: null,
        published_at: null, notes: null, readiness_task_waiver_reason: null, updated_at: updatedAt,
      }],
      [],
      [],
      [],
    );
    communicator.getCommunicatorContext.mockResolvedValue({
      prompt: { id: "prompt-2", version: 2, prompt: "Warm and direct" },
      leads: {
        "lead-1": {
          suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit", created_at: updatedAt }],
          draft_versions: [{ id: "draft-2", version: 2 }],
          ready_blockers: ["approved_draft", "task_or_reason"],
          activity: [{ id: "event-1", event_type: "research_completed" }],
        },
      },
    });

    const result = await getCampaignOutreachWorkspace("org-1", "campaign-1");

    expect(result.prompt).toMatchObject({ version: 2, prompt: "Warm and direct" });
    expect(result.queue.now.map((row) => row.id)).toEqual(["lead-1"]);
    expect(result.leads[0]).toMatchObject({
      latest_suggestions: [{ id: "suggestion-1" }],
      draft_versions: [{ id: "draft-2" }],
      ready_blockers: ["approved_draft", "task_or_reason"],
      activity: [{ event_type: "research_completed" }],
    });
  });

  test("attaches the exact activity snapshot without changing outreach projections", async () => {
    const updatedAt = new Date("2026-08-04T09:00:00.000Z");
    const richDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich copy" }] }] };
    const snapshot = {
      items: [{ key: "event:event-1:research_completed" }],
      proposals: [{ key: "campaign-1:lead-1:draft-next:v1" }],
      sourceStates: [],
    };
    mocks.selectedRows.push(
      [{ id: "campaign-1", campaign_name: "Fountain", linked_release_id: null }],
      [{
        id: "lead-1", campaign_id: "campaign-1", source_id: null, source_title: null,
        contact_id: null, contact_name: null, station_id: null, station_name: null,
        exact_edit_track_id: null, exact_edit_title: null, dedupe_key: "lead-1",
        target_name: "Night Radio", target_type: "radio_show", target_url: null,
        contact_route: "editor@example.com", contact_route_verified_at: updatedAt,
        discovery_source: "research", recommending_person: null, introduction_available: null,
        musical_fit: "Leftfield", relationship_warmth: 1, editorial_fit: 3, useful_reach: 1,
        direct_free_access: 2, pipeline_stage: "qualified", pitch_angle: "Exclusive edit",
        last_contacted_at: null, follow_up_at: null, outcome: null, evidence_url: null,
        published_at: null, notes: null, readiness_task_waiver_reason: null, updated_at: updatedAt,
      }],
      [],
      [],
      [],
    );
    communicator.getCommunicatorContext.mockResolvedValue({
      prompt: null,
      leads: {
        "lead-1": {
          suggestions: [],
          draft_versions: [{ id: "draft-1", version: 1, body: "Rich copy", body_document: richDocument, body_html: "<p>Rich copy</p>" }],
          ready_blockers: [],
          activity: [],
        },
      },
      radio_drafts: [{ id: "radio-1", body: "Rich copy", body_document: richDocument, body_html: "<p>Rich copy</p>" }],
    });
    activity.getCampaignActivitySnapshot.mockResolvedValue(snapshot);

    const result = await getCampaignOutreachWorkspace("org-1", "campaign-1");

    expect(activity.getCampaignActivitySnapshot).toHaveBeenCalledWith("org-1", "campaign-1");
    expect(result.activity).toBe(snapshot);
    expect(result.queue.now.map((row) => row.id)).toEqual(["lead-1"]);
    expect(result.leads[0].draft_versions[0]).toMatchObject({
      body_document: richDocument,
      body_html: "<p>Rich copy</p>",
    });
    expect(result.radioUpdate.radio_drafts[0]).toMatchObject({
      body_document: richDocument,
      body_html: "<p>Rich copy</p>",
    });
  });

  test("converts an over-limit legacy draft in the workspace DTO without writing it back", async () => {
    const body = "x".repeat(10_001);
    mocks.selectedRows.push(
      [{ id: "campaign-1", campaign_name: "Fountain", linked_release_id: null }],
      [],
      [],
      [],
      [],
    );
    communicator.getCommunicatorContext.mockResolvedValue({
      prompt: null,
      leads: {},
      radio_drafts: [{ id: "legacy-radio", body, body_document: null, body_html: null }],
    });

    const result = await getCampaignOutreachWorkspace("org-1", "campaign-1");

    expect(result.radioUpdate.radio_drafts[0]).toMatchObject({
      id: "legacy-radio",
      body,
      body_document: { type: "doc" },
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("preserves the repair-required marker from communicator draft projections in the workspace DTO", async () => {
    mocks.selectedRows.push(
      [{ id: "campaign-1", campaign_name: "Fountain", linked_release_id: null }],
      [],
      [],
      [],
      [],
    );
    communicator.getCommunicatorContext.mockResolvedValue({
      prompt: null,
      leads: {},
      radio_drafts: [{ id: "malformed-radio", body: "Readable radio legacy copy", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Readable radio legacy copy" }] }] }, body_document_repair_required: true, body_html: null }],
    });

    const result = await getCampaignOutreachWorkspace("org-1", "campaign-1");

    expect(result.radioUpdate.radio_drafts[0]).toMatchObject({
      id: "malformed-radio",
      body: "Readable radio legacy copy",
      body_document: { type: "doc" },
      body_document_repair_required: true,
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("rejects a dogfood lead link outside the tenant campaign", async () => {
    mocks.selectedRows.push(
      [{ id: "campaign-1", campaign_name: "Fountain", linked_release_id: null }],
      [],
    );

    await expect(createCampaignDogfoodEntry("org-1", {
      campaign_id: "campaign-1",
      entry_type: "friction",
      severity: "P2",
      title: "Missing context",
      details: null,
      ui_surface: null,
      status: "logged",
      evidence_url: null,
      linked_lead_id: "other-lead",
    })).rejects.toThrow("Campaign lead not found");

    expect(mocks.insertedValues).toHaveLength(0);
  });

  test("clears contact-route verification when the general lead update changes the route", async () => {
    mocks.selectedRows.push([{
      id: "lead-1",
      org_id: "org-1",
      campaign_id: "campaign-1",
      contact_route: "old@example.com",
      contact_route_verified_at: new Date("2026-08-01T10:00:00.000Z"),
      station_id: null,
      contact_id: null,
      target_url: null,
      target_name: "Night Radio",
    }]);

    await updateCampaignLead("org-1", {
      id: "lead-1",
      campaign_id: "campaign-1",
      contact_route: "new@example.com",
    });

    expect(mocks.updatedValues.find((value) => value.contact_route === "new@example.com")).toMatchObject({
      contact_route: "new@example.com",
      contact_route_verified_at: null,
    });
  });
});
