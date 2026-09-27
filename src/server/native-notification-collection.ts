import { and, asc, eq, gte, inArray, isNotNull, lte, notExists, sql, type SQL } from "drizzle-orm";
import { audit_logs, budget_line_variance_requests, job_runs, notification_intents, notification_preferences, notification_source_receipts, ops_tasks, org_memberships } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { ROLE_CAPABILITIES, type MembershipRole } from "./native-capabilities";
import { auditNotificationSources, deadlineNotificationSource, notificationCategory, notificationCategoryAvailable, notificationConsentApplies, varianceNotificationSource, type NotificationSource } from "./native-notifications-core";
import { taskIsOpen, workspaceToday } from "./task-deadlines";

/** Call within the selected workspace transaction, including during opt-in. */
export async function queueNotificationCollection(orgId: string, delaySeconds = 0) {
  await db.insert(job_runs).values({
    id: `job_${crypto.randomUUID()}`, org_id: orgId, job_type: "notification_sync", trigger: "scheduled", payload: {},
    available_at: sql`clock_timestamp() + ${delaySeconds} * interval '1 second'`,
    // A fresh opt-in must not collide with a completed scheduled job in this minute.
    idempotency_key: delaySeconds === 0 ? `notification-opt-in:${crypto.randomUUID()}` : sql`'notifications:' || floor(extract(epoch from clock_timestamp() + ${delaySeconds} * interval '1 second') / 60)::text`,
  }).onConflictDoNothing();
}

