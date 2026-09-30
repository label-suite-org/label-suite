import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_categories, budget_line_items, budget_projects, campaigns, funding_sources, grant_applications, grants, releases } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { getBudgetKpi, getBudgetProject, getBucketRollup, getCalendarCashflow, getPhaseCashflow, listBudgetLinesForProject, listBudgetProjects, listFundingSources } from "./budget-dashboard";
import { listDocumentsForLine } from "./budget-line-documents";
import { listVarianceRequests, nativeVarianceDecisionBlocker } from "./budget-mutations";
import { getProjectFundingCoverage } from "./funding-coverage";
import { getNativeProjectDetail } from "./native-events-projects";
import { NotFoundError } from "./errors";

export const nativeBudgetScopeSchema = z.object({
  line_id: z.string().trim().min(1).optional(),
  variance_id: z.string().trim().min(1).optional(),
  release_id: z.string().trim().min(1).optional(),
  project_id: z.string().trim().min(1).optional(),
  project_offset: z.coerce.number().int().nonnegative().default(0),
  line_offset: z.coerce.number().int().nonnegative().default(0),
}).strict().refine((value) => !value.variance_id || value.line_id, "A variance destination requires its expense line");

export async function getNativeBudget(orgId: string, userId: string, raw: unknown) {
  const scope = nativeBudgetScopeSchema.parse(raw);
  // Shared dashboard helpers resolve through this request context, so every total and line uses one snapshot.
  return runWithDatabaseContext({ orgId, userId }, async () => {
    const [focusedLine] = scope.line_id ? await db.select({
      id: budget_line_items.id, name: budget_line_items.name, project_id: budget_line_items.project_id,
      valid_project_id: budget_projects.id, effective_release_id: sql<string | null>`coalesce(${budget_line_items.release_id}, ${budget_projects.release_id})`, currency: budget_projects.currency,
      revision: sql<string>`coalesce(${budget_line_items.updated_at}::text, 'unversioned')`,
      amount: budget_line_items.amount, planned_amount: budget_line_items.planned_amount, forecast_amount: budget_line_items.forecast_amount,
      committed_amount: budget_line_items.committed_amount, paid_amount: budget_line_items.paid_amount,
      status: budget_line_items.status, lock_status: budget_line_items.lock_status, spend_month: budget_line_items.spend_month,
      eligibility_tag: budget_line_items.eligibility_tag, variance_reason: budget_line_items.variance_reason,
      release_id: releases.id, release_name: releases.title, campaign_id: campaigns.id, campaign_name: campaigns.campaign_name,
    }).from(budget_line_items)
      .leftJoin(budget_projects, and(eq(budget_projects.id, budget_line_items.project_id), eq(budget_projects.org_id, orgId)))
      .leftJoin(releases, and(eq(releases.id, budget_line_items.release_id), eq(releases.org_id, orgId)))
      .leftJoin(campaigns, and(eq(campaigns.id, budget_line_items.campaign_id), eq(campaigns.org_id, orgId)))
      .where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.id, scope.line_id))) : [];
    if (scope.line_id && (!focusedLine || (focusedLine.project_id && !focusedLine.valid_project_id)
      || (scope.project_id && scope.project_id !== focusedLine.project_id))) throw new NotFoundError("Budget line not found");
    if (scope.release_id && focusedLine && focusedLine.effective_release_id !== scope.release_id) throw new NotFoundError("Release budget not found");
    const focusCurrency = focusedLine?.currency?.trim() && focusedLine.currency === focusedLine.currency.trim() ? focusedLine.currency : null;
    const focusEvidence = focusedLine ? await listDocumentsForLine(orgId, focusedLine.id) : [];
    const focusVariances = focusedLine ? await listVarianceRequests(orgId, { lineId: focusedLine.id }) : [];
    if (scope.variance_id && !focusVariances.some((row) => row.id === scope.variance_id)) throw new NotFoundError("Budget variance not found");
    const focus = focusedLine ? { line: { ...focusedLine, currency: focusCurrency,
      evidence: focusEvidence.slice(0, 50).map(({ document_file_link: _privateLink, ...document }) => document), evidence_truncated: focusEvidence.length > 50 },
      variance_id: scope.variance_id ?? null,
      variances: focusVariances.map((request) => ({ ...request, native_decision_blocker: nativeVarianceDecisionBlocker(request, focusCurrency) })),
    } : null;
    const projects = (await listBudgetProjects(orgId, scope.release_id)).map((project) => ({ ...project, currency: project.currency?.trim() && project.currency === project.currency.trim() ? project.currency : null }));
    const [{ fetched_at }] = (await db.execute<{ fetched_at: string }>(sql`select transaction_timestamp()::text as fetched_at`)).rows;
    const unprojected = scope.release_id ? await db.select({ id: budget_line_items.id, name: budget_line_items.name }).from(budget_line_items)
      .where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.release_id, scope.release_id), isNull(budget_line_items.project_id)))
      .orderBy(budget_line_items.id).limit(51) : [];
    const page = { unprojected_lines: unprojected.slice(0, 50), unprojected_lines_partial: unprojected.length > 50, focus, projects: projects.slice(scope.project_offset, scope.project_offset + 50), next_project_offset: projects.length > scope.project_offset + 50 ? scope.project_offset + 50 : null, fetched_at };
    const projectId = focusedLine?.project_id ?? scope.project_id;
    if (scope.release_id) {
      const [release] = await db.select({ id: releases.id }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, scope.release_id))).limit(1);
      if (!release || (focusedLine && focusedLine.effective_release_id !== scope.release_id) || (projectId && !projects.some((project) => project.id === projectId))) throw new NotFoundError("Release budget not found");
    }
    if (!projectId) return { ...page, detail: null };
    const storedProject = await getBudgetProject(orgId, projectId);
    if (!storedProject) throw new NotFoundError("Budget project not found");
    const project = { ...storedProject, currency: storedProject.currency?.trim() && storedProject.currency === storedProject.currency.trim() ? storedProject.currency : null };
    const [kpi, buckets, phases, months, funding, coverage, lines, variances, context, lineContexts, release, grantLinks] = await Promise.all([
      getBudgetKpi(orgId, projectId), getBucketRollup(orgId, projectId), getPhaseCashflow(orgId, projectId), getCalendarCashflow(orgId, projectId),
      listFundingSources(orgId, projectId), getProjectFundingCoverage(orgId, projectId), listBudgetLinesForProject(orgId, projectId), listVarianceRequests(orgId, projectId),
      getNativeProjectDetail(orgId, projectId),
      db.select({ id: budget_line_items.id, revision: sql<string>`coalesce(${budget_line_items.updated_at}::text, 'unversioned')`,
        category_id: budget_categories.id, funding_source_id: funding_sources.id, release_id: releases.id, release_name: releases.title, campaign_id: campaigns.id, campaign_name: campaigns.campaign_name,
      }).from(budget_line_items)
        .leftJoin(budget_categories, and(eq(budget_categories.id, budget_line_items.category_id), eq(budget_categories.org_id, orgId)))
        .leftJoin(funding_sources, and(eq(funding_sources.id, budget_line_items.funding_source_id), eq(funding_sources.org_id, orgId)))
        .leftJoin(releases, and(eq(releases.id, budget_line_items.release_id), eq(releases.org_id, orgId)))
        .leftJoin(campaigns, and(eq(campaigns.id, budget_line_items.campaign_id), eq(campaigns.org_id, orgId)))
        .where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.project_id, projectId))),
      db.select({ id: releases.id, name: releases.title }).from(budget_projects)
        .innerJoin(releases, and(eq(releases.id, budget_projects.release_id), eq(releases.org_id, orgId)))
        .where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, projectId))).limit(1),
      db.select({ id: grant_applications.id, grant_id: grants.id, name: sql<string>`coalesce(${grants.name}, 'Grant application')` }).from(grant_applications)
        .leftJoin(grants, and(eq(grants.id, grant_applications.grant_id), eq(grants.org_id, orgId)))
        .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.project_id, projectId))).orderBy(grant_applications.id).limit(9),
    ]);
    // The existing dashboard calculation remains authoritative. Pagination only affects visible line details.
    const orderedLines = lines.sort((a, b) => a.id.localeCompare(b.id));
    const lineOffset = focusedLine ? Math.floor(orderedLines.findIndex((line) => line.id === focusedLine.id) / 50) * 50 : scope.line_offset;
    const visibleLines = orderedLines.slice(lineOffset, lineOffset + 50);
    const projectedLines = await Promise.all(visibleLines.map(async (line) => {
      const identity = lineContexts.find((row) => row.id === line.id)!;
      const evidence = await listDocumentsForLine(orgId, line.id);
      return { ...line, ...identity, currency: project.currency,
        evidence: evidence.slice(0, 50).map(({ document_file_link: _privateLink, ...document }) => document), evidence_truncated: evidence.length > 50,
      };
    }));
    return { ...page, detail: {
      project, kpi, buckets, phases, months, funding, coverage: project.currency ? coverage : null, lines: projectedLines,
      next_line_offset: orderedLines.length > lineOffset + 50 ? lineOffset + 50 : null,
      total_lines: orderedLines.length, variances: variances.map((request) => ({ ...request, native_decision_blocker: nativeVarianceDecisionBlocker(request, project.currency) })),
      relationships: { release: release[0] ?? null, events: context!.relationships.events, campaigns: context!.relationships.campaigns,
        grants: grantLinks.slice(0, 8), assets: context!.relationships.assets, documents: context!.relationships.documents },
      relationship_windows: { ...context!.relationship_windows, grants: { partial: grantLinks.length > 8 } },
      payment_execution: false,
    } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
