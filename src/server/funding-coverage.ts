import { and, eq } from "drizzle-orm";
import { budget_line_items, budget_projects, funding_sources, grant_applications, grants } from "../db/schema";
import { db } from "../lib/db";
import {
  computeCoverageForProjects,
  computeProjectCoverage,
  type ProjectFundingCoverage,
} from "./funding-coverage-core";

export type { ProjectFundingCoverage } from "./funding-coverage-core";
export { summarizeCoverageByCurrency } from "./funding-coverage-core";

/** Coverage for every budget project in the org, keyed by project id. */
export async function getFundingCoverage(orgId: string): Promise<Map<string, ProjectFundingCoverage>> {
  const [projects, lines, sources, applications] = await Promise.all([
    db.select({
      id: budget_projects.id,
      currency: budget_projects.currency,
      total_planned: budget_projects.total_planned,
    }).from(budget_projects).where(eq(budget_projects.org_id, orgId)),
    db.select({
      project_id: budget_line_items.project_id,
      planned_amount: budget_line_items.planned_amount,
      amount: budget_line_items.amount,
    }).from(budget_line_items).where(eq(budget_line_items.org_id, orgId)),
    db.select({
      id: funding_sources.id,
      project_id: funding_sources.project_id,
      status: funding_sources.status,
      amount_confirmed: funding_sources.amount_confirmed,
      amount_planned: funding_sources.amount_planned,
    }).from(funding_sources).where(eq(funding_sources.org_id, orgId)),
    db.select({
      project_id: grant_applications.project_id,
      funding_source_id: grant_applications.funding_source_id,
      workflow_stage: grant_applications.workflow_stage,
      outcome: grant_applications.outcome,
      amount_requested: grant_applications.amount_requested,
      amount_awarded: grant_applications.amount_awarded,
      currency: grants.currency,
    }).from(grant_applications).leftJoin(grants, and(eq(grants.id, grant_applications.grant_id), eq(grants.org_id, orgId))).where(eq(grant_applications.org_id, orgId)),
  ]);
  return computeCoverageForProjects(projects, lines, sources, applications);
}

/** Coverage for one project, or null when the project does not exist. */
export async function getProjectFundingCoverage(orgId: string, projectId: string): Promise<ProjectFundingCoverage | null> {
  const [projects, lines, sources, applications] = await Promise.all([
    db.select({
      id: budget_projects.id,
      currency: budget_projects.currency,
      total_planned: budget_projects.total_planned,
    }).from(budget_projects).where(and(eq(budget_projects.id, projectId), eq(budget_projects.org_id, orgId))),
    db.select({
      project_id: budget_line_items.project_id,
      planned_amount: budget_line_items.planned_amount,
      amount: budget_line_items.amount,
    }).from(budget_line_items).where(and(eq(budget_line_items.project_id, projectId), eq(budget_line_items.org_id, orgId))),
    db.select({
      id: funding_sources.id,
      project_id: funding_sources.project_id,
      status: funding_sources.status,
      amount_confirmed: funding_sources.amount_confirmed,
      amount_planned: funding_sources.amount_planned,
    }).from(funding_sources).where(and(eq(funding_sources.project_id, projectId), eq(funding_sources.org_id, orgId))),
    db.select({
      project_id: grant_applications.project_id,
      funding_source_id: grant_applications.funding_source_id,
      workflow_stage: grant_applications.workflow_stage,
      outcome: grant_applications.outcome,
      amount_requested: grant_applications.amount_requested,
      amount_awarded: grant_applications.amount_awarded,
      currency: grants.currency,
    }).from(grant_applications).leftJoin(grants, and(eq(grants.id, grant_applications.grant_id), eq(grants.org_id, orgId))).where(and(eq(grant_applications.project_id, projectId), eq(grant_applications.org_id, orgId))),
  ]);
  const project = projects[0];
  if (!project) return null;
  return computeProjectCoverage(project, lines, sources, applications);
}
