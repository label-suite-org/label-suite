import { and, eq } from "drizzle-orm";
import { budget_line_items, budget_projects, budget_line_variance_requests, funding_sources } from "../db/schema";
import { db } from "../lib/db";
import { getGrantsWorkspace } from "./grants-workspace";
import { buildGrantsWorklist, type GrantsWorklistItem } from "./grants-worklist-core";

export type GrantsWorklistOptions = {
  today?: string;
  horizonDays?: number;
  limit?: number;
};

/** Server loader for the shared worklist. The pure builder remains the testable contract. */
export async function getGrantsWorklist(orgId: string, options: GrantsWorklistOptions = {}): Promise<GrantsWorklistItem[]> {
  const workspace = await getGrantsWorkspace(orgId);
  const [sourceRows, varianceRows] = await Promise.all([
    db.select({
      id: funding_sources.id, name: funding_sources.name, projectId: funding_sources.project_id,
      projectName: budget_projects.name, status: funding_sources.status, deadline: funding_sources.deadline,
      amountPlanned: funding_sources.amount_planned, currency: budget_projects.currency,
    }).from(funding_sources).leftJoin(budget_projects, and(eq(funding_sources.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(eq(funding_sources.org_id, orgId)),
    db.select({
      id: budget_line_variance_requests.id, lineName: budget_line_items.name, projectId: budget_line_items.project_id,
      projectName: budget_projects.name, amountAtStake: budget_line_items.planned_amount, currency: budget_projects.currency,
    }).from(budget_line_variance_requests).innerJoin(budget_line_items, and(
      eq(budget_line_variance_requests.line_id, budget_line_items.id), eq(budget_line_items.org_id, orgId),
    )).leftJoin(budget_projects, and(eq(budget_line_items.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(budget_line_variance_requests.org_id, orgId), eq(budget_line_variance_requests.status, "pending"))),
  ]);
  const items = buildGrantsWorklist({
    applications: workspace.applications,
    fundingSources: sourceRows.map((source) => ({ ...source, amountPlanned: Number(source.amountPlanned ?? 0), currency: source.currency ?? undefined })),
    varianceRequests: varianceRows.map((request) => ({ ...request, amountAtStake: Number(request.amountAtStake ?? 0), currency: request.currency ?? undefined })),
    today: options.today,
    horizonDays: options.horizonDays ?? 30,
  });
  return options.limit == null ? items : items.slice(0, Math.max(0, options.limit));
}
