import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const whereCalls: Array<{ table: unknown; predicate: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown>; predicate: unknown }> = [];
  const selectRows: unknown[][] = [];
  const limitCalls: number[] = [];

  function buildQueryResult(rows: unknown[]) {
    const query: Promise<unknown[]> & { orderBy: () => typeof query; limit: (limit: number) => unknown[] } = Promise.resolve(rows) as Promise<unknown[]> & {
      orderBy: () => typeof query;
      limit: (limit: number) => unknown[];
    };
    query.orderBy = () => query;
    query.limit = (limit: number) => { limitCalls.push(limit); return rows; };
    return query;
  }

  const db = {
    select: vi.fn(() => {
      return {
        from: vi.fn((table: unknown) => {
          const chain: any = {
            leftJoin: () => chain,
            where: vi.fn((predicate: unknown) => {
              whereCalls.push({ table, predicate });
              return buildQueryResult(selectRows.shift() ?? []);
            }),
          };

          return chain;
        }),
      };
    }),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn((predicate: unknown) => {
          updateCalls.push({ table, values, predicate });
          return Promise.resolve([]);
        }),
      })),
    })),
  };

  return { db, whereCalls, updateCalls, selectRows, limitCalls };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: (value: unknown) => ({ kind: "asc", value }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
  inArray: (left: unknown, values: unknown[]) => ({ kind: "inArray", left, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "sql", strings: [...strings], values }),
}));

vi.mock("../lib/db", () => ({ db: hoisted.db }));

import { campaigns, documents, email_templates, media_assets } from "../db/schema";
import {
  getCampaignContentContext,
  listCampaignContentTemplates,
  previewCampaignTemplateContent,
  reviewCampaignTemplateForCampaign,
  saveCampaignContentTemplate,
} from "./campaign-content";

