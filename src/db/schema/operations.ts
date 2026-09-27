import { sql } from "drizzle-orm";
import { text, integer, timestamp, boolean, date, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { artists, releases, release_milestones } from "./catalog";
import { project_events } from "./events";
import { budget_projects } from "./finance";
import { campaign_leads, campaigns } from "./marketing";
import { grants } from "./grants";

// ─── Ops Tasks ─────────────────────────────────────────
export const ops_tasks = schema.table("ops_tasks", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  task_name: text("task_name").notNull(),
  status: text("status").default("todo"),
  priority: text("priority").default("P2"),
  owner: text("owner"),
  assignee_ids: text("assignee_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  labels: text("labels").array().notNull().default(sql`ARRAY[]::text[]`),
  dependency_ids: text("dependency_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  due_date: date("due_date"),
  linked_artist_id: text("linked_artist_id").references(() => artists.id),
  linked_release_id: text("linked_release_id").references(() => releases.id),
  release_milestone_id: text("release_milestone_id").references(() => release_milestones.id, { onDelete: "set null" }),
  timeline_phase: text("timeline_phase"),
  release_offset_days: integer("release_offset_days"),
  workback_key: text("workback_key"),
  linked_campaign_id: text("linked_campaign_id").references(() => campaigns.id),
  linked_grant_id: text("linked_grant_id").references(() => grants.id, { onDelete: "set null" }),
  linked_campaign_lead_id: text("linked_campaign_lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  linked_contact_id: text("linked_contact_id").references(() => contacts.id),
  owner_contact_id: text("owner_contact_id").references(() => contacts.id),
  project_id: text("project_id").references(() => budget_projects.id),
  event_id: text("event_id").references(() => project_events.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(0),
  notes: text("notes"),
  next_action: text("next_action"),
  is_overdue: boolean("is_overdue").default(false),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ops_tasks_workback_key_idx").on(table.org_id, table.linked_release_id, table.workback_key),
  index("ops_tasks_org_id_idx").on(table.org_id),
  index("ops_tasks_linked_artist_id_idx").on(table.linked_artist_id),
  index("ops_tasks_linked_release_id_idx").on(table.linked_release_id),
  index("ops_tasks_release_milestone_idx").on(table.org_id, table.release_milestone_id),
  index("ops_tasks_timeline_phase_idx").on(table.org_id, table.linked_release_id, table.timeline_phase),
  index("ops_tasks_linked_campaign_id_idx").on(table.linked_campaign_id),
  index("ops_tasks_linked_grant_id_idx").on(table.linked_grant_id),
  index("ops_tasks_linked_campaign_lead_id_idx").on(table.linked_campaign_lead_id),
  index("ops_tasks_linked_contact_id_idx").on(table.linked_contact_id),
  index("ops_tasks_owner_contact_id_idx").on(table.owner_contact_id),
  index("ops_tasks_project_id_idx").on(table.project_id),
  index("ops_tasks_event_id_idx").on(table.event_id),
  index("ops_tasks_org_event_id_idx").on(table.org_id, table.event_id),
  index("ops_tasks_status_idx").on(table.status),
  index("ops_tasks_due_date_idx").on(table.due_date),
  check("ops_tasks_timeline_phase_check", sql`${table.timeline_phase} is null or ${table.timeline_phase} in ('strategy_lock', 'assets_metadata', 'distribution_dsp', 'campaign_rollout', 'release_week', 'post_release')`),
]);

// ─── Background Job Runs ──────────────────────────────
export const job_runs = schema.table("job_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  job_type: text("job_type").notNull(),
  trigger: text("trigger").notNull().default("manual"),
  status: text("status").notNull().default("queued"),
  schema_version: integer("schema_version").notNull().default(1),
  attempt: integer("attempt").notNull().default(0),
  max_attempts: integer("max_attempts").notNull().default(5),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  error_metadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
  available_at: timestamp("available_at").notNull().defaultNow(),
  started_at: timestamp("started_at"),
  heartbeat_at: timestamp("heartbeat_at"),
  finished_at: timestamp("finished_at"),
  completed_at: timestamp("completed_at"),
  lease_owner: text("lease_owner"),
  lease_expires_at: timestamp("lease_expires_at"),
  idempotency_key: text("idempotency_key"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("job_runs_org_started_at_idx").on(table.org_id, table.started_at),
  index("job_runs_type_status_idx").on(table.job_type, table.status),
  index("job_runs_status_started_at_idx").on(table.status, table.started_at),
  index("job_runs_claim_idx").on(table.status, table.available_at, table.lease_expires_at),
  uniqueIndex("job_runs_org_type_idempotency_unique_idx")
    .on(table.org_id, table.job_type, table.idempotency_key)
    .where(sql`${table.idempotency_key} is not null`),
  check("job_runs_status_check", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`),
  check("job_runs_attempts_check", sql`${table.attempt} >= 0 and ${table.max_attempts} > 0 and ${table.attempt} <= ${table.max_attempts}`),
]);

export const job_attempts = schema.table("job_attempts", {
  id: text("id").primaryKey(),
  job_id: text("job_id").notNull().references(() => job_runs.id, { onDelete: "cascade" }),
  org_id: text("org_id").notNull().references(() => orgs.id),
  attempt: integer("attempt").notNull(),
  worker_id: text("worker_id").notNull(),
  status: text("status").notNull().default("running"),
  started_at: timestamp("started_at").notNull().defaultNow(),
  heartbeat_at: timestamp("heartbeat_at"),
  finished_at: timestamp("finished_at"),
  error_metadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("job_attempts_job_attempt_unique_idx").on(table.job_id, table.attempt),
  index("job_attempts_org_started_idx").on(table.org_id, table.started_at),
  check("job_attempts_status_check", sql`${table.status} in ('running', 'succeeded', 'failed', 'lease_expired', 'cancelled')`),
]);

export const job_workers = schema.table("job_workers", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("running"),
  started_at: timestamp("started_at").notNull().defaultNow(),
  last_seen_at: timestamp("last_seen_at").notNull().defaultNow(),
  stopped_at: timestamp("stopped_at"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("job_workers_status_seen_idx").on(table.status, table.last_seen_at),
  check("job_workers_status_check", sql`${table.status} in ('running', 'stopped')`),
]);

// ─── Audit Log ─────────────────────────────────────────
export const audit_logs = schema.table("audit_logs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  actor_user_id: text("actor_user_id"),
  request_id: text("request_id"),
  action: text("action").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id"),
  before_data: jsonb("before_data").$type<Record<string, unknown>>(),
  after_data: jsonb("after_data").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("audit_logs_org_created_idx").on(table.org_id, table.created_at),
  index("audit_logs_entity_idx").on(table.org_id, table.entity_type, table.entity_id),
  index("audit_logs_actor_idx").on(table.actor_user_id),
]);
