import { sql } from "drizzle-orm";
import { text, integer, timestamp, date, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { users } from "../auth-schema";
import { orgs, contacts } from "./foundation";
import { artists, releases } from "./catalog";
import { budget_projects } from "./finance";

// ─── Media Assets ───────────────────────────────────────
export const media_assets = schema.table("media_assets", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  asset_name: text("asset_name").notNull(),
  asset_type: text("asset_type"),
  linked_artist_id: text("linked_artist_id").references(() => artists.id),
  linked_release_id: text("linked_release_id").references(() => releases.id),
  project_id: text("project_id").references(() => budget_projects.id, { onDelete: "set null" }),
  version: text("version"),
  approval_status: text("approval_status").default("pending"),
  delivery_status: text("delivery_status").default("not_sent"),
  file_link: text("file_link"),
  notes: text("notes"),
  date_uploaded: date("date_uploaded"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("media_assets_org_id_idx").on(table.org_id),
  index("media_assets_linked_artist_id_idx").on(table.linked_artist_id),
  index("media_assets_linked_release_id_idx").on(table.linked_release_id),
  index("media_assets_approval_status_idx").on(table.approval_status),
  index("media_assets_org_project_idx").on(table.org_id, table.project_id),
]);

export const media_asset_files = schema.table("media_asset_files", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  media_asset_id: text("media_asset_id").references(() => media_assets.id),
  source_postgres_table: text("source_postgres_table"),
  source_postgres_record_id: text("source_postgres_record_id"),
  airtable_base_id: text("airtable_base_id"),
  airtable_table_name: text("airtable_table_name"),
  airtable_record_id: text("airtable_record_id"),
  airtable_field_name: text("airtable_field_name"),
  airtable_attachment_id: text("airtable_attachment_id"),
  file_name: text("file_name").notNull(),
  content_type: text("content_type"),
  file_size: integer("file_size"),
  source_url: text("source_url"),
  storage_bucket: text("storage_bucket").notNull(),
  storage_key: text("storage_key").notNull(),
  storage_etag: text("storage_etag"),
  copied_at: timestamp("copied_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("media_asset_files_org_id_idx").on(table.org_id),
  index("media_asset_files_media_asset_id_idx").on(table.media_asset_id),
  index("media_asset_files_source_idx").on(table.source_postgres_table, table.source_postgres_record_id),
  uniqueIndex("media_asset_files_airtable_attachment_unique_idx").on(
    table.org_id,
    table.airtable_base_id,
    table.airtable_table_name,
    table.airtable_record_id,
    table.airtable_attachment_id,
  ).where(sql`${table.airtable_attachment_id} is not null`),
  uniqueIndex("media_asset_files_storage_key_unique_idx").on(table.storage_bucket, table.storage_key),
]);

// ─── Documents ─────────────────────────────────────────
export const documents = schema.table("documents", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  doc_type: text("doc_type"),
  release_id: text("release_id").references(() => releases.id),
  artist_id: text("artist_id").references(() => artists.id),
  contact_id: text("contact_id").references(() => contacts.id),
  project_id: text("project_id").references(() => budget_projects.id, { onDelete: "set null" }),
  status: text("status").default("draft"),
  file_link: text("file_link"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("documents_org_id_idx").on(table.org_id),
  index("documents_release_id_idx").on(table.release_id),
  index("documents_artist_id_idx").on(table.artist_id),
  index("documents_contact_id_idx").on(table.contact_id),
  index("documents_status_idx").on(table.status),
  index("documents_org_project_idx").on(table.org_id, table.project_id),
]);

// Pending private captures are separate from finalized canonical attachments.
export const resource_upload_intents = schema.table("resource_upload_intents", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  actor_user_id: text("actor_user_id").notNull().references(() => users.id),
  client_request_id: text("client_request_id").notNull(),
  request: jsonb("request").notNull(),
  storage_bucket: text("storage_bucket").notNull(),
  storage_key: text("storage_key").notNull(),
  status: text("status").notNull().default("prepared"),
  resource_id: text("resource_id"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("resource_upload_intents_request_idx").on(table.org_id, table.actor_user_id, table.client_request_id),
  uniqueIndex("resource_upload_intents_object_idx").on(table.storage_bucket, table.storage_key),
  check("resource_upload_intents_state_check", sql`(${table.status} = 'prepared' AND ${table.resource_id} IS NULL) OR (${table.status} = 'completed' AND ${table.resource_id} IS NOT NULL)`),
  check("resource_upload_intents_request_check", sql`jsonb_typeof(${table.request}) = 'object'`),
]);
