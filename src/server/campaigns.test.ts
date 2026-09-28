import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDocument } from "../lib/campaign-rich-text";

const mocks = vi.hoisted(() => {
  const updateSets: Array<Record<string, unknown>> = [];
  const updateReturningRows: Array<Array<{ id: string }>> = [];
  const insertValues: Array<Record<string, unknown>> = [];
  const detailRows: Array<Record<string, unknown>> = [];

  return {
    updateSets,
    updateReturningRows,
    insertValues,
    detailRows,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => {
          const chain = {
            leftJoin: vi.fn(() => chain),
            where: vi.fn(() => {
              const rows = [...detailRows];
              const result = Promise.resolve(rows) as Promise<Array<Record<string, unknown>>> & {
                orderBy: () => Array<Record<string, unknown>>;
                limit: () => Promise<Array<Record<string, unknown>>>;
              };
              result.orderBy = () => rows;
              result.limit = async () => rows;
              return result;
            }),
          };
          return chain;
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            insertValues.push(values);
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateSets.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => updateReturningRows.shift() ?? [{ id: "campaign-1" }]),
            })),
          };
        }),
      })),
    },
  };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import {
  getCampaignDetail,
  listCampaigns,
  createCampaign,
  createCampaignSchema,
  renderCampaignDocumentForDisplay,
  updateCampaign,
  updateCampaignSchema,
} from "./campaigns";

const doc = (text: string): CampaignDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});
const EXPECTED_REVISION = 7;

