import { sql } from "drizzle-orm";
import { boolean, check, index, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";

export const calendar_connections = schema.table("calendar_connections", {
  org_id: text("org_id").primaryKey().references(() => orgs.id),
  google_sub: text("google_sub").notNull(),
  email: text("email").notNull(),
  refresh_token: text("refresh_token"),
  calendar_id: text("calendar_id"),
  calendar_name: text("calendar_name"),
  origin: text("origin").notNull(),
  last_synced_at: timestamp("last_synced_at"),
  error: text("error"),
});

// Retain IDs after source deletion so the linked event can be reviewed safely.
export const calendar_releases = schema.table("calendar_releases", {
  org_id: text("org_id").notNull().references(() => orgs.id),
  release_id: text("release_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (table) => [primaryKey({ columns: [table.org_id, table.release_id] })]);

export const calendar_event_links = schema.table("calendar_event_links", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  release_id: text("release_id").notNull(),
  kind: text("kind", { enum: ["release", "milestone", "task"] }).notNull(),
  item_id: text("item_id").notNull(),
  title: text("title").notNull(),
  event_id: text("event_id").notNull(),
  base_date: text("base_date").notNull(),
  published: boolean("published").notNull().default(false),
  ignored: boolean("ignored").notNull().default(false),
  conflict: text("conflict"),
  google_date: text("google_date"),
  etag: text("etag"),
  resolution: text("resolution", { enum: ["suite", "google"] }),
  resolved_local_date: text("resolved_local_date"),
}, (table) => [
  check("calendar_event_links_kind_check", sql`${table.kind} in ('release', 'milestone', 'task')`),
  check("calendar_event_links_resolution_check", sql`${table.resolution} in ('suite', 'google')`),
  uniqueIndex("calendar_links_item_idx").on(table.org_id, table.kind, table.item_id),
  index("calendar_links_release_idx").on(table.org_id, table.release_id),
]);
