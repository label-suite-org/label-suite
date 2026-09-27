import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { notification_preferences, org_memberships } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { HttpError } from "./errors";
import { notificationCategory, notificationCategoryAvailable } from "./native-notifications-core";
import { queueNotificationCollection } from "./native-notification-collection";
import { notificationDeliveryConfigured } from "./native-notification-apns";

const roleSchema = z.enum(["owner", "operator", "fundraiser", "member", "payee"]);
export const notificationPreferenceInput = z.object({
  category: notificationCategory,
  enabled: z.boolean(),
  expectedGeneration: z.number().int().min(0).max(2_147_483_646),
}).strict();

export async function nativeNotificationPreferences(orgId: string, userId: string, raw?: unknown) {
  const input = raw === undefined ? undefined : notificationPreferenceInput.parse(raw);
  return runWithDatabaseContext({ orgId, userId }, async () => {
    // Shared membership lock orders preference writes against role change/removal.
    const [membership] = await db.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId))).for("update");
    if (!membership) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    const role = roleSchema.parse(membership.role);
    const scope = and(eq(notification_preferences.org_id, orgId), eq(notification_preferences.user_id, userId));
    const rows = await db.select().from(notification_preferences).where(scope);
    if (input) {
      if (!notificationCategoryAvailable(role, input.category)) throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
      const stored = rows.find((row) => row.category === input.category);
      if ((stored?.generation ?? 0) !== input.expectedGeneration) throw new HttpError("Preferences changed. Refresh before saving.", 409, "stale_preferences");
      const currentlyEnabled = stored?.enabled_at != null && stored.enabled_role === role;
      if (currentlyEnabled !== input.enabled) {
        const values = { enabled_at: input.enabled ? sql`clock_timestamp()` : null, enabled_role: role, generation: (stored?.generation ?? 0) + 1 };
        if (stored) await db.update(notification_preferences).set(values).where(and(scope, eq(notification_preferences.category, input.category)));
        else await db.insert(notification_preferences).values({ org_id: orgId, user_id: userId, category: input.category, ...values });
        if (input.enabled) await queueNotificationCollection(orgId);
      }
    }
    const current = input ? await db.select().from(notification_preferences).where(scope) : rows;
    return { workspaceId: orgId, deliveryConfigured: notificationDeliveryConfigured(), categories: notificationCategory.options.filter((category) => notificationCategoryAvailable(role, category)).map((category) => {
      const stored = current.find((row) => row.category === category);
      return { category, enabled: stored?.enabled_at != null && stored.enabled_role === role, generation: stored?.generation ?? 0 };
    }) };
  });
}
