import { sql } from "drizzle-orm";
import { boolean, check, date, integer, jsonb, numeric, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { contacts, organizations, orgs } from "./foundation";
import { artists, releases } from "./catalog";
import { budget_projects } from "./finance";

export const project_artists = schema.table("project_artists", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  artist_id: text("artist_id").notNull().references(() => artists.id, { onDelete: "cascade" }),
  role: text("role"),
  is_primary: boolean("is_primary").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_artists_org_project_idx").on(table.org_id, table.project_id),
  uniqueIndex("project_artists_unique_idx").on(table.org_id, table.project_id, table.artist_id),
]);

export const project_contacts = schema.table("project_contacts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  contact_id: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  is_primary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_contacts_org_project_idx").on(table.org_id, table.project_id),
  uniqueIndex("project_contacts_unique_idx").on(table.org_id, table.project_id, table.contact_id, table.role),
]);

export const project_organizations = schema.table("project_organizations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  organization_id: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  is_primary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_organizations_org_project_idx").on(table.org_id, table.project_id),
  uniqueIndex("project_organizations_unique_idx").on(table.org_id, table.project_id, table.organization_id, table.role),
]);

export const project_events = schema.table("project_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").references(() => budget_projects.id, { onDelete: "set null" }),
  artist_id: text("artist_id").references(() => artists.id, { onDelete: "set null" }),
  release_id: text("release_id").references(() => releases.id, { onDelete: "set null" }),
  contact_id: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  owner_contact_id: text("owner_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  event_type: text("event_type").notNull(),
  status: text("status").notNull().default("planned"),
  start_date: date("start_date").notNull(),
  end_date: date("end_date"),
  starts_at: timestamp("starts_at", { withTimezone: true }),
  ends_at: timestamp("ends_at", { withTimezone: true }),
  all_day: boolean("all_day").notNull().default(true),
  timezone: text("timezone"),
  venue_name: text("venue_name"),
  address: text("address"),
  city: text("city"),
  region: text("region"),
  country_code: text("country_code"),
  notes: text("notes"),
  is_confirmed: boolean("is_confirmed").notNull().default(false),
  source_system: text("source_system"),
  source_base_id: text("source_base_id"),
  source_table_id: text("source_table_id"),
  source_record_id: text("source_record_id"),
  source_imported_at: timestamp("source_imported_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_events_org_project_date_idx").on(table.org_id, table.project_id, table.start_date),
  index("project_events_org_date_idx").on(table.org_id, table.start_date),
  index("project_events_org_type_idx").on(table.org_id, table.event_type),
  check("project_events_date_range_check", sql`${table.end_date} is null or ${table.end_date} >= ${table.start_date}`),
  check("project_events_time_range_check", sql`${table.ends_at} is null or ${table.starts_at} is null or ${table.ends_at} >= ${table.starts_at}`),
]);

