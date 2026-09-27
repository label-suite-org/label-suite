import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { createOpsTask } from "../../../../../server/ops-tasks";
import { requireCapability } from "../../../../../server/tenant";
import {
  getDataQualityIssue,
  recordAuditEvent,
  updateDataQualityIssue,
} from "../../../../../server/integrations";

export const prerender = false;

const taskSchema = z.object({
  task_name: z.string().trim().min(1).optional(),
  priority: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
}).strict();

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const issue = await getDataQualityIssue(orgId, params.id ?? "");
    const input = await parseJson(request, taskSchema);
    const task = await createOpsTask(orgId, {
      task_name: input.task_name ?? `Resolve ${issue.source} data-quality issue`,
      priority: input.priority ?? issue.priority,
      notes: input.notes ?? `${issue.issue_type}: ${JSON.stringify(issue.details)}`,
      status: "todo",
    });
    const updated = await updateDataQualityIssue(orgId, {
      id: issue.id,
      status: "triaged",
      details: { ...issue.details, resolution: "task_created", ops_task_id: task.id },
    });
    await recordAuditEvent(orgId, {
      actor_user_id: locals.user?.id ?? null,
      actor_type: "user",
      event_type: "data_quality_issue.triaged",
      object_type: "data_quality_issue",
      object_id: issue.id,
      before: { status: issue.status },
      after: { status: updated.status, ops_task_id: task.id },
      metadata: { action: "create_ops_task" },
    });
    return json({ issue: updated, task }, 201);
  } catch (error) {
    return handleApiError(error);
  }
};
