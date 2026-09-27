import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { artists, bugs, ops_tasks, releases, royalties_revenue } from "../db/schema";
import { db } from "../lib/db";
import { getRoyaltyTotals } from "./royalties";
import { taskIsOpen, taskIsOverdue } from "./task-deadlines";

export async function getDashboardData(orgId: string) {
  const overdue = taskIsOverdue(orgId);

  const [
    artistCount,
    releaseRows,
    bugCount,
    artistRows,
    royaltyTotals,
    openTaskCount,
    overdueTaskCount,
    attentionReleases,
    attentionBugs,
    attentionTasks,
    unpaidRows,
    freshnessRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(artists).where(eq(artists.org_id, orgId)),
    db.select().from(releases).where(eq(releases.org_id, orgId)),
    db.select({ value: count() }).from(bugs).where(and(eq(bugs.org_id, orgId), eq(bugs.status, "logged"))),
    db.select().from(artists).where(eq(artists.org_id, orgId)).orderBy(artists.name),
    getRoyaltyTotals(orgId),
    db.select({ value: count() }).from(ops_tasks)
      .where(and(eq(ops_tasks.org_id, orgId), taskIsOpen())),
    db.select({ value: count() }).from(ops_tasks)
      .where(and(eq(ops_tasks.org_id, orgId), overdue)),
    db
      .select({
        id: releases.id,
        title: releases.title,
        release_date: releases.release_date,
        status: releases.status,
        release_missing: releases.release_missing,
        artist_name: artists.name,
      })
      .from(releases)
      .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
      .where(and(eq(releases.org_id, orgId), eq(releases.release_ready, false)))
      .orderBy(
        asc(sql`${releases.release_date} is null`),
        asc(releases.release_date),
        asc(releases.title),
      )
      .limit(3),
    db
      .select({
        id: bugs.id,
        title: bugs.title,
        description: bugs.description,
        priority: bugs.priority,
        source_table: bugs.source_table,
        source_record_id: bugs.source_record_id,
        updated_at: bugs.updated_at,
      })
      .from(bugs)
      .where(and(eq(bugs.org_id, orgId), eq(bugs.status, "logged")))
      .orderBy(
        asc(sql`case ${bugs.priority} when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end`),
        desc(bugs.updated_at),
      )
      .limit(5),
    db
      .select({
        id: ops_tasks.id,
        task_name: ops_tasks.task_name,
        status: ops_tasks.status,
        priority: ops_tasks.priority,
        owner: ops_tasks.owner,
        due_date: ops_tasks.due_date,
        next_action: ops_tasks.next_action,
        is_overdue: overdue,
        artist_name: artists.name,
        release_title: releases.title,
      })
      .from(ops_tasks)
      .leftJoin(artists, and(eq(ops_tasks.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
      .leftJoin(releases, and(eq(ops_tasks.linked_release_id, releases.id), eq(releases.org_id, orgId)))
      .where(and(eq(ops_tasks.org_id, orgId), taskIsOpen()))
      .orderBy(
        asc(sql`case when ${overdue} then 0 else 1 end`),
        asc(sql`case ${ops_tasks.priority} when 'P0' then 0 when 'P1' then 1 when 'high' then 1 when 'P2' then 2 when 'medium' then 2 else 3 end`),
        asc(sql`${ops_tasks.due_date} is null`),
        asc(ops_tasks.due_date),
      )
      .limit(4),
    db
      .select({
        id: royalties_revenue.id,
        record_name: royalties_revenue.record_name,
        statement_period: royalties_revenue.statement_period,
        source: royalties_revenue.source,
        net_revenue: royalties_revenue.net_revenue,
        artist_name: artists.name,
        release_title: releases.title,
        updated_at: royalties_revenue.updated_at,
      })
      .from(royalties_revenue)
      .leftJoin(artists, and(eq(royalties_revenue.artist_id, artists.id), eq(artists.org_id, orgId)))
      .leftJoin(releases, and(eq(royalties_revenue.release_id, releases.id), eq(releases.org_id, orgId)))
      .where(and(eq(royalties_revenue.org_id, orgId), eq(royalties_revenue.paid_out, "unpaid")))
      .orderBy(desc(royalties_revenue.updated_at))
      .limit(4),
    db
      .select({
        latestRelease: sql<Date | null>`max(${releases.updated_at})`,
        latestBug: sql<Date | null>`(select max(updated_at) from label_suite.bugs where org_id = ${orgId})`,
        latestTask: sql<Date | null>`(select max(updated_at) from label_suite.ops_tasks where org_id = ${orgId})`,
        latestRoyalty: sql<Date | null>`(select max(updated_at) from label_suite.royalties_revenue where org_id = ${orgId})`,
      })
      .from(releases)
      .where(eq(releases.org_id, orgId)),
  ]);

  const sortedRosterSignals = [...artistRows]
    .sort((a, b) => (b.spotify_followers ?? -1) - (a.spotify_followers ?? -1))
    .slice(0, 4)
    .map((artist) => ({
      id: artist.id,
      name: artist.name,
      spotify_followers: artist.spotify_followers,
      pro: artist.pro,
      signal: artist.spotify_followers
        ? `${artist.spotify_followers.toLocaleString("en-US")} followers`
        : artist.pro
          ? `${artist.pro} registered`
          : "Needs profile detail",
    }));

  const readinessPct = releaseRows.length
    ? Math.round((releaseRows.filter((release) => release.release_ready).length / releaseRows.length) * 100)
    : 0;

  const releasePipeline = ["draft", "scheduled", "released", "archived"].map((status) => ({
    status,
    label: titleCase(status),
    count: releaseRows.filter((release) => (release.status ?? "draft").toLowerCase() === status).length,
  }));

  return {
    artistCount: artistCount[0]?.value ?? 0,
    releaseRows,
    openBugCount: bugCount[0]?.value ?? 0,
    readyReleaseCount: releaseRows.filter((release) => release.release_ready).length,
    readinessPct,
    releasePipeline,
    artistRows,
    rosterSignals: sortedRosterSignals,
    totalNetRevenue: royaltyTotals.totalNet,
    unpaidStatements: royaltyTotals.unpaidCount,
    openTaskCount: openTaskCount[0]?.value ?? 0,
    overdueTaskCount: overdueTaskCount[0]?.value ?? 0,
    attentionReleases,
    attentionBugs,
    attentionTasks,
    unpaidRows,
    freshness: freshnessRows[0] ?? null,
  };
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
