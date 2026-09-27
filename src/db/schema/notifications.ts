import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { org_memberships } from "./foundation";
import { sessions, users } from "../auth-schema";

export const notification_preferences = schema.table("notification_preferences", {
  org_id: text("org_id").notNull(),
  user_id: text("user_id").notNull(),
  category: text("category").notNull(),
  enabled_at: timestamp("enabled_at"),
  enabled_role: text("enabled_role").notNull(),
  generation: integer("generation").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.org_id, table.user_id, table.category] }),
  foreignKey({ columns: [table.org_id, table.user_id], foreignColumns: [org_memberships.org_id, org_memberships.user_id] }).onDelete("cascade"),
  check("notification_preferences_category_check", sql`${table.category} in ('assignments', 'deadlines', 'requested_reviews', 'approval_results', 'record_changes')`),
  check("notification_preferences_generation_check", sql`${table.generation} > 0`),
]);

export const notification_source_receipts = schema.table("notification_source_receipts", {
  org_id: text("org_id").notNull(), user_id: text("user_id").notNull(), category: text("category").notNull(),
  preference_generation: integer("preference_generation").notNull(), source_key: text("source_key").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.org_id, table.user_id, table.category, table.preference_generation, table.source_key] }),
  index("notification_source_retention_idx").on(table.org_id, table.user_id, table.created_at),
  foreignKey({ columns: [table.org_id, table.user_id, table.category], foreignColumns: [notification_preferences.org_id, notification_preferences.user_id, notification_preferences.category] }).onDelete("cascade"),
]);

export const notification_intents = schema.table("notification_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  org_id: text("org_id").notNull(), user_id: text("user_id").notNull(), category: text("category").notNull(),
  preference_generation: integer("preference_generation").notNull(), source_key: text("source_key").notNull(),
  record_kind: text("record_kind").notNull(), record_id: text("record_id").notNull(),
  occurred_at: timestamp("occurred_at").notNull(), expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notification_intent_source_idx").on(table.org_id, table.user_id, table.category, table.preference_generation, table.source_key),
  uniqueIndex("notification_intent_owner_idx").on(table.id, table.org_id, table.user_id),
  index("notification_intent_expiry_idx").on(table.org_id, table.user_id, table.expires_at),
  foreignKey({ columns: [table.org_id, table.user_id, table.category], foreignColumns: [notification_preferences.org_id, notification_preferences.user_id, notification_preferences.category] }).onDelete("cascade"),
]);

export const notification_device_attempts = schema.table("notification_device_attempts", {
  session_id: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  attempt_id: uuid("attempt_id").notNull(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cancelled: boolean("cancelled").notNull().default(false),
  registered: boolean("registered").notNull().default(false),
}, (table) => [primaryKey({ columns: [table.session_id, table.attempt_id] })]);

export const notification_devices = schema.table("notification_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  session_id: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  attempt_id: uuid("attempt_id"),
  token: text("token").notNull(),
  topic: text("topic").notNull(),
  environment: text("environment").notNull(),
  generation: integer("generation").notNull().default(1),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notification_device_attempt_idx").on(table.session_id, table.attempt_id),
  uniqueIndex("notification_device_token_idx").on(table.topic, table.environment, table.token),
  check("notification_device_environment_check", sql`${table.environment} in ('sandbox', 'production')`),
  check("notification_device_token_check", sql`length(${table.token}) <= 1024 AND ${table.token} ~ '^([0-9a-f]{2})+$'`),
  check("notification_device_generation_check", sql`${table.generation} > 0`),
]);

export const notification_deliveries = schema.table("notification_deliveries", {
  intent_id: uuid("intent_id").notNull(), device_id: uuid("device_id").notNull().references(() => notification_devices.id, { onDelete: "cascade" }),
  device_generation: integer("device_generation").notNull(), org_id: text("org_id").notNull(), user_id: text("user_id").notNull(),
  status: text("status").notNull(), attempts: integer("attempts").notNull().default(1),
  next_attempt_at: timestamp("next_attempt_at").notNull().defaultNow(), updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.intent_id, table.device_id, table.device_generation] }),
  foreignKey({ columns: [table.intent_id, table.org_id, table.user_id], foreignColumns: [notification_intents.id, notification_intents.org_id, notification_intents.user_id] }).onDelete("cascade"),
  check("notification_delivery_status_check", sql`${table.status} in ('accepted','rejected','suppressed','invalid_device','retry')`),
  check("notification_delivery_attempts_check", sql`${table.attempts} > 0 AND ${table.device_generation} > 0`),
]);
