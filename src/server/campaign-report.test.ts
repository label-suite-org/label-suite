import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { campaigns } from "../db/schema";

const database = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
vi.mock("../lib/db", () => ({ db: database }));
import { finalizeCampaignReport, getCampaignOsWorkspace } from "./campaign-os";

const campaignId = "campaign-1";
const orgId = "org-1";

describe("Campaign report finalisation", () => {
  let saved: Record<string, unknown> | null;
  let whereSql: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    saved = null;
    whereSql = [];
    database.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
          limit: async () => table === campaigns && new PgDialect().sqlToQuery(condition).params.includes(orgId) ? [{ id: campaignId, final_report: saved?.final_report ?? null, final_report_snapshot: saved?.final_report_snapshot ?? null, final_report_finalized_at: saved?.final_report_finalized_at ?? null }] : [],
          orderBy: async () => [],
          then: (resolve: (rows: unknown[]) => void) => resolve([]),
        }),
        innerJoin: () => ({ where: () => ({ orderBy: async () => [] }) }),
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
    await expect(finalizeCampaignReport(orgId, campaignId, "Changed report", "actor-2")).rejects.toMatchObject({ status: 409 });
    expect(saved).toBe(first);
    expect(saved).toMatchObject({ final_report: "First report", final_report_finalized_by: "actor-1", final_report_snapshot: { cost: { planned: 0, committed: 0, paid: 0 } } });
    expect(whereSql).toHaveLength(2);
    expect(whereSql[0]).toContain('"org_id"');
    expect(whereSql[0]).toContain('"final_report_snapshot" is null');
    expect(whereSql[0]).toContain('"final_report_finalized_at" is null');
  });

  it("does not expose a campaign report through another organisation", async () => {
    await expect(getCampaignOsWorkspace("other-org", campaignId)).rejects.toMatchObject({ status: 404 });
    await expect(finalizeCampaignReport("other-org", campaignId, "Wrong tenant", "actor-2")).rejects.toMatchObject({ status: 404 });
    expect(database.update).not.toHaveBeenCalled();
  });
});