describe("campaign rich-text persistence", () => {
  beforeEach(() => {
    mocks.updateSets.length = 0;
    mocks.updateReturningRows.length = 0;
    mocks.insertValues.length = 0;
    mocks.detailRows.length = 0;
    vi.clearAllMocks();
  });

  it("rejects impossible Campaign dates at the API schema while accepting empty legacy fields", () => {
    const base = { campaign_name: "Launch", linked_artist_id: "artist-1", linked_release_id: "release-1" };
    expect(() => createCampaignSchema.parse({ ...base, start_date: "2026-02-30" })).toThrow();
    expect(() => updateCampaignSchema.parse({ id: "campaign-1", expected_revision: 1, end_date: "2026-13-01" })).toThrow();
    expect(createCampaignSchema.parse({ ...base, start_date: null, end_date: "" })).toMatchObject({ start_date: null, end_date: null });
  });

  it("accepts a goal document and atomically derives compatibility text on update", async () => {
    const input = updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, goal_document: doc("Earn airplay") });

    expect(input).toMatchObject({ goal_document: doc("Earn airplay") });

    await updateCampaign("org-a", input);

    expect(mocks.updateSets).toHaveLength(1);
    expect(mocks.updateSets[0]).toMatchObject({
      goal_document: doc("Earn airplay"),
      goal: "Earn airplay",
    });
  });

  it("converts a legacy goal write into a canonical document on the server", async () => {
    const input = updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, goal: "First\n\nSecond" });

    await updateCampaign("org-a", input);

    expect(mocks.updateSets[0]).toMatchObject({
      goal: "First\n\nSecond",
      goal_document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      },
    });
  });

  it("returns a conflict instead of overwriting a campaign changed after the caller's saved version", async () => {
    mocks.updateReturningRows.push([]);
    const input = updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, campaign_name: "New local name" });

    await expect(updateCampaign("org-a", input)).rejects.toThrow("Campaign changed since it was loaded");
  });

  it("uses a server-owned revision CAS even when PostgreSQL's saved timestamp has microseconds beyond JSON precision", async () => {
    const input = updateCampaignSchema.parse({
      id: "campaign-1",
      expected_revision: EXPECTED_REVISION,
      campaign_name: "Microsecond-safe local name",
    });

    await expect(updateCampaign("org-a", input)).resolves.toEqual({ ok: true });
    expect(mocks.updateSets[0]).toMatchObject({ campaign_name: "Microsecond-safe local name", revision: expect.anything() });
  });

  it("uses documents as authoritative when compatibility text disagrees", async () => {
    const input = updateCampaignSchema.parse({
      id: "campaign-1",
      expected_revision: EXPECTED_REVISION,
      goal: "Stale text",
      goal_document: doc("Canonical goal"),
    });

    await updateCampaign("org-a", input);

    expect(mocks.updateSets[0]).toMatchObject({
      goal: "Canonical goal",
      goal_document: doc("Canonical goal"),
    });
  });

  it("rejects invalid documents before any database update", () => {
    expect(() => updateCampaignSchema.parse({
      id: "campaign-1",
      notes_document: { type: "script", content: [] },
    })).toThrow(/node type|type doc/i);
    expect(mocks.updateSets).toHaveLength(0);
  });

  it("creates canonical documents and server-derived compatibility text from legacy input", async () => {
    mocks.detailRows.push({ id: "artist-1", artist_id: "artist-1" });
    const input = createCampaignSchema.parse({
      id: "campaign-1",
      campaign_name: "Legacy create",
      linked_artist_id: "artist-1",
      linked_release_id: "release-1",
      goal: "First\n\nSecond",
      notes: null,
    });

    await createCampaign("org-a", input);

    expect(mocks.insertValues[0]).toMatchObject({
      id: "campaign-1",
      org_id: "org-a",
      goal: "First\n\nSecond",
      goal_document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      },
      notes: "",
      notes_document: doc(""),
    });
  });

  it("requires both catalog links when editing them while allowing unrelated legacy edits", () => {
    expect(() => updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, linked_artist_id: "artist-1", linked_release_id: null })).toThrow();
    expect(() => updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, linked_artist_id: "artist-1" })).toThrow();
    expect(updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, campaign_name: "Legacy name correction" })).toMatchObject({ campaign_name: "Legacy name correction" });
  });

  it("checks edited Artist and Release ownership before saving", async () => {
    const input = updateCampaignSchema.parse({ id: "campaign-1", expected_revision: EXPECTED_REVISION, linked_artist_id: "artist-1", linked_release_id: "release-1" });
    await expect(updateCampaign("org-a", input)).rejects.toThrow("Artist not found in active workspace");
    expect(mocks.updateSets).toHaveLength(0);

    mocks.detailRows.push({ id: "release-1", artist_id: "other-artist" });
    await expect(updateCampaign("org-a", input)).rejects.toThrow("Campaign Artist must match the Release Artist");
    expect(mocks.updateSets).toHaveLength(0);

    mocks.detailRows[0].artist_id = "artist-1";
    await expect(updateCampaign("org-a", input)).resolves.toEqual({ ok: true });
    expect(mocks.updateSets[0]).toMatchObject({ linked_artist_id: "artist-1", linked_release_id: "release-1" });
  });

  it("returns in-memory documents for legacy detail rows without writing them", async () => {
    mocks.detailRows.push({
      id: "campaign-1",
      campaign_name: "Legacy campaign",
      goal: "First\n\nSecond",
      goal_document: null,
      notes: null,
      notes_document: null,
    });

    const campaign = await getCampaignDetail("org-a", "campaign-1");

    expect(campaign).toMatchObject({
      goal_document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      },
      notes_document: doc(""),
    });
    expect(mocks.updateSets).toHaveLength(0);
  });

  it("includes in-memory documents in campaign list rows used by edit actions", async () => {
    mocks.detailRows.push({
      id: "campaign-1",
      campaign_name: "List campaign",
      goal: "Legacy goal",
      goal_document: null,
      notes: "Legacy notes",
      notes_document: null,
    });

    const [campaign] = await listCampaigns("org-a");

    expect(campaign).toMatchObject({
      goal: "Legacy goal",
      goal_document: doc("Legacy goal"),
      notes: "Legacy notes",
      notes_document: doc("Legacy notes"),
    });
  });

  it("renders only derived document HTML and escapes compatibility text on derivation failure", () => {
    expect(renderCampaignDocumentForDisplay(doc("Earn airplay"), "ignored")).toEqual({
      html: "<p>Earn airplay</p>",
      plainText: "Earn airplay",
      usedFallback: false,
    });

    expect(renderCampaignDocumentForDisplay({ type: "script", content: [] }, '<img src=x onerror="alert(1)">')).toEqual({
      html: "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
      plainText: '<img src=x onerror="alert(1)">',
      usedFallback: true,
    });
  });

  it("keeps campaign mutation routes capability-gated", async () => {
    const { PUT } = await import("../pages/api/campaigns");
    const response = await PUT({
      request: new Request("https://suite.test/api/campaigns", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "campaign-1", goal_document: doc("Denied") }),
      }),
      locals: { orgId: "org-a", membershipRole: "member" },
    } as never);

    expect(response.status).toBe(403);
    expect(mocks.updateSets).toHaveLength(0);
  });

  it("rejects invalid route documents before the update seam", async () => {
    const { PUT } = await import("../pages/api/campaigns");
    const response = await PUT({
      request: new Request("https://suite.test/api/campaigns", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "campaign-1",
          notes_document: { type: "doc", content: [{ type: "image", attrs: { src: "x" } }] },
        }),
      }),
      locals: { orgId: "org-a", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(400);
    expect(mocks.updateSets).toHaveLength(0);
  });

  it("returns 409 from the mutation route when the saved campaign version is stale", async () => {
    mocks.updateReturningRows.push([]);
    const { PUT } = await import("../pages/api/campaigns");
    const response = await PUT({
      request: new Request("https://suite.test/api/campaigns", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "campaign-1", expected_revision: EXPECTED_REVISION, campaign_name: "Stale local name" }),
      }),
      locals: { orgId: "org-a", membershipRole: "operator" },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "Campaign changed since it was loaded. Reload before saving again." });
  });
});
