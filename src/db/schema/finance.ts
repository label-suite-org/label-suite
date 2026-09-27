import { text, real, timestamp, date, index } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { artists, releases } from "./catalog";
import { documents } from "./assets";

// ─── Budget ─────────────────────────────────────────────
export const budget_categories = schema.table("budget_categories", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  type: text("type"), // marketing, a_and_r, manufacturing, etc.
}, (table) => [
  index("budget_categories_org_id_idx").on(table.org_id),
]);

export const budget_projects = schema.table("budget_projects", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  project_type: text("project_type").notNull().default("release"),
  artist_id: text("artist_id").references(() => artists.id),
  release_id: text("release_id").references(() => releases.id),
  description: text("description"),
  owner_contact_id: text("owner_contact_id").references(() => contacts.id),
  status: text("status").default("planning"), // planning, active, locked, archived
  currency: text("currency").default("USD"),
  start_date: date("start_date"),
  end_date: date("end_date"),
  location_name: text("location_name"),
  country_code: text("country_code"),
  timezone: text("timezone"),
  health: text("health").notNull().default("on_track"),
  cover_image_url: text("cover_image_url"),
  source_system: text("source_system"),
  source_base_id: text("source_base_id"),
  source_record_id: text("source_record_id"),
  source_imported_at: timestamp("source_imported_at", { withTimezone: true }),
  // historical column used by migration-driven restore
  total_planned: real("total_planned").default(0),
  baseline_funding: real("baseline_funding").default(0),
  track_count: real("track_count"),
  singles_count: real("singles_count"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("budget_projects_org_id_idx").on(table.org_id),
  index("budget_projects_release_id_idx").on(table.release_id),
  index("budget_projects_artist_id_idx").on(table.artist_id),
  index("budget_projects_org_type_idx").on(table.org_id, table.project_type),
  index("budget_projects_org_dates_idx").on(table.org_id, table.start_date, table.end_date),
  index("budget_projects_org_owner_idx").on(table.org_id, table.owner_contact_id),
]);

export const funding_sources = schema.table("funding_sources", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // advance, grant, partner, patron, direct_to_fan, self
  status: text("status").default("pending"), // confirmed, pending, rejected, research
  amount_planned: real("amount_planned").default(0),
  amount_confirmed: real("amount_confirmed").default(0),
  restricted_to: text("restricted_to"), // production, marketing, export, contingency
  funder: text("funder"),
  deadline: text("deadline"),
  reporting_required: real("reporting_required").default(0),
  application_date: text("application_date"),
  decision_date: text("decision_date"),
  grant_amount_received: real("grant_amount_received").default(0),
  grant_reporting_due: text("grant_reporting_due"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("funding_sources_org_id_idx").on(table.org_id),
  index("funding_sources_project_id_idx").on(table.project_id),
]);

// ─── Funding Source Events (audit log) ─────────────────
export const funding_source_events = schema.table("funding_source_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  funding_source_id: text("funding_source_id").notNull().references(() => funding_sources.id),
  from_status: text("from_status"),
  to_status: text("to_status").notNull(),
  occurred_at: timestamp("occurred_at").defaultNow(),
  note: text("note"),
}, (table) => [
  index("funding_source_events_org_id_idx").on(table.org_id),
  index("funding_source_events_fs_id_idx").on(table.funding_source_id),
  index("funding_source_events_occurred_at_idx").on(table.occurred_at),
]);

// ─── Budget Line Variance Requests ──────────────────────
export const budget_line_variance_requests = schema.table("budget_line_variance_requests", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  line_id: text("line_id").notNull().references(() => budget_line_items.id),
  requested_by_user_id: text("requested_by_user_id"),
  requested_action: text("requested_action").notNull(), // increase_amount, unlock_contingency, change_status
  current_value: text("current_value"), // JSON snapshot of current state
  requested_value: text("requested_value"), // JSON snapshot of requested change
  variance_reason: text("variance_reason").notNull(),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  reviewed_by_user_id: text("reviewed_by_user_id"),
  reviewed_at: timestamp("reviewed_at"),
  review_note: text("review_note"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("bli_variance_requests_org_id_idx").on(table.org_id),
  index("bli_variance_requests_line_id_idx").on(table.line_id),
  index("bli_variance_requests_status_idx").on(table.status),
]);

export const budget_line_items = schema.table("budget_line_items", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  project_id: text("project_id").references(() => budget_projects.id),
  release_id: text("release_id").references(() => releases.id),
  campaign_id: text("campaign_id"),
  category_id: text("category_id").references(() => budget_categories.id),
  funding_source_id: text("funding_source_id").references(() => funding_sources.id),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  planned_amount: real("planned_amount"),
  forecast_amount: real("forecast_amount"),
  committed_amount: real("committed_amount"),
  paid_amount: real("paid_amount"),
  phase: text("phase"), // pre_pro, recording, post_pro, setup, singles, release_week, post_release
  spend_month: text("spend_month"),
  status: text("status").default("pending"), // pending, approved, paid
  lock_status: text("lock_status").default("open"), // open, approval_required, locked
  eligibility_tag: text("eligibility_tag"), // grant_eligible, stem_review, duplicate_risk, non_eligible
  variance_reason: text("variance_reason"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("budget_line_items_org_id_idx").on(table.org_id),
  index("budget_line_items_release_id_idx").on(table.release_id),
  index("budget_line_items_campaign_id_idx").on(table.campaign_id),
  index("budget_line_items_category_id_idx").on(table.category_id),
  index("budget_line_items_project_id_idx").on(table.project_id),
  index("budget_line_items_funding_source_id_idx").on(table.funding_source_id),
]);

// ─── Budget Line Documents ──────────────────────────────
export const budget_line_documents = schema.table("budget_line_documents", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  budget_line_item_id: text("budget_line_item_id").notNull().references(() => budget_line_items.id),
  document_id: text("document_id").notNull().references(() => documents.id),
  link_type: text("link_type").notNull(), // invoice, receipt, quote, contract
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("bli_documents_org_id_idx").on(table.org_id),
  index("bli_documents_line_id_idx").on(table.budget_line_item_id),
  index("bli_documents_doc_id_idx").on(table.document_id),
]);

// ─── Calls (Today Hub) ──────────────────────────────────
export const calls = schema.table("calls", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  title: text("title").notNull(),
  contact_id: text("contact_id").references(() => contacts.id),
  release_id: text("release_id").references(() => releases.id),
  project_id: text("project_id").references(() => budget_projects.id),
  status: text("status").notNull().default("scheduled"),
  call_type: text("call_type"),
  start: timestamp("start"),
  end: timestamp("end"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("calls_org_id_idx").on(table.org_id),
  index("calls_contact_id_idx").on(table.contact_id),
  index("calls_release_id_idx").on(table.release_id),
  index("calls_project_id_idx").on(table.project_id),
  index("calls_status_idx").on(table.org_id, table.status),
  index("calls_start_idx").on(table.start),
]);