export const tour_details = schema.table("tour_details", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  billing_role: text("billing_role"),
  headline_artist_id: text("headline_artist_id").references(() => artists.id, { onDelete: "set null" }),
  touring_party_size: integer("touring_party_size"),
  base_city: text("base_city"),
  base_timezone: text("base_timezone"),
  default_set_length: integer("default_set_length"),
  default_guarantee: numeric("default_guarantee", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency"),
  announce_date: date("announce_date"),
  decision_date: date("decision_date"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tour_details_org_project_idx").on(table.org_id, table.project_id),
  uniqueIndex("tour_details_project_unique_idx").on(table.org_id, table.project_id),
]);

export const tour_show_details = schema.table("tour_show_details", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  event_id: text("event_id").notNull().references(() => project_events.id, { onDelete: "cascade" }),
  participation: text("participation"),
  show_type: text("show_type"),
  venue_organization_id: text("venue_organization_id").references(() => organizations.id, { onDelete: "set null" }),
  promoter_contact_id: text("promoter_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  agent_contact_id: text("agent_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  capacity: integer("capacity"),
  guarantee: numeric("guarantee", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency"),
  set_length: integer("set_length"),
  advance_status: text("advance_status"),
  source_advanced: boolean("source_advanced").notNull().default(false),
  comps: integer("comps"),
  merch_terms: text("merch_terms"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tour_show_details_org_event_idx").on(table.org_id, table.event_id),
  uniqueIndex("tour_show_details_event_unique_idx").on(table.org_id, table.event_id),
]);

export const tour_travel_legs = schema.table("tour_travel_legs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  origin_event_id: text("origin_event_id").references(() => project_events.id, { onDelete: "set null" }),
  destination_event_id: text("destination_event_id").references(() => project_events.id, { onDelete: "set null" }),
  start_date: date("start_date").notNull(),
  end_date: date("end_date"),
  departs_at: timestamp("departs_at", { withTimezone: true }),
  arrives_at: timestamp("arrives_at", { withTimezone: true }),
  origin_label: text("origin_label"),
  destination_label: text("destination_label"),
  transport_mode: text("transport_mode"),
  carrier: text("carrier"),
  booking_reference: text("booking_reference"),
  booking_status: text("booking_status"),
  estimated_cost: numeric("estimated_cost", { precision: 18, scale: 2, mode: "number" }),
  actual_cost: numeric("actual_cost", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tour_travel_legs_org_project_date_idx").on(table.org_id, table.project_id, table.start_date),
  check("tour_travel_legs_date_range_check", sql`${table.end_date} is null or ${table.end_date} >= ${table.start_date}`),
  check("tour_travel_legs_time_range_check", sql`${table.arrives_at} is null or ${table.departs_at} is null or ${table.arrives_at} >= ${table.departs_at}`),
]);

export const tour_lodging = schema.table("tour_lodging", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  event_id: text("event_id").references(() => project_events.id, { onDelete: "set null" }),
  travel_leg_id: text("travel_leg_id").references(() => tour_travel_legs.id, { onDelete: "set null" }),
  organization_id: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  stop_name: text("stop_name").notNull(),
  address: text("address"),
  check_in: date("check_in").notNull(),
  check_out: date("check_out"),
  rooms: integer("rooms"),
  nights: integer("nights"),
  booking_reference: text("booking_reference"),
  booking_status: text("booking_status"),
  estimated_cost: numeric("estimated_cost", { precision: 18, scale: 2, mode: "number" }),
  actual_cost: numeric("actual_cost", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency"),
  cost_sharing_status: text("cost_sharing_status"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tour_lodging_org_project_date_idx").on(table.org_id, table.project_id, table.check_in),
  check("tour_lodging_date_range_check", sql`${table.check_out} is null or ${table.check_out} >= ${table.check_in}`),
]);

export const tour_deal_terms = schema.table("tour_deal_terms", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id, { onDelete: "cascade" }),
  fee_per_show: numeric("fee_per_show", { precision: 18, scale: 2, mode: "number" }),
  paid_shows: integer("paid_shows"),
  total_guarantee: numeric("total_guarantee", { precision: 18, scale: 2, mode: "number" }),
  currency: text("currency"),
  slot: text("slot"),
  set_length: integer("set_length"),
  all_in_costs: numeric("all_in_costs", { precision: 18, scale: 2, mode: "number" }),
  all_in_costs_text: text("all_in_costs_text"),
  radius_clause: text("radius_clause"),
  offer_expires: timestamp("offer_expires", { withTimezone: true }),
  announce_decision: text("announce_decision"),
  deal_status: text("deal_status"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tour_deal_terms_org_project_idx").on(table.org_id, table.project_id),
  uniqueIndex("tour_deal_terms_project_unique_idx").on(table.org_id, table.project_id),
]);

export const project_import_runs = schema.table("project_import_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  source_system: text("source_system").notNull(),
  source_base_id: text("source_base_id"),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  source_count: integer("source_count").notNull().default(0),
  snapshot_hash: text("snapshot_hash"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("project_import_runs_org_source_idx").on(table.org_id, table.source_system, table.started_at),
]);

export const project_source_records = schema.table("project_source_records", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  import_run_id: text("import_run_id").notNull().references(() => project_import_runs.id, { onDelete: "cascade" }),
  source_system: text("source_system").notNull(),
  source_base_id: text("source_base_id"),
  source_table_id: text("source_table_id"),
  source_record_id: text("source_record_id"),
  source_created_at: timestamp("source_created_at", { withTimezone: true }),
  normalized_payload_hash: text("normalized_payload_hash"),
  raw_payload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
  entity_type: text("entity_type"),
  entity_id: text("entity_id"),
  imported_at: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_source_records_org_entity_idx").on(table.org_id, table.entity_type, table.entity_id),
  index("project_source_records_import_run_idx").on(table.org_id, table.import_run_id),
  uniqueIndex("project_source_records_source_unique_idx").on(
    table.org_id,
    table.source_system,
    table.source_base_id,
    table.source_table_id,
    table.source_record_id,
  ).where(sql`${table.source_record_id} is not null`),
]);
