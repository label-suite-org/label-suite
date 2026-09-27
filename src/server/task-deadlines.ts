import { sql } from "drizzle-orm";
import { calls, ops_tasks, orgs } from "../db/schema";

/** The current calendar date in the workspace's configured timezone. */
export function workspaceToday(orgId: string) {
  return sql<Date>`(
    now() at time zone coalesce(
      (select ${orgs.timezone} from ${orgs} where ${orgs.id} = ${orgId}),
      'UTC'
    )
  )::date`;
}

/** Compute overdue state from the due date instead of trusting the cached flag. */
export function taskIsOverdue(orgId: string) {
  return sql<boolean>`(
    ${ops_tasks.due_date} is not null
    and ${ops_tasks.due_date} < ${workspaceToday(orgId)}
    and ${taskIsOpen()}
  )`;
}

/** Open task state normalized across manual and imported status capitalization. */
export function taskIsOpen() {
  return sql<boolean>`lower(coalesce(${ops_tasks.status}, 'todo')) not in ('done', 'completed', 'cancelled', 'canceled')`;
}

/** Calls shown in Today Hub start today or later in the workspace timezone. */
export function callIsTodayOrFuture(orgId: string) {
  return sql<boolean>`(
    ${calls.start} is not null
    and ${calls.start}::date >= ${workspaceToday(orgId)}
    and lower(coalesce(${calls.status}, 'scheduled')) not in ('cancelled', 'canceled', 'completed', 'done')
  )`;
}
