import { and, eq } from "drizzle-orm";
import { dashboard_preferences } from "../db/schema";
import {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  type DashboardPreferences,
} from "../lib/dashboard-preferences";
import { db } from "../lib/db";

export interface DashboardPreferenceOwner {
  orgId: string;
  userId: string;
}

export async function getDashboardPreferences(owner: DashboardPreferenceOwner): Promise<DashboardPreferences> {
  const { orgId, userId } = owner;
  const row = (await db.select({
    schemaVersion: dashboard_preferences.schema_version,
    pinnedIndicatorIds: dashboard_preferences.pinned_indicator_ids,
    sectionOrder: dashboard_preferences.section_order,
    hiddenSectionIds: dashboard_preferences.hidden_section_ids,
  }).from(dashboard_preferences).where(and(
    eq(dashboard_preferences.org_id, orgId),
    eq(dashboard_preferences.user_id, userId),
  )).limit(1))[0];

  return row
    ? normalizeDashboardPreferences(row, { stored: true })
    : defaultDashboardPreferences();
}

export async function saveDashboardPreferences(
  owner: DashboardPreferenceOwner,
  input: unknown,
): Promise<DashboardPreferences> {
  const { orgId, userId } = owner;
  const preferences = normalizeDashboardPreferences(input);
  const now = new Date();
  await db.insert(dashboard_preferences).values({
    id: `${orgId}:${userId}`,
    org_id: orgId,
    user_id: userId,
    schema_version: preferences.schemaVersion,
    pinned_indicator_ids: preferences.pinnedIndicatorIds,
    section_order: preferences.sectionOrder,
    hidden_section_ids: preferences.hiddenSectionIds,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: [dashboard_preferences.org_id, dashboard_preferences.user_id],
    set: {
      schema_version: preferences.schemaVersion,
      pinned_indicator_ids: preferences.pinnedIndicatorIds,
      section_order: preferences.sectionOrder,
      hidden_section_ids: preferences.hiddenSectionIds,
      updated_at: now,
    },
  });
  return preferences;
}

export async function resetDashboardPreferences(owner: DashboardPreferenceOwner): Promise<DashboardPreferences> {
  const { orgId, userId } = owner;
  await db.delete(dashboard_preferences).where(and(
    eq(dashboard_preferences.org_id, orgId),
    eq(dashboard_preferences.user_id, userId),
  ));
  return defaultDashboardPreferences();
}
