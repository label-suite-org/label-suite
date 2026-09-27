import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { notification_devices, notification_device_attempts } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { sessions } from "../db/auth-schema";
import { HttpError } from "./errors";
import { notificationDeliveryConfigured, notificationTopic } from "./native-notification-apns";

export const notificationDeviceInput = z.object({
  attemptId: z.uuid(),
  token: z.string().max(1024).regex(/^(?:[0-9a-fA-F]{2})+$/).transform((value) => value.toLowerCase()),
  permission: z.literal("authorized"),
}).strict();
export const notificationDeviceRemoval = z.object({ attemptId: z.uuid() }).strict();

export async function registerNotificationDevice(orgId: string, userId: string, sessionId: string, raw: unknown) {
  const input = notificationDeviceInput.parse(raw);
  const environment = process.env.APNS_ENVIRONMENT;
  if (!notificationDeliveryConfigured() || (environment !== "sandbox" && environment !== "production")) throw new HttpError("Notifications are not configured", 503, "notifications_unavailable");
  return runWithDatabaseContext({ orgId, userId }, async () => {
    const [row] = (await db.execute<{ device_id: string; device_generation: number }>(sql`
      select * from label_suite.register_notification_device(${sessionId}, ${input.token}, ${notificationTopic}, ${environment}, ${input.attemptId}::uuid)
    `)).rows;
    if (!row) throw new HttpError("Notification consent or workspace access changed", 403, "notification_registration_denied");
    return { id: row.device_id, generation: row.device_generation };
  });
}

export async function removeNotificationDevice(userId: string, sessionId: string, raw: unknown) {
  const input = notificationDeviceRemoval.parse(raw);
  return runWithDatabaseContext({ userId }, async () => {
    const [session] = await db.select({ id: sessions.id }).from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), sql`${sessions.expiresAt} > clock_timestamp()`)).for("update");
    if (!session) throw new HttpError("Authentication required", 401, "authentication_required");
    // Keep the cancellation even if POST has not arrived or its response was lost.
    await db.insert(notification_device_attempts).values({ session_id: sessionId, user_id: userId, attempt_id: input.attemptId, cancelled: true })
      .onConflictDoUpdate({ target: [notification_device_attempts.session_id, notification_device_attempts.attempt_id], set: { cancelled: true } });
    await db.update(notification_devices).set({ session_id: null, generation: sql`${notification_devices.generation} + 1`, updated_at: sql`clock_timestamp()` })
      .where(and(eq(notification_devices.attempt_id, input.attemptId), eq(notification_devices.user_id, userId), eq(notification_devices.session_id, sessionId)));
    return { ok: true };
  });
}
