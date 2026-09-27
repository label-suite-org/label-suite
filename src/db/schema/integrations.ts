import { sql } from "drizzle-orm";
import { text, timestamp, boolean, index, uniqueIndex, jsonb, integer, check } from "drizzle-orm/pg-core";
import { users } from "../auth-schema";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";
import { releases, works, tracks } from "./catalog";
import { campaigns } from "./marketing";
import { media_assets, documents } from "./assets";
import { ops_tasks } from "./operations";

// ─── Shared Integration Substrate ──────────────────────
export const integration_providers = schema.table("integration_providers", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  auth_type: text("auth_type").notNull().default("none"),
  status: text("status").notNull().default("planned"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("integration_providers_org_key_unique_idx").on(table.org_id, table.key),
  index("integration_providers_org_id_idx").on(table.org_id),
  index("integration_providers_category_idx").on(table.org_id, table.category),
  index("integration_providers_status_idx").on(table.org_id, table.status),
  check("integration_providers_auth_type_check", sql`${table.auth_type} in ('api_key', 'oauth', 'manual_import', 'webhook', 'none')`),
  check("integration_providers_status_check", sql`${table.status} in ('planned', 'private_beta', 'active', 'deprecated')`),
]);

export const integration_connections = schema.table("integration_connections", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  provider_id: text("provider_id").notNull().references(() => integration_providers.id),
  label: text("label").notNull(),
  status: text("status").notNull().default("connected"),
  auth_ref: text("auth_ref"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  last_checked_at: timestamp("last_checked_at"),
  last_successful_sync_at: timestamp("last_successful_sync_at"),
  created_by: text("created_by").references(() => users.id),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("integration_connections_org_provider_label_unique_idx").on(table.org_id, table.provider_id, table.label),
  index("integration_connections_org_id_idx").on(table.org_id),
  index("integration_connections_provider_id_idx").on(table.provider_id),
  index("integration_connections_status_idx").on(table.org_id, table.status),
  check("integration_connections_status_check", sql`${table.status} in ('connected', 'needs_attention', 'paused', 'revoked')`),
]);

export const external_object_links = schema.table("external_object_links", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").notNull().references(() => integration_connections.id),
  provider_key: text("provider_key").notNull(),
  external_object_type: text("external_object_type").notNull(),
  external_object_id: text("external_object_id").notNull(),
  external_object_url: text("external_object_url"),
  label_suite_object_type: text("label_suite_object_type").notNull(),
  label_suite_object_id: text("label_suite_object_id").notNull(),
  match_method: text("match_method").notNull().default("manual"),
  match_confidence: integer("match_confidence"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("external_object_links_external_unique_idx").on(table.org_id, table.connection_id, table.external_object_type, table.external_object_id),
  index("external_object_links_org_id_idx").on(table.org_id),
  index("external_object_links_connection_id_idx").on(table.connection_id),
  index("external_object_links_provider_object_idx").on(table.org_id, table.provider_key, table.external_object_type),
  index("external_object_links_label_suite_object_idx").on(table.org_id, table.label_suite_object_type, table.label_suite_object_id),
  index("external_object_links_status_idx").on(table.org_id, table.status),
  check("external_object_links_match_method_check", sql`${table.match_method} in ('manual', 'isrc', 'upc', 'title_artist', 'provider_callback', 'import_rule')`),
  check("external_object_links_status_check", sql`${table.status} in ('active', 'needs_review', 'ignored', 'archived')`),
  check("external_object_links_confidence_check", sql`${table.match_confidence} is null or (${table.match_confidence} >= 0 and ${table.match_confidence} <= 100)`),
]);

