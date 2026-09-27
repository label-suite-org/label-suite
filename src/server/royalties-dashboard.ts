import { and, eq, isNotNull } from "drizzle-orm";
import { contacts, roles, royalties_revenue, works } from "../db/schema";
import { db } from "../lib/db";
import {
  buildMasterPayoutPreview,
  buildRoyaltiesDashboard,
  formatRoyaltiesPayoutCsv,
  type MasterPayoutPreview,
  type RoyaltiesDashboard,
  type RoyaltiesDashboardRevenueRow,
  type RoyaltiesDashboardRoleRow,
} from "./royalties-dashboard-core";
import { observeOperation } from "./observability";

export async function getRoyaltiesDashboard(orgId: string): Promise<RoyaltiesDashboard> {
  return observeOperation("royalties.dashboard", orgId, async () => {
    const { revenueRows, roleRows } = await getRoyaltiesDashboardInputs(orgId);
    return buildRoyaltiesDashboard(revenueRows, roleRows);
  });
}

export async function getMasterPayoutPreview(orgId: string): Promise<MasterPayoutPreview> {
  const { revenueRows, roleRows } = await getRoyaltiesDashboardInputs(orgId);
  return buildMasterPayoutPreview(revenueRows, roleRows);
}

export async function getMasterPayoutPreviewCsv(orgId: string): Promise<string> {
  const preview = await getMasterPayoutPreview(orgId);
  return formatRoyaltiesPayoutCsv(preview.lines);
}

async function getRoyaltiesDashboardInputs(orgId: string): Promise<{
  revenueRows: RoyaltiesDashboardRevenueRow[];
  roleRows: RoyaltiesDashboardRoleRow[];
}> {
  const [revenueRows, roleRows] = await Promise.all([
    listRoyaltiesDashboardRevenueRows(orgId),
    listRoyaltiesDashboardRoleRows(orgId),
  ]);

  return { revenueRows, roleRows };
}

async function listRoyaltiesDashboardRevenueRows(orgId: string): Promise<RoyaltiesDashboardRevenueRow[]> {
  return db
    .select({
      id: royalties_revenue.id,
      recordName: royalties_revenue.record_name,
      statementId: royalties_revenue.statement_id,
      statementPeriod: royalties_revenue.statement_period,
      source: royalties_revenue.source,
      netRevenue: royalties_revenue.net_revenue,
      paidOut: royalties_revenue.paid_out,
      revenueType: royalties_revenue.revenue_type,
      workId: royalties_revenue.work_id,
      trackId: royalties_revenue.track_id,
      workTitle: works.title,
    })
    .from(royalties_revenue)
    .leftJoin(works, and(eq(royalties_revenue.work_id, works.id), eq(works.org_id, orgId)))
    .where(eq(royalties_revenue.org_id, orgId));
}

async function listRoyaltiesDashboardRoleRows(orgId: string): Promise<RoyaltiesDashboardRoleRow[]> {
  const rows = await db
    .select({
      workId: roles.work_id,
      contactId: roles.contact_id,
      contactName: contacts.name,
      ownershipType: roles.ownership_type,
      scope: roles.scope,
      role: roles.role,
      percentShare: roles.percent_share,
    })
    .from(roles)
    .leftJoin(contacts, and(eq(roles.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .where(and(eq(roles.org_id, orgId), isNotNull(roles.work_id)));

  return rows
    .filter((row): row is typeof rows[number] & { workId: string } => Boolean(row.workId))
    .map((row) => ({
      workId: row.workId,
      contactId: row.contactId,
      contactName: row.contactName,
      ownershipType: row.ownershipType,
      scope: row.scope,
      role: row.role,
      percentShare: row.percentShare,
    }));
}
