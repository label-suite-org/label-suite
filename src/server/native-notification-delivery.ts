import { and, eq, isNull, or, sql } from "drizzle-orm";
import { sessions } from "../db/auth-schema";
import { notification_deliveries, notification_devices, notification_intents, notification_preferences, org_memberships } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { notificationDeliveryConfigured, notificationTopic, sendNativeNotification } from "./native-notification-apns";
import { resolveNativeNotification } from "./native-notification-resolution";

const batchSize = 20;

/** Each device outcome commits independently; APNs acceptance is not workflow completion. */
export async function dispatchNativeNotifications(orgId: string, signal?: AbortSignal) {
  const counts = { accepted: 0, retry: 0, rejected: 0, invalid_device: 0, suppressed: 0, skipped: 0, unavailable: false };
  if (!notificationDeliveryConfigured()) return { ...counts, unavailable: true };
  const environment = process.env.APNS_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "production") return { ...counts, unavailable: true };
  try {
    const members = await runWithDatabaseContext({ orgId, userId: "" }, () => db.select({ userId: org_memberships.user_id }).from(org_memberships).where(eq(org_memberships.org_id, orgId)));
    const candidates: { userId: string; intentId: string; deviceId: string; generation: number; sessionId: string | null; createdAt: Date }[] = [];
    // ponytail: merge each recipient's oldest bounded window; move this scan if workspace membership makes it expensive.
    for (const member of members) {
      signal?.throwIfAborted();
      const rows = await runWithDatabaseContext({ orgId, userId: member.userId }, () => db.select({
        userId: notification_intents.user_id, intentId: notification_intents.id, deviceId: notification_devices.id,
        generation: notification_devices.generation, sessionId: notification_devices.session_id, createdAt: notification_intents.created_at,
      }).from(notification_intents)
        .innerJoin(notification_preferences, and(eq(notification_preferences.org_id, notification_intents.org_id), eq(notification_preferences.user_id, notification_intents.user_id),
          eq(notification_preferences.category, notification_intents.category), eq(notification_preferences.generation, notification_intents.preference_generation), sql`${notification_preferences.enabled_at} is not null`))
        .innerJoin(notification_devices, eq(notification_devices.user_id, notification_intents.user_id))
        .innerJoin(sessions, and(eq(sessions.id, notification_devices.session_id), eq(sessions.userId, member.userId), sql`${sessions.expiresAt} > clock_timestamp()`))
        .leftJoin(notification_deliveries, and(eq(notification_deliveries.intent_id, notification_intents.id), eq(notification_deliveries.device_id, notification_devices.id), eq(notification_deliveries.device_generation, notification_devices.generation)))
        .where(and(eq(notification_intents.org_id, orgId), eq(notification_intents.user_id, member.userId), sql`${notification_intents.expires_at} > clock_timestamp()`,
          eq(notification_devices.topic, notificationTopic), eq(notification_devices.environment, environment),
          or(isNull(notification_deliveries.intent_id), and(eq(notification_deliveries.status, "retry"), sql`${notification_deliveries.next_attempt_at} <= clock_timestamp()`)),
        )).orderBy(notification_intents.created_at, notification_intents.id, notification_devices.id).limit(batchSize));
      candidates.push(...rows);
    }
    candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.intentId.localeCompare(b.intentId) || a.deviceId.localeCompare(b.deviceId));
    for (const candidate of candidates.slice(0, batchSize)) {
      signal?.throwIfAborted();
      const outcome = await runWithDatabaseContext({ orgId, userId: candidate.userId }, async () => {
        if (!candidate.sessionId) return "skipped" as const;
        // Same lock order as registration: session, membership, intent, consent, device.
        const [session] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(and(
          eq(sessions.id, candidate.sessionId), eq(sessions.userId, candidate.userId), sql`${sessions.expiresAt} > clock_timestamp()`,
        )).for("share");
        if (!session) return "skipped" as const;
        const resolution = await resolveNativeNotification(candidate.userId, candidate.sessionId, candidate.intentId, orgId);
        const [intent] = await db.select({ expiresAt: notification_intents.expires_at }).from(notification_intents).where(and(
          eq(notification_intents.id, candidate.intentId), eq(notification_intents.org_id, orgId), eq(notification_intents.user_id, candidate.userId),
          sql`${notification_intents.expires_at} > clock_timestamp()`,
        )).for("key share");
        if (!intent) return "skipped" as const;
        const [device] = await db.select().from(notification_devices).where(and(
          eq(notification_devices.id, candidate.deviceId), eq(notification_devices.user_id, candidate.userId), eq(notification_devices.session_id, candidate.sessionId),
          eq(notification_devices.generation, candidate.generation), eq(notification_devices.topic, notificationTopic), eq(notification_devices.environment, environment),
        )).for("update", { skipLocked: true });
        if (!device) return "skipped" as const;
        const receiptScope = and(eq(notification_deliveries.intent_id, candidate.intentId), eq(notification_deliveries.device_id, device.id), eq(notification_deliveries.device_generation, device.generation));
        const [receipt] = await db.select({ status: notification_deliveries.status, ready: sql<boolean>`${notification_deliveries.next_attempt_at} <= clock_timestamp()` }).from(notification_deliveries).where(receiptScope);
        if (receipt && (receipt.status !== "retry" || !receipt.ready)) return "skipped" as const;
        signal?.throwIfAborted();
        const result = resolution.status === "available" && resolution.destination.workspaceId === orgId
          ? await sendNativeNotification({ notificationId: candidate.intentId, token: device.token, environment,
            expiresAt: new Date(Math.min(intent.expiresAt.getTime(), session.expiresAt.getTime())),
          }, signal)
          : { status: "suppressed" as const };
        if (result.status === "unavailable") return "unavailable" as const;
        if (result.status === "invalid_device" && (result.invalidatedAt === null || result.invalidatedAt >= device.updated_at.getTime())) {
          await db.update(notification_devices).set({ session_id: null, generation: device.generation + 1, updated_at: sql`clock_timestamp()` })
            .where(and(eq(notification_devices.id, device.id), eq(notification_devices.user_id, candidate.userId), eq(notification_devices.generation, device.generation)));
        }
        const status = result.status === "expired" ? "suppressed" as const : result.status;
        const nextAttempt = sql`clock_timestamp() + ${result.status === "retry" ? result.retryAfterSeconds : 0} * interval '1 second'`;
        await db.insert(notification_deliveries).values({ intent_id: candidate.intentId, device_id: device.id, device_generation: device.generation,
          org_id: orgId, user_id: candidate.userId, status, next_attempt_at: nextAttempt,
        }).onConflictDoUpdate({ target: [notification_deliveries.intent_id, notification_deliveries.device_id, notification_deliveries.device_generation],
          set: { status, attempts: sql`${notification_deliveries.attempts} + 1`, next_attempt_at: nextAttempt, updated_at: sql`clock_timestamp()` },
        });
        return status;
      });
      if (outcome === "unavailable") { counts.unavailable = true; break; }
      counts[outcome]++;
    }
    return counts;
  } catch {
    // Provider/driver errors must never write a device token into durable job logs.
    throw new Error(signal?.aborted ? "Notification delivery cancelled" : "Notification delivery failed");
  }
}
