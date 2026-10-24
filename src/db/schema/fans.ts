import { sql } from "drizzle-orm";
import { text, integer, boolean, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";
import { artists, releases } from "./catalog";
import type { DropContent, PublishedDrop } from "../../server/fan-drops-core";

export const fan_drops = schema.table("fan_drops", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  artist_id: text("artist_id").notNull().references(() => artists.id), release_id: text("release_id").references(() => releases.id),
  slug: text("slug").notNull(), revision: integer("revision").notNull().default(1),
  content: jsonb("content").$type<DropContent>().notNull(),
  published: jsonb("published").$type<PublishedDrop>(), published_revision: integer("published_revision"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("fan_drops_org_slug_unique").on(table.org_id, table.slug), index("fan_drops_artist_idx").on(table.org_id, table.artist_id),
  check("fan_drops_publication_check", sql`(${table.published} is null) = (${table.published_revision} is null)`)]);
export const fans = schema.table("fans", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id), email: text("email").notNull(),
  provider_suppressed: boolean("provider_suppressed").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("fans_org_email_unique").on(table.org_id, table.email), check("fans_email_normalized", sql`${table.email} = lower(trim(${table.email}))`)]);
export const fan_subscriptions = schema.table("fan_subscriptions", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  fan_id: text("fan_id").notNull().references(() => fans.id, { onDelete: "cascade" }), artist_id: text("artist_id").notNull().references(() => artists.id),
  name: text("name").notNull().default(""), city: text("city").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("pending"), consent_text: text("consent_text"),
  consent_revision: integer("consent_revision"), consent_at: timestamp("consent_at", { withTimezone: true }),
  confirmed_at: timestamp("confirmed_at", { withTimezone: true }), revoked_at: timestamp("revoked_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("fan_subscriptions_scope_unique").on(table.org_id, table.fan_id, table.artist_id),
  index("fan_subscriptions_audience_idx").on(table.org_id, table.artist_id, table.status),
  check("fan_subscriptions_status_check", sql`${table.status} in ('pending','confirmed','unsubscribed')`),
  check("fan_subscriptions_consent_check", sql`${table.status} <> 'confirmed' or (${table.consent_at} is not null and ${table.confirmed_at} is not null and ${table.consent_text} is not null and ${table.revoked_at} is null)`)]);
export const fan_signups = schema.table("fan_signups", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  drop_id: text("drop_id").notNull().references(() => fan_drops.id),
  subscription_id: text("subscription_id").notNull().references(() => fan_subscriptions.id, { onDelete: "cascade" }),
  name: text("name").notNull(), city: text("city").notNull(), show_id: text("show_id"),
  consent_text: text("consent_text").notNull(), published_revision: integer("published_revision").notNull(),
  confirmed_at: timestamp("confirmed_at", { withTimezone: true }), expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  success_url: text("success_url"), success_label: text("success_label").notNull().default("Continue"),
  email_status: text("email_status").notNull().default("queued"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("fan_signups_drop_idx").on(table.org_id, table.drop_id, table.subscription_id),
  check("fan_signups_email_status_check", sql`${table.email_status} in ('queued','sending','submitted','unknown','failed','suppressed')`)]);
export const fan_rate_limits = schema.table("fan_rate_limits", {
  org_id: text("org_id").notNull().references(() => orgs.id), key: text("key").notNull(),
  window_start: timestamp("window_start", { withTimezone: true }).notNull(), count: integer("count").notNull(),
}, table => [uniqueIndex("fan_rate_limits_key_unique").on(table.org_id, table.key)]);

export const fan_messages = schema.table("fan_messages", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  artist_id: text("artist_id").notNull().references(() => artists.id), revision: integer("revision").notNull().default(1),
  audience: jsonb("audience").$type<import("../../server/fan-drops-core").FanAudience>().notNull(),
  content: jsonb("content").$type<import("../../server/fan-messages-core").FanMessageContent>().notNull(),
  status: text("status").notNull().default("draft"), scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
  recipient_ids: jsonb("recipient_ids").$type<string[]>().notNull().default([]), recipient_count: integer("recipient_count").notNull().default(0),
  test_recipient: text("test_recipient"),
  provider_list_id: integer("provider_list_id"), provider_campaign_id: integer("provider_campaign_id"),
  report: jsonb("report").$type<import("../../server/fan-messages-core").FanMessageReport>(), failure_code: text("failure_code"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("fan_messages_artist_idx").on(table.org_id, table.artist_id), uniqueIndex("fan_messages_provider_unique").on(table.org_id, table.provider_campaign_id),
  check("fan_messages_status_check", sql`${table.status} in ('draft','scheduled','preparing','submitting','submitted','sent','cancelled','review')`)]);
export const fan_activity = schema.table("fan_activity", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  message_id: text("message_id").notNull().references(() => fan_messages.id),
  subscription_id: text("subscription_id").notNull().references(() => fan_subscriptions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, table => [index("fan_activity_subscription_idx").on(table.org_id, table.subscription_id, table.occurred_at)]);
