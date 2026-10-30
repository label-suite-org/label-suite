import { sql } from "drizzle-orm";
import { text, integer, boolean, timestamp, date, jsonb, index, check } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { releases } from "./catalog";
import { campaigns } from "./marketing";
import { sync_deals } from "./sync";
import { ops_tasks } from "./operations";
import type { PitchRecording } from "../../lib/pitches";

export const pitches = schema.table("pitches", {
  id: text("id").primaryKey(), org_id: text("org_id").notNull().references(() => orgs.id),
  campaign_id: text("campaign_id").references(() => campaigns.id),
  sync_deal_id: text("sync_deal_id").references(() => sync_deals.id),
  release_id: text("release_id").notNull().references(() => releases.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  task_id: text("task_id").references(() => ops_tasks.id),
  version: integer("version").notNull().default(1),
  title: text("title").notNull(), message: text("message").notNull(),
  credits: text("credits").notNull(), rights_note: text("rights_note").notNull(),
  reply_email: text("reply_email").notNull(), artist_name: text("artist_name").notNull(),
  artwork_url: text("artwork_url"), remote_project_id: text("remote_project_id").notNull(),
  recordings: jsonb("recordings").$type<PitchRecording[]>().notNull(),
  downloads: boolean("downloads").notNull().default(false),
  token: text("token").notNull(), player_id: text("player_id"), player_embed_id: text("player_embed_id"),
  link_state: text("link_state").notNull().default("draft"),
  status: text("status").notNull().default("draft"), sent_date: date("sent_date"),
  response_note: text("response_note").notNull().default(""),
  created_at: timestamp("created_at").notNull().defaultNow(), updated_at: timestamp("updated_at").notNull().defaultNow(),
}, table => [
  index("pitches_org_campaign_idx").on(table.org_id, table.campaign_id),
  index("pitches_org_sync_idx").on(table.org_id, table.sync_deal_id),
  check("pitches_context", sql`num_nonnulls(${table.campaign_id}, ${table.sync_deal_id}) = 1`),
  check("pitches_link_state", sql`${table.link_state} in ('draft', 'preparing', 'ready', 'revoking', 'revoked')`),
  check("pitches_status", sql`${table.status} in ('draft', 'sent', 'replied', 'closed')`),
]);
