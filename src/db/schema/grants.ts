import { text, integer, numeric, timestamp, boolean, date, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { users } from "../auth-schema";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { budget_projects, funding_sources, budget_line_items, calls } from "./finance";
import { documents } from "./assets";

// ─── Grants & Applications ─────────────────────────────
export const grants = schema.table("grants", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  funder: text("funder"),
  program: text("program"),
  category: text("category"),
  url: text("url"),
  research_url: text("research_url"),
  description: text("description"),
  requirements: text("requirements"),
  applicant_type: text("applicant_type"),
  eligible_uses: text("eligible_uses"),
  assessment_body: text("assessment_body"),
  response_timing: text("response_timing"),
  rules: text("rules"),
  research_status: text("research_status").default("research"),
  research_summary: text("research_summary"),
  research_source: text("research_source"),
  last_verified_at: date("last_verified_at"),
  opens_on: date("opens_on"),
  deadline: date("deadline"),
  max_amount: numeric("max_amount", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency").notNull().default("DKK"),
  priority: text("priority").default("medium"),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grants_org_deadline_idx").on(table.org_id, table.deadline),
  index("grants_org_status_idx").on(table.org_id, table.status),
  index("grants_funder_idx").on(table.funder),
]);

export const grant_applications = schema.table("grant_applications", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  project_id: text("project_id").references(() => budget_projects.id),
  grant_id: text("grant_id").references(() => grants.id),
  funding_source_id: text("funding_source_id").references(() => funding_sources.id),
  owner_contact_id: text("owner_contact_id").references(() => contacts.id),
  owner_user_id: text("owner_user_id").references(() => users.id),
  status: text("status").notNull().default("draft"),
  priority: text("priority").notNull().default("medium"),
  workflow_stage: text("workflow_stage").notNull().default("idea"),
  outcome: text("outcome").notNull().default("unknown"),
  amount_requested: numeric("amount_requested", { precision: 18, scale: 2, mode: "number" }),
  amount_awarded: numeric("amount_awarded", { precision: 18, scale: 2, mode: "number" }),
  submission_deadline: date("submission_deadline"),
  submitted_at: timestamp("submitted_at"),
  decision_date: date("decision_date"),
  reporting_due: date("reporting_due"),
  next_action: text("next_action"),
  next_action_due: date("next_action_due"),
  angle_narrative: text("angle_narrative"),
  response_notes: text("response_notes"),
  evaluation: text("evaluation"),
  next_step_recommendation: text("next_step_recommendation"),
  source_folder: text("source_folder"),
  external_reference: text("external_reference"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_applications_org_deadline_idx").on(table.org_id, table.submission_deadline),
  index("grant_applications_project_idx").on(table.project_id),
  index("grant_applications_grant_idx").on(table.grant_id),
  index("grant_applications_status_idx").on(table.org_id, table.status),
  index("grant_applications_workflow_idx").on(table.org_id, table.workflow_stage),
  index("grant_applications_outcome_idx").on(table.org_id, table.outcome),
  index("grant_applications_next_action_idx").on(table.org_id, table.next_action_due),
  index("grant_applications_org_owner_user_idx").on(table.org_id, table.owner_user_id),
]);

export const grant_application_documents = schema.table("grant_application_documents", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  application_id: text("application_id").notNull().references(() => grant_applications.id),
  document_id: text("document_id").notNull().references(() => documents.id),
  link_type: text("link_type").notNull().default("attachment"),
  asset_role: text("asset_role").notNull().default("other"),
  required: boolean("required").notNull().default(false),
  readiness_status: text("readiness_status").notNull().default("missing"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("grant_application_documents_org_id_idx").on(table.org_id),
  index("grant_application_documents_application_idx").on(table.application_id),
  index("grant_application_documents_document_idx").on(table.document_id),
  uniqueIndex("grant_application_documents_unique_idx").on(table.org_id, table.application_id, table.document_id),
]);

export const grant_document_extractions = schema.table("grant_document_extractions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  document_id: text("document_id").notNull().references(() => documents.id),
  source_storage_key: text("source_storage_key").notNull(),
  source_hash: text("source_hash").notNull(),
  status: text("status").notNull().default("pending"),
  extracted_text: text("extracted_text"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  error: text("error"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_document_extractions_org_idx").on(table.org_id),
  index("grant_document_extractions_document_idx").on(table.document_id),
  uniqueIndex("grant_document_extractions_source_unique_idx").on(table.org_id, table.document_id, table.source_hash),
]);

export const project_funding_profiles = schema.table("project_funding_profiles", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id),
  owner_contact_id: text("owner_contact_id").references(() => contacts.id),
  priority: text("priority").notNull().default("medium"),
  target_date: date("target_date"),
  goal: text("goal"),
  funding_narrative: text("funding_narrative"),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  success_metrics: jsonb("success_metrics").$type<string[]>().notNull().default([]),
  export_markets: jsonb("export_markets").$type<string[]>().notNull().default([]),
  source_table: text("source_table"),
  source_record_id: text("source_record_id"),
  imported_at: timestamp("imported_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("project_funding_profiles_org_idx").on(table.org_id),
  uniqueIndex("project_funding_profiles_project_unique_idx").on(table.org_id, table.project_id),
]);

export const funding_needs = schema.table("funding_needs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id),
  title: text("title").notNull(),
  category: text("category").notNull().default("other"),
  use_of_funds: text("use_of_funds"),
  target_amount: numeric("target_amount", { precision: 18, scale: 2, mode: "number" }).notNull().default(0),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("planned"),
  needed_by: date("needed_by"),
  eligibility: text("eligibility").notNull().default("unknown"),
  success_measure: text("success_measure"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("funding_needs_org_project_idx").on(table.org_id, table.project_id),
  index("funding_needs_org_needed_by_idx").on(table.org_id, table.needed_by),
]);

export const funding_need_budget_lines = schema.table("funding_need_budget_lines", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  funding_need_id: text("funding_need_id").notNull().references(() => funding_needs.id),
  budget_line_id: text("budget_line_id").notNull().references(() => budget_line_items.id),
  allocated_amount: numeric("allocated_amount", { precision: 18, scale: 2, mode: "number" }).notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("funding_need_budget_lines_org_idx").on(table.org_id),
  uniqueIndex("funding_need_budget_lines_unique_idx").on(table.org_id, table.funding_need_id, table.budget_line_id),
]);

