import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { artists, budget_projects, campaigns, contacts, grants, ops_tasks, project_events, releases } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { assertTaskAssigneesEligible, mutateOpsTaskInTransaction, type TaskTransaction } from "./ops-tasks";

const taskActionBase = z.object({ expected_revision: z.number().int().nonnegative() });
export const nativeTaskActionSchema = z.discriminatedUnion("action", [
  taskActionBase.extend({ action: z.literal("complete") }),
  taskActionBase.extend({ action: z.literal("defer"), due_date: z.iso.date() }),
  taskActionBase.extend({ action: z.literal("reschedule"), due_date: z.iso.date() }),
  taskActionBase.extend({ action: z.literal("reassign"), assignee_ids: z.array(z.string().min(1)).max(50).transform((ids) => [...new Set(ids)]) }),
]);
export type NativeTaskAction = z.infer<typeof nativeTaskActionSchema>;

type TaskClient = TaskTransaction;
const linkedContact = alias(contacts, "native_task_linked_contact");

/** The only native Task read authority: tenant-scoped, bounded, and relationship-safe. */
export async function canonicalTask(orgId: string, taskId: string) {
  const row = (await db.select({
    id: ops_tasks.id, title: ops_tasks.task_name, status: ops_tasks.status, priority: ops_tasks.priority,
    due_date: ops_tasks.due_date, next_action: ops_tasks.next_action, notes: ops_tasks.notes,
    assignee_ids: ops_tasks.assignee_ids, revision: ops_tasks.revision,
    artist_id: ops_tasks.linked_artist_id, artist_name: artists.name,
    release_id: ops_tasks.linked_release_id, release_title: releases.title,
    campaign_id: ops_tasks.linked_campaign_id, campaign_name: campaigns.campaign_name,
    event_id: ops_tasks.event_id, event_title: project_events.title,
    project_id: ops_tasks.project_id, project_name: budget_projects.name,
    contact_id: ops_tasks.linked_contact_id, contact_name: linkedContact.name,
    grant_id: ops_tasks.linked_grant_id, grant_name: grants.name,
  }).from(ops_tasks)
    .leftJoin(artists, and(eq(artists.id, ops_tasks.linked_artist_id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(releases.id, ops_tasks.linked_release_id), eq(releases.org_id, orgId)))
    .leftJoin(campaigns, and(eq(campaigns.id, ops_tasks.linked_campaign_id), eq(campaigns.org_id, orgId)))
    .leftJoin(project_events, and(eq(project_events.id, ops_tasks.event_id), eq(project_events.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(budget_projects.id, ops_tasks.project_id), eq(budget_projects.org_id, orgId)))
    .leftJoin(linkedContact, and(eq(linkedContact.id, ops_tasks.linked_contact_id), eq(linkedContact.org_id, orgId)))
    .leftJoin(grants, and(eq(grants.id, ops_tasks.linked_grant_id), eq(grants.org_id, orgId)))
    .where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, orgId))).limit(1))[0];
  if (!row) throw new NotFoundError("Task not found");

  const relationships = [
    relationship("Artist", row.artist_id, row.artist_name), relationship("Release", row.release_id, row.release_title),
    relationship("Campaign", row.campaign_id, row.campaign_name), relationship("Event", row.event_id, row.event_title),
    relationship("Project", row.project_id, row.project_name), relationship("Contact", row.contact_id, row.contact_name),
    relationship("Grant", row.grant_id, row.grant_name),
  ].filter((value): value is { type: string; id: string; label: string } => Boolean(value));
  return { task: {
    id: row.id, title: row.title, status: row.status ?? "todo", priority: row.priority, due_date: row.due_date,
    next_action: row.next_action, notes: row.notes, assignee_ids: row.assignee_ids, revision: row.revision,
  }, relationships };
}

function relationship(type: string, id: string | null, label: string | null) {
  if (!id) return null;
  if (!label) throw new NotFoundError(`${type} relationship not found`);
  return { type, id, label };
}

/** Native adapter over the canonical task mutation authority; audit is atomic with a real change only. */
export async function executeNativeTaskAction(orgId: string, taskId: string, input: NativeTaskAction, actorUserId: string) {
  return db.transaction(async (tx: TaskClient) => {
    const mutation = await mutateOpsTaskInTransaction(tx, orgId, {
      taskId,
      expectedRevision: input.expected_revision,
      changes: actionChanges(input),
      skipNoop: true,
      validate: input.action === "reassign" ? async (client) => assertTaskAssigneesEligible(client, orgId, input.assignee_ids) : undefined,
    });
    const { current, updated } = mutation;
    const response = { task: { id: updated.id, revision: updated.revision, status: updated.status ?? "todo", due_date: updated.due_date, assignee_ids: updated.assignee_ids }, action: input.action, consequence: consequenceFor(updated, input.action) };
    if (!mutation.changed) return { ...response, no_change: true };

    await recordAuditEvent(orgId, {
      actor_user_id: actorUserId, event_type: `task.${input.action}`, object_type: "task", object_id: taskId,
      before: taskAuditData(current), after: taskAuditData(updated),
      metadata: { action: input.action, expected_revision: input.expected_revision, resulting_revision: updated.revision, consequence: consequenceFor(updated, input.action) },
    }, tx);
    return { ...response, no_change: false };
  });
}

function actionChanges(input: NativeTaskAction) {
  switch (input.action) {
    case "complete": return { status: "done", is_overdue: false };
    case "defer":
    case "reschedule": return { due_date: input.due_date, release_offset_days: null, is_overdue: false };
    case "reassign": return { assignee_ids: input.assignee_ids };
  }
}

function consequenceFor(task: Pick<typeof ops_tasks.$inferSelect, "status" | "due_date" | "assignee_ids">, action: NativeTaskAction["action"]) {
  return action === "complete" ? { status: task.status ?? "done" }
    : action === "reassign" ? { assignee_ids: task.assignee_ids }
    : { due_date: task.due_date };
}

function taskAuditData(task: typeof ops_tasks.$inferSelect) {
  return { status: task.status, due_date: task.due_date, assignee_ids: task.assignee_ids, revision: task.revision };
}

export const nativeTaskOrder = [asc(ops_tasks.due_date), asc(ops_tasks.id)] as const;
