import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sessions } from "../db/auth-schema";
import { artists, budget_line_items, budget_line_variance_requests, budget_projects, campaigns, contacts, grant_applications, notification_intents, notification_preferences, ops_tasks, organizations, org_memberships, releases, tracks, works } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { NotFoundError } from "./errors";
import { ROLE_CAPABILITIES, type MembershipRole } from "./native-capabilities";
import { notificationCategory, notificationCategoryAvailable, type NotificationRecordKind } from "./native-notifications-core";
import { canonicalTask } from "./native-tasks";
import { getNativeTrack } from "./native-tracks";
import { taskIsOpen, workspaceToday } from "./task-deadlines";
import { listUserMemberships } from "./tenant";

export type NotificationDestination = { workspaceId: string; recordId: string } & (
  | { kind: Exclude<NotificationRecordKind, "track"> }
  | { kind: "track"; releaseId: string | null }
  | { kind: "budget_variance"; lineId: string; projectId: string | null }
);
type Resolution = { status: "available"; destination: NotificationDestination } | { status: "unavailable" };
const unavailable = { status: "unavailable" } as const;

/** A push carries only an opaque ID. Neither the payload nor the active workspace grants access. */
export async function resolveNativeNotification(userId: string, sessionId: string, rawId: unknown, workspaceId?: string): Promise<Resolution> {
  const id = z.uuid().parse(rawId);
  return runWithDatabaseContext({ userId, orgId: "" }, async () => {
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(and(
      eq(sessions.id, sessionId), eq(sessions.userId, userId), sql`${sessions.expiresAt} > clock_timestamp()`,
    )).for("share");
    if (!session) return unavailable;
    // Use existing membership discovery; no privileged cross-tenant intent lookup.
    for (const { org } of await listUserMemberships(userId)) {
      if (workspaceId && org.id !== workspaceId) continue;
      const result = await runWithDatabaseContext({ userId, orgId: org.id }, async (): Promise<Resolution> => {
        const [member] = await db.select({ role: org_memberships.role }).from(org_memberships)
          .where(and(eq(org_memberships.org_id, org.id), eq(org_memberships.user_id, userId))).for("share");
        if (!member || !Object.hasOwn(ROLE_CAPABILITIES, member.role)) return unavailable;
        const role = member.role as MembershipRole;
        // Retention deletes intents before locking preferences; use the same order.
        const [intent] = await db.select().from(notification_intents)
          .where(and(eq(notification_intents.id, id), eq(notification_intents.org_id, org.id),
            eq(notification_intents.user_id, userId), sql`${notification_intents.expires_at} > clock_timestamp()`,
          )).for("key share");
        const category = notificationCategory.safeParse(intent?.category);
        if (!intent || !category.success || !notificationCategoryAvailable(role, category.data)) return unavailable;
        const [preference] = await db.select({ generation: notification_preferences.generation }).from(notification_preferences).where(and(
          eq(notification_preferences.org_id, org.id), eq(notification_preferences.user_id, userId),
          eq(notification_preferences.category, intent.category), eq(notification_preferences.generation, intent.preference_generation),
          isNotNull(notification_preferences.enabled_at), eq(notification_preferences.enabled_role, role),
        )).for("share");
        if (!preference) return unavailable;
        const destination = await currentDestination(intent, userId);
        return destination ? { status: "available", destination } : unavailable;
      });
      if (result.status === "available") return result;
    }
    return unavailable;
  });
}

async function currentDestination(intent: typeof notification_intents.$inferSelect, userId: string): Promise<NotificationDestination | null> {
  const { org_id: orgId, record_id: recordId, record_kind: kind, category } = intent;
  const identity = { workspaceId: orgId, recordId };
  if (kind === "task") {
    if (!["assignments", "deadlines", "record_changes"].includes(category)) return null;
    const [task] = await db.select({ id: ops_tasks.id }).from(ops_tasks).where(and(
      eq(ops_tasks.org_id, orgId), eq(ops_tasks.id, recordId), sql`${userId} = any(${ops_tasks.assignee_ids})`,
      category === "record_changes" ? undefined : taskIsOpen(),
      category === "deadlines" ? and(
        eq(sql`'deadline:' || ${ops_tasks.id} || ':' || ${ops_tasks.due_date}::text`, intent.source_key),
        sql`${ops_tasks.due_date} between ${workspaceToday(orgId)} and ${workspaceToday(orgId)} + 1`,
      ) : undefined,
    ));
    if (!task) return null;
    try { await canonicalTask(orgId, recordId); }
    catch (error) { if (error instanceof NotFoundError) return null; throw error; }
    return { ...identity, kind };
  }
  if (kind === "budget_variance") {
    if (category !== "requested_reviews" && category !== "approval_results") return null;
    const request = budget_line_variance_requests;
    const [row] = await db.select({ lineId: budget_line_items.id, projectId: budget_line_items.project_id, validProject: budget_projects.id })
      .from(request).innerJoin(budget_line_items, and(eq(budget_line_items.id, request.line_id), eq(budget_line_items.org_id, orgId)))
      .leftJoin(budget_projects, and(eq(budget_projects.id, budget_line_items.project_id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(request.org_id, orgId), eq(request.id, recordId),
        eq(sql`'variance:' || ${request.id} || ':' || ${request.status} || ':' || coalesce(${request.reviewed_at}::text, 'pending')`, intent.source_key),
        category === "requested_reviews"
          ? and(eq(request.status, "pending"), sql`${request.requested_by_user_id} is distinct from ${userId}`)
          : and(sql`${request.status} in ('approved', 'rejected')`, eq(request.requested_by_user_id, userId), sql`${request.reviewed_by_user_id} is distinct from ${userId}`),
      ));
    if (!row || (row.projectId && !row.validProject)) return null;
    return { ...identity, kind, lineId: row.lineId, projectId: row.projectId };
  }
  if (category !== "record_changes") return null;
  if (kind === "track") {
    const [track] = await db.select({ releaseId: tracks.release_id }).from(tracks)
      .where(and(eq(tracks.id, recordId), eq(tracks.org_id, orgId)));
    if (!track) return null;
    try { await getNativeTrack(orgId, track.releaseId, recordId); }
    catch (error) { if (error instanceof NotFoundError) return null; throw error; }
    return { ...identity, kind, releaseId: track.releaseId };
  }
  let table;
  switch (kind) {
    case "artist": table = artists; break;
    case "release": table = releases; break;
    case "work": table = works; break;
    case "contact": table = contacts; break;
    case "organization": table = organizations; break;
    case "campaign": table = campaigns; break;
    case "project": table = budget_projects; break;
    case "grant_application": table = grant_applications; break;
    default: return null;
  }
  const [record] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, recordId), eq(table.org_id, orgId)));
  return record ? { ...identity, kind } : null;
}