describe("campaign content helpers", () => {
  beforeEach(() => {
    hoisted.whereCalls.length = 0;
    hoisted.updateCalls.length = 0;
    hoisted.selectRows.length = 0;
    hoisted.limitCalls.length = 0;
    vi.clearAllMocks();
  });

  test("uses a SQL sentinel limit only for requested native template options", async () => {
    hoisted.selectRows.push([]);

    await listCampaignContentTemplates("org-1", { limit: 25 });

    expect(hoisted.limitCalls).toEqual([26]);
  });

  test("loads the reviewed template context and source options", async () => {
    hoisted.selectRows.push([
      {
        id: "campaign-1",
        campaign_name: "North Drop",
        linked_release_id: "release-1",
        linked_artist_id: "artist-1",
        release_title: "North Release",
        release_status: "done",
        artist_name: "North Artist",
        campaign_audience_id: null,
        campaign_audience_name: null,
        reviewed_template_id: "template-1",
        content_channel: "email",
        content_provider: "brevo",
        content_operator_id: null,
        content_source_version: 2,
        content_source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: ["doc-1"], media_asset_ids: ["media-1"] },
      },
    ]);
    hoisted.selectRows.push([
      {
        id: "template-1",
        name: "North Press",
        subject: "North {{campaign_name}}",
        body: "Hello {{campaign_name}}",
        description: null,
        is_default: false,
        channel: "email",
        current_version: 2,
        review_status: "reviewed",
        reviewed_at: null,
        reviewed_by: null,
        source_version: 2,
        source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: ["doc-1"], media_asset_ids: [] },
      },
    ]);
    hoisted.selectRows.push([{ id: "doc-1", name: "Press Kit" }]);
    hoisted.selectRows.push([{ id: "media-1", name: "Cover Art" }]);

    const context = await getCampaignContentContext("org-1", "campaign-1");

    expect(context.selection?.reviewed_template_id).toBe("template-1");
    expect(context.templates).toHaveLength(1);
    expect(context.source_options.documents).toEqual([{ id: "doc-1", name: "Press Kit" }]);
    expect(context.source_options.media_assets).toEqual([{ id: "media-1", name: "Cover Art" }]);
    expect(context.selection?.content_source_references.document_ids).toEqual(["doc-1"]);
    expect(context.selection?.content_source_references.media_asset_ids).toEqual(["media-1"]);
  });

  test("rejects saving an unreviewed template", async () => {
    hoisted.selectRows.push([
      { linked_release_id: "release-1", linked_artist_id: "artist-1" },
    ]);
    hoisted.selectRows.push([
      {
        id: "template-1",
        channel: "email",
        current_version: 1,
        review_status: "draft",
        source_version: 1,
        source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: [], media_asset_ids: [] },
      },
    ]);

    await expect(saveCampaignContentTemplate("org-1", "campaign-1", { template_id: "template-1", source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: [], media_asset_ids: [] } }))
      .rejects.toMatchObject({ message: "Template is not reviewed" });
    expect(hoisted.updateCalls).toHaveLength(0);
  });

  test("persists reviewed template selection when source selections are valid", async () => {
    hoisted.selectRows.push([{ linked_release_id: "release-1", linked_artist_id: "artist-1" }]);
    hoisted.selectRows.push([{
      id: "template-1",
      channel: "email",
      current_version: 2,
      review_status: "reviewed",
      source_version: 2,
      source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: [], media_asset_ids: [] },
    }]);
    hoisted.selectRows.push([{ id: "doc-1", name: "Press Kit" }]);
    hoisted.selectRows.push([{ id: "media-1", name: "Cover Art" }]);
    hoisted.selectRows.push([{ id: "release-1" }]);
    hoisted.selectRows.push([{ id: "artist-1" }]);

    const result = await saveCampaignContentTemplate("org-1", "campaign-1", {
      template_id: "template-1",
      source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: [], media_asset_ids: [] },
    });

    expect(result).toEqual({ ok: true });
    expect(hoisted.updateCalls).toHaveLength(1);
    expect(hoisted.updateCalls[0]).toMatchObject({
      table: campaigns,
      values: { reviewed_template_id: "template-1", content_source_version: 2, revision: { kind: "sql" } },
    });
    expect(hoisted.whereCalls.length).toBeGreaterThan(0);
    expect(hoisted.whereCalls.some(({ table }) => table === documents)).toBe(true);
    expect(hoisted.whereCalls.some(({ table }) => table === media_assets)).toBe(true);
  });

  test("lists draft and reviewed templates in the campaign content context", async () => {
    hoisted.selectRows.push([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: null,
      campaign_audience_name: null,
      reviewed_template_id: null,
      content_channel: null,
      content_provider: null,
      content_operator_id: null,
      content_source_version: null,
      content_source_references: null,
    }]);
    hoisted.selectRows.push([
      {
        id: "template-draft",
        name: "Draft press",
        subject: "Draft {{campaign_name}}",
        body: "Draft body",
        description: null,
        is_default: false,
        channel: "email",
        current_version: 1,
        review_status: "draft",
        reviewed_at: null,
        reviewed_by: null,
        source_version: null,
        source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
      },
      {
        id: "template-reviewed",
        name: "Reviewed press",
        subject: "Reviewed {{campaign_name}}",
        body: "Reviewed body",
        description: null,
        is_default: false,
        channel: "email",
        current_version: 2,
        review_status: "reviewed",
        reviewed_at: new Date(),
        reviewed_by: "ops-1",
        source_version: 2,
        source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
      },
    ]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([]);

    const context = await getCampaignContentContext("org-1", "campaign-1");

    expect(context.templates).toHaveLength(2);
    expect(context.templates[0].id).toBe("template-draft");
    expect(context.templates[1].id).toBe("template-reviewed");
  });

  test("reviews a template with current source references and updates source metadata", async () => {
    hoisted.selectRows.push([
      { linked_release_id: "release-1", linked_artist_id: "artist-1" },
    ]);
    hoisted.selectRows.push([{
      id: "template-draft",
      name: "North Press",
      subject: "North {{campaign_name}}",
      body: "Hello {{campaign_name}}",
      description: null,
      is_default: false,
      channel: "email",
      current_version: 3,
      review_status: "draft",
      reviewed_at: null,
      reviewed_by: null,
      source_version: null,
      source_references: { release_id: "release-1", artist_id: "artist-1", document_ids: [], media_asset_ids: [] },
    }]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([{ id: "release-1" }]);
    hoisted.selectRows.push([{ id: "artist-1" }]);
    hoisted.selectRows.push([{ id: "doc-1" }]);
    hoisted.selectRows.push([{ id: "media-1" }]);

    const result = await reviewCampaignTemplateForCampaign("org-1", "campaign-1", {
      template_id: "template-draft",
    }, "ops-1");

    expect(result).toEqual({ ok: true });
    const templateUpdate = hoisted.updateCalls.find((call) => call.table === email_templates);
    expect(templateUpdate?.values.review_status).toBe("reviewed");
    expect(templateUpdate?.values.reviewed_by).toBe("ops-1");
    expect(templateUpdate?.values.source_version).toBe(3);
    expect(templateUpdate?.values.source_references).toMatchObject({
      release_id: "release-1",
      artist_id: "artist-1",
      document_ids: [],
      media_asset_ids: [],
    });
  });

  test("returns no-send result when no template is selected", async () => {
    hoisted.selectRows.push([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Release",
      release_status: "done",
      artist_name: "North Artist",
      campaign_audience_id: null,
      campaign_audience_name: null,
      reviewed_template_id: null,
      content_channel: null,
      content_provider: null,
      content_operator_id: null,
      content_source_version: null,
      content_source_references: null,
    }]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([]);

    const preview = await previewCampaignTemplateContent("org-1", "campaign-1", {});

    expect(preview.status).toBe("no-send");
    expect(preview.blockers[0].code).toBe("template_missing");
    expect(preview.blockers[0].message).toBe("No template selected for this campaign.");
    expect(preview.can_send).toBe(false);
  });

  test("surfaces review blockers for a persisted template that is no longer reviewed", async () => {
    hoisted.selectRows.push([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: null,
      campaign_audience_name: null,
      reviewed_template_id: "template-1",
      content_channel: "email",
      content_provider: "brevo",
      content_operator_id: null,
      content_source_version: 1,
      content_source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([{
      id: "template-1",
      name: "North Press",
      subject: "North {{campaign_name}}",
      body: "Hello {{campaign_name}}",
      description: null,
      is_default: false,
      channel: "email",
      current_version: 1,
      review_status: "draft",
      reviewed_at: null,
      reviewed_by: null,
      source_version: 1,
      source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);

    const preview = await previewCampaignTemplateContent("org-1", "campaign-1", {});

    expect(preview.blockers.some((blocker) => blocker.code === "template_unreviewed")).toBe(true);
    expect(preview.blockers.some((blocker) => blocker.code === "template_missing")).toBe(false);
    expect(preview.can_send).toBe(false);
  });

  test("rejects saving when explicit source release is missing from the same org", async () => {
    hoisted.selectRows.push([{ linked_release_id: null, linked_artist_id: null }]);
    hoisted.selectRows.push([{
      id: "template-1",
      channel: "email",
      current_version: 2,
      review_status: "reviewed",
      source_version: 2,
      source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    hoisted.selectRows.push([]);

    await expect(saveCampaignContentTemplate("org-1", "campaign-1", {
      template_id: "template-1",
      source_references: { release_id: "release-missing", artist_id: null, document_ids: [], media_asset_ids: [] },
    })).rejects.toMatchObject({ message: "Selected release is missing in this workspace." });

    expect(hoisted.updateCalls).toHaveLength(0);
  });

  test("renders explicit release and artist source references in the no-send preview", async () => {
    hoisted.selectRows.push([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: null,
      linked_artist_id: null,
      release_title: null,
      release_status: null,
      artist_name: null,
      campaign_audience_id: "aud-1",
      campaign_audience_name: "Press",
      reviewed_template_id: null,
      content_channel: null,
      content_provider: null,
      content_operator_id: null,
      content_source_version: null,
      content_source_references: null,
    }]);
    hoisted.selectRows.push([{
      id: "template-1",
      name: "North Press",
      subject: "{{artist_name}} - {{release_title}}",
      body: "Now pitching {{release_title}} by {{artist_name}}",
      description: null,
      is_default: false,
      channel: "email",
      current_version: 2,
      review_status: "reviewed",
      reviewed_at: null,
      reviewed_by: null,
      source_version: 2,
      source_references: { release_id: null, artist_id: null, document_ids: [], media_asset_ids: [] },
    }]);
    hoisted.selectRows.push([{ id: "release-2" }]);
    hoisted.selectRows.push([{ id: "artist-2" }]);
    hoisted.selectRows.push([{ title: "Glow", status: "scheduled" }]);
    hoisted.selectRows.push([{ name: "Ada" }]);

    const preview = await previewCampaignTemplateContent("org-1", "campaign-1", {
      template_id: "template-1",
      source_references: { release_id: "release-2", artist_id: "artist-2", document_ids: [], media_asset_ids: [] },
      operator_id: "user-1",
    });

    expect(preview.preview_subject).toBe("Ada - Glow");
    expect(preview.preview_body).toBe("Now pitching Glow by Ada");
    expect(preview.blockers).toEqual([]);
    expect(preview.provenance.operator.id).toBe("user-1");
    expect(preview.provenance.recipient.source_references).toEqual({
      release_id: "release-2",
      artist_id: "artist-2",
      document_ids: [],
      media_asset_ids: [],
    });
  });

  test("flags extra selected source references as stale in preview", async () => {
    hoisted.selectRows.push([{
      id: "campaign-1",
      campaign_name: "North Drop",
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "North Release",
      release_status: "scheduled",
      artist_name: "North Artist",
      campaign_audience_id: null,
      campaign_audience_name: null,
      reviewed_template_id: "template-1",
      content_channel: "email",
      content_provider: "brevo",
      content_operator_id: "ops-1",
      content_source_version: 2,
      content_source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: [],
      },
    }]);
    hoisted.selectRows.push([{
      id: "template-1",
      name: "North Press",
      subject: "{{document_name}}",
      body: "Body",
      description: null,
      is_default: false,
      channel: "email",
      current_version: 2,
      review_status: "reviewed",
      reviewed_at: new Date(),
      reviewed_by: "ops-1",
      source_version: 2,
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1"],
        media_asset_ids: [],
      },
    }]);
    hoisted.selectRows.push([{ id: "doc-1", name: "Press Kit" }, { id: "doc-2", name: "One Sheet" }]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([{ id: "release-1" }]);
    hoisted.selectRows.push([{ id: "artist-1" }]);
    hoisted.selectRows.push([{ id: "doc-1" }, { id: "doc-2" }]);
    hoisted.selectRows.push([]);
    hoisted.selectRows.push([{ title: "North Release", status: "scheduled" }]);
    hoisted.selectRows.push([{ name: "North Artist" }]);
    hoisted.selectRows.push([{ name: "Press Kit" }, { name: "One Sheet" }]);
    hoisted.selectRows.push([]);

    const preview = await previewCampaignTemplateContent("org-1", "campaign-1", {
      template_id: "template-1",
      source_references: {
        release_id: "release-1",
        artist_id: "artist-1",
        document_ids: ["doc-1", "doc-2"],
        media_asset_ids: [],
      },
      operator_id: "ops-2",
    });

    expect(preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "source_stale",
        message: "Source document references do not match template-reviewed references.",
      }),
    ]));
    expect(preview.can_send).toBe(false);
  });
});