export async function collectNativeNotifications(orgId: string, signal?: AbortSignal) {
  return runWithDatabaseContext({ orgId, userId: "" }, async () => {
    // ponytail: serialize one workspace batch; partition recipients if fanout outgrows the worker lease.
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 261))`);
    const members = await db.select({ userId: org_memberships.user_id, role: org_memberships.role }).from(org_memberships)
      .where(eq(org_memberships.org_id, orgId)).orderBy(org_memberships.user_id).for("share");
    const [snapshot] = (await db.execute<{ now: string; today: string }>(sql`select clock_timestamp()::timestamp as now, ${workspaceToday(orgId)}::text as today`)).rows;
    const clock = { now: notification_preferences.enabled_at.mapFromDriverValue(snapshot.now) as Date, today: snapshot.today };
    let created = 0, processed = 0, active = false, retained = false, cleanupDue = false;
    for (const member of members) {
      signal?.throwIfAborted();
      if (!Object.hasOwn(ROLE_CAPABILITIES, member.role)) continue;
      const role = member.role as MembershipRole;
      await runWithDatabaseContext({ orgId, userId: member.userId }, async () => {
        // Expired alerts cannot be opened; keep deduplication receipts one day longer
        // than the seven-day source window so cleanup cannot reissue an old alert.
        await db.execute(sql`delete from ${notification_intents} where id in (
          select id from ${notification_intents} where org_id=${orgId} and user_id=${member.userId}
            and expires_at <= clock_timestamp() order by expires_at limit 100
        )`);
        await db.execute(sql`delete from ${notification_source_receipts} where ctid in (
          select ctid from ${notification_source_receipts} where org_id=${orgId} and user_id=${member.userId}
            and created_at < clock_timestamp() - interval '8 days' order by created_at limit 100
        )`);
        const preferences = await db.select().from(notification_preferences).where(and(
          eq(notification_preferences.org_id, orgId), eq(notification_preferences.user_id, member.userId),
          eq(notification_preferences.enabled_role, role), isNotNull(notification_preferences.enabled_at),
        )).for("update");
        for (const preference of preferences) {
          signal?.throwIfAborted();
          const category = notificationCategory.parse(preference.category);
          if (!notificationCategoryAvailable(role, category)) continue;
          active = true;
          const scope = { org_id: orgId, user_id: member.userId, category, preference_generation: preference.generation };
          // Retain PostgreSQL microseconds at the consent boundary; Date only retains milliseconds.
          const enabledAt = sql`(select ${notification_preferences.enabled_at} from ${notification_preferences}
            where ${notification_preferences.org_id}=${orgId} and ${notification_preferences.user_id}=${member.userId}
              and ${notification_preferences.category}=${category})`;
          const unseen = (key: SQL) => notExists(db.select({ key: notification_source_receipts.source_key }).from(notification_source_receipts).where(and(
            eq(notification_source_receipts.org_id, orgId), eq(notification_source_receipts.user_id, member.userId),
            eq(notification_source_receipts.category, category), eq(notification_source_receipts.preference_generation, preference.generation),
            eq(notification_source_receipts.source_key, key),
          )));
          const save = async (key: string, source: NotificationSource | null) => {
            if (source?.category === category && notificationConsentApplies({ userId: member.userId, workspaceId: orgId, category,
              enabledAt: preference.enabled_at, enabledRole: role }, { userId: member.userId, workspaceId: orgId, role }, category, source.occurredAt)
              && source.occurredAt.getTime() + 7 * 86_400_000 > clock.now.getTime()) {
              const inserted = await db.insert(notification_intents).values({ ...scope, source_key: key, record_kind: source.kind,
                record_id: source.recordId, occurred_at: source.occurredAt, expires_at: sql`${source.occurredAt.toISOString()}::timestamp + interval '7 days'`,
              }).onConflictDoNothing().returning({ id: notification_intents.id });
              created += inserted.length;
            }
            await db.insert(notification_source_receipts).values({ ...scope, source_key: key }).onConflictDoNothing();
            processed++;
          };
          if (category === "assignments" || category === "record_changes") {
            const rows = await db.select().from(audit_logs).where(and(eq(audit_logs.org_id, orgId),
              gte(audit_logs.created_at, enabledAt), gte(audit_logs.created_at, sql`${clock.now.toISOString()}::timestamp - interval '7 days'`), lte(audit_logs.created_at, clock.now),
              inArray(audit_logs.action, ["insert", "update"]), sql`${audit_logs.actor_user_id} is distinct from ${member.userId}`,
              unseen(sql`'audit:' || ${audit_logs.id}`),
            )).orderBy(asc(audit_logs.created_at), asc(audit_logs.id)).limit(100);
            for (const row of rows) await save(`audit:${row.id}`, auditNotificationSources(row, member.userId, orgId).find((source) => source.category === category) ?? null);
          } else if (category === "deadlines") {
            const key = sql`'deadline:' || ${ops_tasks.id} || ':' || ${ops_tasks.due_date}::text`;
            const rows = await db.select().from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), taskIsOpen(),
              sql`${member.userId} = any(${ops_tasks.assignee_ids})`, gte(ops_tasks.due_date, clock.today),
              sql`${ops_tasks.due_date} <= ${clock.today}::date + 1`, unseen(key),
            )).orderBy(ops_tasks.due_date, ops_tasks.id).limit(100);
            for (const row of rows) {
              const source = deadlineNotificationSource(row, member.userId, orgId, clock.today, clock.now);
              if (source) await save(source.sourceKey, source);
            }
          } else {
            const requests = budget_line_variance_requests;
            // Use database text for revision identity; JS Date parsing must not change the source key with host timezone.
            const key = sql<string>`'variance:' || ${requests.id} || ':' || ${requests.status} || ':' || coalesce(${requests.reviewed_at}::text, 'pending')`;
            const rows = await db.select({ request: requests, key }).from(requests).where(and(eq(requests.org_id, orgId),
              category === "requested_reviews" ? eq(requests.status, "pending") : inArray(requests.status, ["approved", "rejected"]),
              category === "requested_reviews" ? sql`${requests.requested_by_user_id} is distinct from ${member.userId}` : eq(requests.requested_by_user_id, member.userId),
              gte(sql`coalesce(${requests.reviewed_at}, ${requests.created_at})`, enabledAt),
              gte(sql`coalesce(${requests.reviewed_at}, ${requests.created_at})`, sql`${clock.now.toISOString()}::timestamp - interval '7 days'`),
              lte(sql`coalesce(${requests.reviewed_at}, ${requests.created_at})`, sql`${clock.now.toISOString()}::timestamp`), unseen(key),
            )).orderBy(requests.created_at, requests.id).limit(100);
            for (const row of rows) await save(row.key, varianceNotificationSource(row.request, member.userId, orgId, role));
          }
        }
        const [remaining] = (await db.execute<{ retained: boolean; cleanup_due: boolean }>(sql`select
          exists(select 1 from ${notification_intents} where org_id=${orgId} and user_id=${member.userId})
          or exists(select 1 from ${notification_source_receipts} where org_id=${orgId} and user_id=${member.userId}) as retained,
          exists(select 1 from ${notification_intents} where org_id=${orgId} and user_id=${member.userId} and expires_at <= clock_timestamp())
          or exists(select 1 from ${notification_source_receipts} where org_id=${orgId} and user_id=${member.userId}
            and created_at < clock_timestamp() - interval '8 days') as cleanup_due`)).rows;
        retained ||= remaining.retained;
        cleanupDue ||= remaining.cleanup_due;
      });
    }
    if (active || retained) await queueNotificationCollection(orgId, active || cleanupDue ? 60 : 86_400);
    return { created, processed, active };
  });
}