export const sync_jobs = schema.table("sync_jobs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").notNull().references(() => integration_connections.id),
  provider_key: text("provider_key").notNull(),
  job_type: text("job_type").notNull(),
  status: text("status").notNull().default("queued"),
  started_at: timestamp("started_at"),
  finished_at: timestamp("finished_at"),
  cursor_before: text("cursor_before"),
  cursor_after: text("cursor_after"),
  records_seen: integer("records_seen").notNull().default(0),
  records_created: integer("records_created").notNull().default(0),
  records_updated: integer("records_updated").notNull().default(0),
  records_failed: integer("records_failed").notNull().default(0),
  triggered_by: text("triggered_by"),
  idempotency_key: text("idempotency_key").notNull(),
  error_summary: text("error_summary"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("sync_jobs_org_connection_idempotency_unique_idx").on(table.org_id, table.connection_id, table.idempotency_key),
  index("sync_jobs_org_created_idx").on(table.org_id, table.created_at),
  index("sync_jobs_connection_created_idx").on(table.connection_id, table.created_at),
  index("sync_jobs_provider_status_idx").on(table.org_id, table.provider_key, table.status),
  check("sync_jobs_job_type_check", sql`${table.job_type} in ('pull', 'push', 'webhook', 'manual_import', 'export', 'reconcile')`),
  check("sync_jobs_status_check", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled')`),
  check("sync_jobs_counts_check", sql`${table.records_seen} >= 0 and ${table.records_created} >= 0 and ${table.records_updated} >= 0 and ${table.records_failed} >= 0`),
]);

/**
 * Immutable, tenant-scoped record of a release delivery export.  The
 * payload_version identifies the contract and patch_version identifies a
 * correction to the same release/account export.  A corrected payload is a
 * new row; prior payloads and response evidence are never overwritten.
 */
export const release_delivery_attempts = schema.table("release_delivery_attempts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  release_id: text("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  provider_key: text("provider_key").notNull(),
  account_label: text("account_label").notNull(),
  payload_version: integer("payload_version").notNull().default(1),
  patch_version: integer("patch_version").notNull().default(1),
  status: text("status").notNull().default("exported"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payload_hash: text("payload_hash").notNull(),
  response_evidence: jsonb("response_evidence").$type<Record<string, unknown>>().notNull().default({}),
  sync_job_id: text("sync_job_id").references(() => sync_jobs.id),
  error_code: text("error_code"),
  error_message: text("error_message"),
  created_by: text("created_by").references(() => users.id),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("release_delivery_attempts_version_unique_idx").on(
    table.org_id,
    table.release_id,
    table.provider_key,
    table.account_label,
    table.payload_version,
    table.patch_version,
  ),
  index("release_delivery_attempts_org_created_idx").on(table.org_id, table.created_at),
  index("release_delivery_attempts_release_idx").on(table.org_id, table.release_id, table.created_at),
  index("release_delivery_attempts_status_idx").on(table.org_id, table.status),
  check("release_delivery_attempts_version_check", sql`${table.payload_version} > 0 and ${table.patch_version} > 0`),
  check("release_delivery_attempts_status_check", sql`${table.status} in ('exported', 'submitted', 'accepted', 'failed', 'superseded')`),
]);

export const raw_integration_events = schema.table("raw_integration_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").notNull().references(() => integration_connections.id),
  sync_job_id: text("sync_job_id").references(() => sync_jobs.id),
  provider_key: text("provider_key").notNull(),
  event_type: text("event_type").notNull(),
  external_object_type: text("external_object_type"),
  external_object_id: text("external_object_id"),
  idempotency_key: text("idempotency_key").notNull(),
  occurred_at: timestamp("occurred_at"),
  received_at: timestamp("received_at").notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payload_hash: text("payload_hash").notNull(),
  processing_status: text("processing_status").notNull().default("pending"),
  processing_error: text("processing_error"),
}, (table) => [
  uniqueIndex("raw_integration_events_org_connection_idempotency_unique_idx").on(table.org_id, table.connection_id, table.idempotency_key),
  index("raw_integration_events_org_received_idx").on(table.org_id, table.received_at),
  index("raw_integration_events_sync_job_idx").on(table.sync_job_id),
  index("raw_integration_events_provider_type_idx").on(table.org_id, table.provider_key, table.event_type),
  index("raw_integration_events_payload_hash_idx").on(table.org_id, table.connection_id, table.payload_hash),
  index("raw_integration_events_processing_status_idx").on(table.org_id, table.processing_status),
  check("raw_integration_events_processing_status_check", sql`${table.processing_status} in ('pending', 'processed', 'failed', 'ignored')`),
]);