export const grant_deadlines = schema.table("grant_deadlines", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  grant_id: text("grant_id").notNull().references(() => grants.id),
  deadline_date: date("deadline_date").notNull(),
  classification: text("classification").notNull().default("confirmed"),
  source_url: text("source_url"),
  deadline_time: text("deadline_time"),
  timezone: text("timezone").notNull().default("Europe/Copenhagen"),
  label: text("label"),
  opens_on: date("opens_on"),
  expected_response_date: date("expected_response_date"),
  status: text("status").notNull().default("planned"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_deadlines_org_date_idx").on(table.org_id, table.deadline_date),
  index("grant_deadlines_grant_idx").on(table.grant_id),
  uniqueIndex("grant_deadlines_org_grant_date_unique_idx").on(table.org_id, table.grant_id, table.deadline_date),
]);

export const grant_application_funding_needs = schema.table("grant_application_funding_needs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  application_id: text("application_id").notNull().references(() => grant_applications.id),
  funding_need_id: text("funding_need_id").notNull().references(() => funding_needs.id),
  amount_requested: numeric("amount_requested", { precision: 18, scale: 2, mode: "number" }).notNull().default(0),
  amount_awarded: numeric("amount_awarded", { precision: 18, scale: 2, mode: "number" }).notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_application_funding_needs_org_idx").on(table.org_id),
  uniqueIndex("grant_application_funding_needs_unique_idx").on(table.org_id, table.application_id, table.funding_need_id),
]);

export const grant_requirements = schema.table("grant_requirements", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  grant_id: text("grant_id").notNull().references(() => grants.id),
  name: text("name").notNull(),
  description: text("description"),
  asset_role: text("asset_role"),
  required: boolean("required").notNull().default(true),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_requirements_org_grant_idx").on(table.org_id, table.grant_id),
]);

export const grant_application_requirements = schema.table("grant_application_requirements", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  application_id: text("application_id").notNull().references(() => grant_applications.id),
  requirement_id: text("requirement_id").references(() => grant_requirements.id),
  document_id: text("document_id").references(() => documents.id),
  required: boolean("required").notNull().default(true),
  readiness_status: text("readiness_status").notNull().default("missing"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("grant_application_requirements_org_application_idx").on(table.org_id, table.application_id),
  index("grant_application_requirements_document_idx").on(table.document_id),
]);

export const grant_application_calls = schema.table("grant_application_calls", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  application_id: text("application_id").notNull().references(() => grant_applications.id),
  call_id: text("call_id").notNull().references(() => calls.id),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("grant_application_calls_org_idx").on(table.org_id),
  uniqueIndex("grant_application_calls_unique_idx").on(table.org_id, table.application_id, table.call_id),
]);

export const grant_application_events = schema.table("grant_application_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  application_id: text("application_id").notNull().references(() => grant_applications.id),
  event_type: text("event_type").notNull(),
  actor_contact_id: text("actor_contact_id").references(() => contacts.id),
  from_value: text("from_value"),
  to_value: text("to_value"),
  note: text("note"),
  metadata: jsonb("metadata"),
  occurred_at: timestamp("occurred_at").notNull().defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("grant_application_events_org_application_idx").on(table.org_id, table.application_id),
  index("grant_application_events_org_occurred_idx").on(table.org_id, table.occurred_at),
]);
