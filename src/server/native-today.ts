import { and, asc, eq, or, sql } from "drizzle-orm";
import { ops_tasks } from "../db/schema";
import { db } from "../lib/db";
import { taskIsOpen, taskIsOverdue } from "./task-deadlines";
import type { MembershipRole } from "./native-capabilities";

const REVIEW_ROLES: readonly MembershipRole[] = ["owner", "operator"];

export interface NativeTodayActor {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  role: MembershipRole;
}

export async function listNativeToday(orgId: string, actor: NativeTodayActor) {
  const overdue = taskIsOverdue(orgId);
  const assignedToActor = or(
    eq(ops_tasks.owner, actor.userId),
    sql`${actor.userId} = any(${ops_tasks.assignee_ids})`,
    actor.userName ? sql`lower(${ops_tasks.owner}) = lower(${actor.userName})` : undefined,
    actor.userEmail ? sql`lower(${ops_tasks.owner}) = lower(${actor.userEmail})` : undefined,
  );
  const scope = REVIEW_ROLES.includes(actor.role) ? undefined : assignedToActor;
  const rows = await db
    .select({
      id: ops_tasks.id,
      title: ops_tasks.task_name,
      status: sql<string>`lower(coalesce(${ops_tasks.status}, 'todo'))`,
      priority: ops_tasks.priority,
      due_date: ops_tasks.due_date,
      next_action: ops_tasks.next_action,
      notes: ops_tasks.notes,
      linked_campaign_id: ops_tasks.linked_campaign_id,
      linked_artist_id: ops_tasks.linked_artist_id,
      linked_release_id: ops_tasks.linked_release_id,
      is_overdue: overdue,
    })
    .from(ops_tasks)
    .where(and(eq(ops_tasks.org_id, orgId), taskIsOpen(), scope))
    .orderBy(
      asc(sql`case when ${overdue} then 0 else 1 end`),
      asc(sql`case ${ops_tasks.priority} when 'P0' then 0 when 'P1' then 1 when 'high' then 1 when 'P2' then 2 when 'medium' then 2 else 3 end`),
      asc(sql`${ops_tasks.due_date} is null`),
      asc(ops_tasks.due_date),
      asc(ops_tasks.id),
    )
    .limit(25);

  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: "task" as const,
      title: row.title,
      detail: row.next_action ?? row.notes,
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      is_overdue: Boolean(row.is_overdue),
      href: `/tasks/${encodeURIComponent(row.id)}`,
    })),
    scope: REVIEW_ROLES.includes(actor.role) ? "workspace_review" as const : "assigned" as const,
    refreshed_at: new Date().toISOString(),
  };
}
