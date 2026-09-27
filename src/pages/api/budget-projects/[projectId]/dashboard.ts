import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { requireOrgId } from "../../../../server/tenant";
import {
  getBucketRollup,
  getBudgetKpi,
  getBudgetProject,
  getCalendarCashflow,
  getPhaseCashflow,
  listBudgetLinesForProject,
  listFundingSources,
} from "../../../../server/budget-dashboard";
import { getGrantSummary, listVarianceRequests } from "../../../../server/budget-mutations";
import { getProjectFundingCoverage } from "../../../../server/funding-coverage";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const projectId = params.projectId;
    if (!projectId) {
      return json({ error: "projectId required" }, 400);
    }

    const project = await getBudgetProject(orgId, projectId);
    if (!project) {
      return json({ error: "project not found" }, 404);
    }

    const [kpi, buckets, lines, funding, phases, calendarPhases, grantSummary, varianceRequests, coverage] = await Promise.all([
      getBudgetKpi(orgId, projectId),
      getBucketRollup(orgId, projectId),
      listBudgetLinesForProject(orgId, projectId),
      listFundingSources(orgId, projectId),
      getPhaseCashflow(orgId, projectId),
      getCalendarCashflow(orgId, projectId),
      getGrantSummary(orgId, projectId),
      listVarianceRequests(orgId, projectId),
      getProjectFundingCoverage(orgId, projectId),
    ]);

    return json({ project, kpi, buckets, lines, funding, phases, calendarPhases, grantSummary, varianceRequests, coverage });
  } catch (err) {
    return handleApiError(err);
  }
};