export const integration_errors = schema.table("integration_errors", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").notNull().references(() => integration_connections.id),
  sync_job_id: text("sync_job_id").references(() => sync_jobs.id),
  severity: text("severity").notNull().default("warning"),
  code: text("code"),
  message: text("message").notNull(),
  external_object_type: text("external_object_type"),
  external_object_id: text("external_object_id"),
  resolved_at: timestamp("resolved_at"),
  resolved_by: text("resolved_by").references(() => users.id),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("integration_errors_org_created_idx").on(table.org_id, table.created_at),
  index("integration_errors_connection_severity_idx").on(table.connection_id, table.severity),
  index("integration_errors_resolution_idx").on(table.org_id, table.resolved_at),
  check("integration_errors_severity_check", sql`${table.severity} in ('info', 'warning', 'error', 'critical')`),
]);

export const data_quality_issues = schema.table("data_quality_issues", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").references(() => integration_connections.id),
  sync_job_id: text("sync_job_id").references(() => sync_jobs.id),
  source: text("source").notNull(),
  issue_type: text("issue_type").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  priority: text("priority").notNull().default("P2"),
  status: text("status").notNull().default("open"),
  label_suite_object_type: text("label_suite_object_type"),
  label_suite_object_id: text("label_suite_object_id"),
  external_object_type: text("external_object_type"),
  external_object_id: text("external_object_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("data_quality_issues_org_priority_status_idx").on(table.org_id, table.priority, table.status),
  index("data_quality_issues_source_idx").on(table.org_id, table.source),
  index("data_quality_issues_connection_idx").on(table.connection_id),
  index("data_quality_issues_label_suite_object_idx").on(table.org_id, table.label_suite_object_type, table.label_suite_object_id),
  uniqueIndex("data_quality_issues_org_idempotency_unique_idx").on(table.org_id, table.idempotency_key),
  check("data_quality_issues_priority_check", sql`${table.priority} in ('P0', 'P1', 'P2', 'P3')`),
  check("data_quality_issues_status_check", sql`${table.status} in ('open', 'triaged', 'resolved', 'ignored')`),
]);

export const audit_events = schema.table("audit_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  actor_user_id: text("actor_user_id").references(() => users.id),
  actor_type: text("actor_type").notNull().default("user"),
  event_type: text("event_type").notNull(),
  object_type: text("object_type").notNull(),
  object_id: text("object_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("audit_events_org_created_idx").on(table.org_id, table.created_at),
  index("audit_events_event_type_idx").on(table.org_id, table.event_type),
  index("audit_events_object_idx").on(table.org_id, table.object_type, table.object_id),
  check("audit_events_actor_type_check", sql`${table.actor_type} in ('user', 'system', 'integration')`),
]);

// ─── Samply Review & Delivery Integration ──────────────
export const samply_connections = schema.table("samply_connections", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  label: text("label").notNull().default("Samply"),
  base_url: text("base_url").notNull().default("https://samply.app/api/v0"),
  status: text("status").notNull().default("configured"),
  account_email: text("account_email"),
  last_checked_at: timestamp("last_checked_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("samply_connections_org_unique_idx").on(table.org_id),
  index("samply_connections_status_idx").on(table.status),
]);

export const samply_projects = schema.table("samply_projects", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  release_id: text("release_id").references(() => releases.id),
  campaign_id: text("campaign_id").references(() => campaigns.id),
  remote_project_id: text("remote_project_id").notNull(),
  remote_project_name: text("remote_project_name"),
  primary_player_id: text("primary_player_id"),
  upload_enabled: boolean("upload_enabled").notNull().default(false),
  last_synced_at: timestamp("last_synced_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("samply_projects_org_id_idx").on(table.org_id),
  index("samply_projects_release_id_idx").on(table.org_id, table.release_id),
  index("samply_projects_campaign_id_idx").on(table.org_id, table.campaign_id),
  uniqueIndex("samply_projects_remote_unique_idx").on(table.org_id, table.remote_project_id),
]);

export const samply_players = schema.table("samply_players", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  samply_project_id: text("samply_project_id").notNull().references(() => samply_projects.id),
  release_id: text("release_id").references(() => releases.id),
  remote_player_id: text("remote_player_id").notNull(),
  player_type: text("player_type").notNull().default("review"),
  name: text("name").notNull(),
  embed_url: text("embed_url"),
  share_url: text("share_url"),
  public: boolean("public").notNull().default(false),
  downloads_enabled: boolean("downloads_enabled").notNull().default(false),
  comments_enabled: boolean("comments_enabled").notNull().default(true),
  quality: text("quality"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("samply_players_org_id_idx").on(table.org_id),
  index("samply_players_project_id_idx").on(table.samply_project_id),
  index("samply_players_release_id_idx").on(table.org_id, table.release_id),
  uniqueIndex("samply_players_remote_unique_idx").on(table.org_id, table.remote_player_id),
]);

