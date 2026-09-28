import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { budget_line_items, campaign_creator_deliverables, campaign_posts, campaigns } from "../db/schema";

const database = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("../lib/db", () => ({ db: database }));
import { finalizeCampaignReport, getCampaignOsWorkspace } from "./campaign-os";

const campaignId = "campaign-1";
const orgId = "org-1";

describe("Campaign report finalisation", () => {
  let saved: Record<string, unknown> | null;
  let whereSql: string[];
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    saved = null;
    whereSql = [];
    posts = [{ id: "post-1", url: "https://example.test/post", platform: "Instagram", published_at: new Date("2026-09-20"), metrics_captured_at: new Date("2026-09-21"), manual_metrics: { views: 100 }, notes: "Screenshot on file" }];
    database.transaction.mockImplementation((callback: (tx: { select: typeof database.select; update: typeof database.update }) => Promise<unknown>) => callback({ select: database.select, update: database.update }));
    database.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
          limit: async () => table === campaigns && new PgDialect().sqlToQuery(condition).params.includes(orgId) ? [{ id: campaignId, final_report: saved?.final_report ?? null, final_report_snapshot: saved?.final_report_snapshot ?? null, final_report_finalized_at: saved?.final_report_finalized_at ?? null }] : [],
          orderBy: async () => table === campaign_posts ? posts : table === campaign_creator_deliverables ? [{ engagement_id: "engagement-1", description: "One video", approval_status: "approved", evidence_url: "https://example.test/evidence" }] : table === budget_line_items ? [{ id: "line-1", campaign_id: campaignId, name: "Creator fee", planned_amount: "100", amount: "100", committed_amount: "50", paid_amount: "25" }] : [],
          then: (resolve: (rows: unknown[]) => void) => resolve([]),
        }),
        innerJoin: () => ({ where: () => ({ orderBy: async () => [{ id: "engagement-1", contact_name: "Alex", status: "complete", budget_line_id: "line-1" }] }) }),
      }),
    }));
    database.update.mockImplementation(() => ({ set: (values: Record<string, unknown>) => ({
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
        returning: async () => {
          whereSql.push(new PgDialect().sqlToQuery(condition).sql);
          if (saved) return [];
          saved = values;
          return [{ id: campaignId }];
        },
      }),
    }) }));
  });

  it("preserves the first saved narrative, actor and figures on repeat finalisation", async () => {
    await finalizeCampaignReport(orgId, campaignId, "First report", "actor-1");
    const first = saved;
    posts[0].url = "https://example.test/changed";
    await expect(finalizeCampaignReport(orgId, campaignId, "Changed report", "actor-2")).rejects.toMatchObject({ status: 409 });
    expect(saved).toBe(first);
    expect(saved).toMatchObject({ final_report: "First report", final_report_finalized_by: "actor-1", final_report_snapshot: {
      cost: { planned: 100, committed: 50, paid: 25 },
      creator_delivery: [{ contact_name: "Alex", deliverables: [{ description: "One video", approval_status: "approved" }] }],
      post_evidence: [{ url: "https://example.test/post", manual_metrics: { views: 100 } }],
      budget_lines: [{ name: "Creator fee", planned_amount: "100" }],
    } });
    expect(whereSql).toHaveLength(2);
    expect(whereSql[0]).toContain('"org_id"');
    expect(whereSql[0]).toContain('"final_report_snapshot" is null');
    expect(whereSql[0]).toContain('"final_report_finalized_at" is null');
    expect(database.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read" });
  });

  it("does not expose a campaign report through another organisation", async () => {
    await expect(getCampaignOsWorkspace("other-org", campaignId)).rejects.toMatchObject({ status: 404 });
    await expect(finalizeCampaignReport("other-org", campaignId, "Wrong tenant", "actor-2")).rejects.toMatchObject({ status: 404 });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("returns a conflict when a concurrent finalisation causes a serialization failure", async () => {
    await finalizeCampaignReport(orgId, campaignId, "First report", "actor-1");
    database.transaction.mockRejectedValueOnce(new Error("query failed", { cause: Object.assign(new Error("could not serialize"), { code: "40001" }) }));
    await expect(finalizeCampaignReport(orgId, campaignId, "Concurrent report", "actor-2")).rejects.toMatchObject({ status: 409 });
    expect(saved).toMatchObject({ final_report: "First report", final_report_finalized_by: "actor-1" });
  });
});
