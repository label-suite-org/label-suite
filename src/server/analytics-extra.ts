import { and, desc, eq, sql } from "drizzle-orm";
import { artists, campaigns, ops_tasks, releases, royalties_revenue } from "../db/schema";
import { db } from "../lib/db";
import { taskIsOverdue } from "./task-deadlines";

// ─── Royalties timeseries (monthly net + gross by month) ───────────

export interface RoyaltiesMonthlyPoint {
  month: string; // YYYY-MM
  gross: number;
  net: number;
  count: number;
}

export interface RoyaltiesTimeseriesResult {
  points: RoyaltiesMonthlyPoint[];
  totals: {
    gross: number;
    net: number;
    count: number;
    monthCount: number;
  };
}

export async function listRoyaltiesTimeseries(orgId: string): Promise<RoyaltiesTimeseriesResult> {
  // Use revenue_month when available, otherwise fall back to YYYY-MM of payment_date or statement_period.
  const rows = await db
    .select({
      month: sql<string>`coalesce(nullif(${royalties_revenue.revenue_month}, ''), substr(coalesce(nullif(${royalties_revenue.payment_date}, ''), coalesce(${royalties_revenue.statement_period}, '')), 1, 7))`,
      gross: sql<number>`coalesce(sum(${royalties_revenue.gross_revenue}), 0)`,
      net: sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(royalties_revenue)
    .where(eq(royalties_revenue.org_id, orgId))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const cleaned = rows
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month ?? ""))
    .map((row) => ({
      month: row.month,
      gross: Number(row.gross ?? 0),
      net: Number(row.net ?? 0),
      count: Number(row.count ?? 0),
    }));

  const totals = cleaned.reduce(
    (acc, point) => ({
      gross: acc.gross + point.gross,
      net: acc.net + point.net,
      count: acc.count + point.count,
      monthCount: acc.monthCount + 1,
    }),
    { gross: 0, net: 0, count: 0, monthCount: 0 },
  );

  return { points: cleaned, totals };
}

// ─── Top artists by net revenue ──────────────────────────────────

export interface TopArtistRow {
  artistId: string;
  artistName: string;
  net: number;
  gross: number;
  count: number;
}

export async function listTopArtistsByNet(orgId: string, limit = 10): Promise<TopArtistRow[]> {
  const rows = await db
    .select({
      artistId: royalties_revenue.artist_id,
      artistName: artists.name,
      net: sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`,
      gross: sql<number>`coalesce(sum(${royalties_revenue.gross_revenue}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(royalties_revenue)
    .leftJoin(artists, and(eq(royalties_revenue.artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(royalties_revenue.org_id, orgId), sql`${royalties_revenue.artist_id} is not null`))
    .groupBy(royalties_revenue.artist_id, artists.name)
    .orderBy(desc(sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`))
    .limit(limit);

  return rows.map((row) => ({
    artistId: row.artistId ?? "",
    artistName: row.artistName ?? "Unknown artist",
    net: Number(row.net ?? 0),
    gross: Number(row.gross ?? 0),
    count: Number(row.count ?? 0),
  }));
}

// ─── Top releases by net revenue ─────────────────────────────────

export interface TopReleaseRow {
  releaseId: string;
  releaseTitle: string;
  artistName: string | null;
  net: number;
  gross: number;
  count: number;
}

export async function listTopReleasesByNet(orgId: string, limit = 10): Promise<TopReleaseRow[]> {
  const rows = await db
    .select({
      releaseId: royalties_revenue.release_id,
      releaseTitle: releases.title,
      artistName: artists.name,
      net: sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`,
      gross: sql<number>`coalesce(sum(${royalties_revenue.gross_revenue}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(royalties_revenue)
    .leftJoin(releases, and(eq(royalties_revenue.release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(royalties_revenue.org_id, orgId), sql`${royalties_revenue.release_id} is not null`))
    .groupBy(royalties_revenue.release_id, releases.title, artists.name)
    .orderBy(desc(sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`))
    .limit(limit);

  return rows.map((row) => ({
    releaseId: row.releaseId ?? "",
    releaseTitle: row.releaseTitle ?? "Unknown release",
    artistName: row.artistName ?? null,
    net: Number(row.net ?? 0),
    gross: Number(row.gross ?? 0),
    count: Number(row.count ?? 0),
  }));
}

// ─── Campaign status breakdown ───────────────────────────────────

export interface CampaignStatusBreakdown {
  status: string;
  count: number;
  totalBudgetPlanned: number;
  totalBudgetActual: number;
}

export async function listCampaignStatusBreakdown(orgId: string): Promise<CampaignStatusBreakdown[]> {
  const rows = await db
    .select({
      status: campaigns.status,
      count: sql<number>`count(*)`,
      planned: sql<number>`coalesce(sum(${campaigns.budget_planned}), 0)`,
      actual: sql<number>`coalesce(sum(${campaigns.budget_actual}), 0)`,
    })
    .from(campaigns)
    .where(eq(campaigns.org_id, orgId))
    .groupBy(campaigns.status)
    .orderBy(desc(sql<number>`count(*)`));

  return rows.map((row) => ({
    status: row.status ?? "planning",
    count: Number(row.count ?? 0),
    totalBudgetPlanned: Number(row.planned ?? 0),
    totalBudgetActual: Number(row.actual ?? 0),
  }));
}

// ─── Ops tasks by priority + status ──────────────────────────────

export interface OpsTasksBreakdown {
  byPriority: Array<{ priority: string; open: number; done: number; overdue: number }>;
  byStatus: Array<{ status: string; count: number }>;
  totalOpen: number;
  totalOverdue: number;
}

export async function listOpsTasksBreakdown(orgId: string): Promise<OpsTasksBreakdown> {
  const overdue = taskIsOverdue(orgId);
  const priorityRows = await db
    .select({
      priority: ops_tasks.priority,
      status: ops_tasks.status,
      isOverdue: overdue,
    })
    .from(ops_tasks)
    .where(eq(ops_tasks.org_id, orgId));

  const statusMap = new Map<string, number>();
  const priorityMap = new Map<string, { priority: string; open: number; done: number; overdue: number }>();
  let totalOverdue = 0;

  for (const row of priorityRows) {
    const status = (row.status ?? "todo").toLowerCase();
    const priority = row.priority ?? "P2";
    const isDone = status === "done";
    const isOpen = !isDone;

    statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

    if (!priorityMap.has(priority)) {
      priorityMap.set(priority, { priority, open: 0, done: 0, overdue: 0 });
    }
    const bucket = priorityMap.get(priority)!;
    if (isOpen) bucket.open += 1;
    else bucket.done += 1;

    if (isOpen && row.isOverdue) {
      bucket.overdue += 1;
      totalOverdue += 1;
    }
  }

  const priorityOrder = ["P0", "P1", "P2", "P3", "P4"];
  const byPriority = Array.from(priorityMap.values()).sort((a, b) => {
    const aIdx = priorityOrder.indexOf(a.priority);
    const bIdx = priorityOrder.indexOf(b.priority);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const statusOrder = ["todo", "in_progress", "blocked", "done"];
  const byStatus = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const aIdx = statusOrder.indexOf(a.status);
      const bIdx = statusOrder.indexOf(b.status);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

  const totalOpen = priorityRows.filter((row) => row.status !== "done").length;

  return { byPriority, byStatus, totalOpen, totalOverdue };
}