export const samply_files = schema.table("samply_files", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  samply_project_id: text("samply_project_id").notNull().references(() => samply_projects.id),
  track_id: text("track_id").references(() => tracks.id),
  work_id: text("work_id").references(() => works.id),
  media_asset_id: text("media_asset_id").references(() => media_assets.id),
  document_id: text("document_id").references(() => documents.id),
  remote_box_id: text("remote_box_id").notNull(),
  remote_stack_id: text("remote_stack_id"),
  file_name: text("file_name").notNull(),
  source_storage_key: text("source_storage_key"),
  sync_status: text("sync_status").notNull().default("synced"),
  last_synced_at: timestamp("last_synced_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("samply_files_org_id_idx").on(table.org_id),
  index("samply_files_project_id_idx").on(table.samply_project_id),
  index("samply_files_track_id_idx").on(table.org_id, table.track_id),
  index("samply_files_work_id_idx").on(table.org_id, table.work_id),
  index("samply_files_media_asset_id_idx").on(table.org_id, table.media_asset_id),
  index("samply_files_document_id_idx").on(table.org_id, table.document_id),
  uniqueIndex("samply_files_remote_box_unique_idx").on(table.org_id, table.remote_box_id),
]);

export const samply_events = schema.table("samply_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  event_type: text("event_type").notNull(),
  remote_event_id: text("remote_event_id").notNull(),
  remote_project_id: text("remote_project_id"),
  remote_box_id: text("remote_box_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processed_at: timestamp("processed_at"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("samply_events_org_id_idx").on(table.org_id),
  index("samply_events_type_idx").on(table.org_id, table.event_type),
  index("samply_events_project_idx").on(table.org_id, table.remote_project_id),
  uniqueIndex("samply_events_remote_unique_idx").on(table.org_id, table.remote_event_id),
]);

export const samply_comment_links = schema.table("samply_comment_links", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  samply_event_id: text("samply_event_id").notNull().references(() => samply_events.id),
  remote_comment_id: text("remote_comment_id").notNull(),
  release_id: text("release_id").references(() => releases.id),
  track_id: text("track_id").references(() => tracks.id),
  ops_task_id: text("ops_task_id").references(() => ops_tasks.id),
  comment_status: text("comment_status").notNull().default("open"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("samply_comment_links_org_id_idx").on(table.org_id),
  index("samply_comment_links_event_id_idx").on(table.samply_event_id),
  index("samply_comment_links_release_id_idx").on(table.org_id, table.release_id),
  index("samply_comment_links_track_id_idx").on(table.org_id, table.track_id),
  index("samply_comment_links_ops_task_id_idx").on(table.org_id, table.ops_task_id),
  uniqueIndex("samply_comment_links_remote_unique_idx").on(table.org_id, table.remote_comment_id),
]);

// ─── Migration Mapping ─────────────────────────────────
export const airtable_record_mappings = schema.table("airtable_record_mappings", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  airtable_base_id: text("airtable_base_id").notNull(),
  airtable_table_name: text("airtable_table_name").notNull(),
  airtable_record_id: text("airtable_record_id").notNull(),
  postgres_table_name: text("postgres_table_name").notNull(),
  postgres_record_id: text("postgres_record_id").notNull(),
  import_batch_id: text("import_batch_id"),
  record_hash: text("record_hash"),
  imported_at: timestamp("imported_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("airtable_record_mappings_source_unique_idx").on(
    table.org_id,
    table.airtable_base_id,
    table.airtable_table_name,
    table.airtable_record_id,
  ),
  index("airtable_record_mappings_org_id_idx").on(table.org_id),
  index("airtable_record_mappings_postgres_idx").on(
    table.postgres_table_name,
    table.postgres_record_id,
  ),
  index("airtable_record_mappings_import_batch_idx").on(table.import_batch_id),
]);
