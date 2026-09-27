import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  dataQualityPriorities,
  dataQualityStatuses,
  getDataQualityIssue,
  listDataQualityIssues,
  recordAuditEvent,
  updateDataQualityIssue,
  updateDataQualityIssueSchema,
} from "../../../server/integrations";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

const filterSchema = z.object({
  connection_id: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  priority: z.enum(dataQualityPriorities).optional(),
  status: z.enum(dataQualityStatuses).optional(),
  label_suite_object_type: z.string().trim().min(1).optional(),
}).strict();

type RouteDependencies = {
  requireCapability: typeof requireCapability;
  listDataQualityIssues: typeof listDataQualityIssues;
  getDataQualityIssue: typeof getDataQualityIssue;
  updateDataQualityIssue: typeof updateDataQualityIssue;
  recordAuditEvent: typeof recordAuditEvent;
};

export function createDataQualityRoute(dependencies: RouteDependencies = {
  requireCapability,
  listDataQualityIssues,
  getDataQualityIssue,
  updateDataQualityIssue,
  recordAuditEvent,
}) {
 const GET: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = dependencies.requireCapability(locals, "integrations.manage");
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const filter = filterSchema.parse(params);
    return json(await dependencies.listDataQualityIssues(orgId, filter));
  } catch (error) {
    return handleApiError(error);
  }
};

 const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = dependencies.requireCapability(locals, "integrations.manage");
    const input = await parseJson(request, updateDataQualityIssueSchema);
    const before = await dependencies.getDataQualityIssue(orgId, input.id);
    const issue = await dependencies.updateDataQualityIssue(orgId, input);
    const statusChanged = input.status && input.status !== before.status;
    await dependencies.recordAuditEvent(orgId, {
      actor_user_id: locals.user?.id ?? null,
      actor_type: "user",
      event_type: statusChanged ? `data_quality_issue.${input.status}` : "data_quality_issue.updated",
      object_type: "data_quality_issue",
      object_id: issue.id,
      before: { status: before.status, priority: before.priority, details: before.details },
      after: { status: issue.status, priority: issue.priority, details: issue.details },
    });
    return json(issue);
  } catch (error) {
    return handleApiError(error);
  }
};

 return { GET, PATCH };
}

export const { GET, PATCH } = createDataQualityRoute();
