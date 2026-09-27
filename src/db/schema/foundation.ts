import { sql } from "drizzle-orm";
import { text, integer, real, timestamp, boolean, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";
import { users } from "../auth-schema";
import type { LocalToolScope } from "../../lib/campaign-enrichment-local-tool-contract";
import { labelSuiteSchema as schema } from "./_shared";

// ─── Organizations ─────────────────────────────────────
export const orgs = schema.table("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  plan: text("plan").default("internal"),
  legal_name: text("legal_name"),
  timezone: text("timezone").default("Europe/Copenhagen"),
  currency: text("currency").default("DKK"),
  validation_sweep_mode: text("validation_sweep_mode").default("manual"),
  default_release_policy: text("default_release_policy").default("readiness_gates"),
  isrc_country_code: text("isrc_country_code"),
  isrc_registrant_code: text("isrc_registrant_code"),
  catalog_prefix: text("catalog_prefix").notNull().default("CAT"),
  catalog_number_width: integer("catalog_number_width").notNull().default(3),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("orgs_slug_unique_idx").on(table.slug),
]);

export const org_memberships = schema.table("org_memberships", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  user_id: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("owner"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("org_memberships_org_id_idx").on(table.org_id),
  index("org_memberships_user_id_idx").on(table.user_id),
  uniqueIndex("org_memberships_org_user_unique_idx").on(table.org_id, table.user_id),
]);

export const dashboard_preferences = schema.table("dashboard_preferences", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  user_id: text("user_id").notNull().references(() => users.id),
  schema_version: integer("schema_version").notNull().default(1),
  pinned_indicator_ids: jsonb("pinned_indicator_ids").$type<string[]>().notNull().default([]),
  section_order: jsonb("section_order").$type<string[]>().notNull().default([
    "releases",
    "tasks",
    "catalog",
    "analytics",
    "royalties",
    "funding",
  ]),
  hidden_section_ids: jsonb("hidden_section_ids").$type<string[]>().notNull().default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("dashboard_preferences_org_id_idx").on(table.org_id),
  index("dashboard_preferences_user_id_idx").on(table.user_id),
  uniqueIndex("dashboard_preferences_org_user_unique_idx").on(table.org_id, table.user_id),
  check("dashboard_preferences_schema_version_check", sql`${table.schema_version} > 0`),
  check("dashboard_preferences_pins_check", sql`jsonb_typeof(${table.pinned_indicator_ids}) = 'array' and jsonb_array_length(${table.pinned_indicator_ids}) <= 3`),
  check("dashboard_preferences_section_order_check", sql`jsonb_typeof(${table.section_order}) = 'array' and jsonb_array_length(${table.section_order}) = 6`),
  check("dashboard_preferences_hidden_sections_check", sql`jsonb_typeof(${table.hidden_section_ids}) = 'array'`),
]);

export const org_invitations = schema.table("org_invitations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  email: text("email").notNull(),
  normalized_email: text("normalized_email").notNull(),
  role: text("role").notNull().default("member"),
  token_digest: text("token_digest"),
  status: text("status").notNull().default("pending"),
  invited_by_user_id: text("invited_by_user_id").references(() => users.id),
  accepted_by_user_id: text("accepted_by_user_id").references(() => users.id),
  expires_at: timestamp("expires_at"),
  accepted_at: timestamp("accepted_at"),
  revoked_at: timestamp("revoked_at"),
  last_sent_at: timestamp("last_sent_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("org_invitations_org_id_idx").on(table.org_id),
  index("org_invitations_email_idx").on(table.email),
  uniqueIndex("org_invitations_token_digest_unique_idx").on(table.token_digest),
  uniqueIndex("org_invitations_pending_email_unique_idx")
    .on(table.org_id, table.normalized_email)
    .where(sql`${table.status} = 'pending'`),
]);

// ─── Contacts ───────────────────────────────────────────
// ─── Contacts ──────────────────────────────────────────
export const contacts = schema.table("contacts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  image_url: text("image_url"),
  website: text("website"),
  linkedin_url: text("linkedin_url"),
  address: text("address"),
  role: text("role"), // e.g. Manager, Lawyer, PR, Distributor
  company: text("company"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("contacts_org_id_idx").on(table.org_id),
  index("contacts_name_idx").on(table.name),
  uniqueIndex("contacts_email_unique_idx").on(table.org_id, table.email).where(sql`${table.email} is not null`),
]);

// ─── Organizations (external companies/entities) ───────
export const organizations = schema.table("organizations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  type: text("type"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  linkedin_url: text("linkedin_url"),
  address: text("address"),
  image_url: text("image_url"),
  notes: text("notes"),
  source: text("source"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("organizations_org_id_idx").on(table.org_id),
  index("organizations_name_idx").on(table.name),
  index("organizations_type_idx").on(table.type),
  uniqueIndex("organizations_org_name_unique_idx").on(table.org_id, table.name),
]);

export const contact_organizations = schema.table("contact_organizations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  organization_id: text("organization_id").notNull().references(() => organizations.id),
  title: text("title"),
  department: text("department"),
  relationship_type: text("relationship_type"),
  is_primary: boolean("is_primary").default(false),
  source: text("source"),
  confidence: real("confidence"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("contact_organizations_org_id_idx").on(table.org_id),
  index("contact_organizations_contact_id_idx").on(table.contact_id),
  index("contact_organizations_organization_id_idx").on(table.organization_id),
  uniqueIndex("contact_organizations_unique_idx").on(table.org_id, table.contact_id, table.organization_id),
]);

// ─── Gmail Contact Enrichment ─────────────────────────
export const gmail_connections = schema.table("gmail_connections", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  user_id: text("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  scope: text("scope"),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token"),
  token_type: text("token_type").default("Bearer"),
  expires_at: timestamp("expires_at"),
  status: text("status").notNull().default("connected"),
  last_scan_at: timestamp("last_scan_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gmail_connections_org_id_idx").on(table.org_id),
  index("gmail_connections_user_id_idx").on(table.user_id),
  uniqueIndex("gmail_connections_org_user_email_unique_idx").on(table.org_id, table.user_id, table.email),
]);

export const contact_enrichment_suggestions = schema.table("contact_enrichment_suggestions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").references(() => contacts.id),
  organization_id: text("organization_id").references(() => organizations.id),
  source_connection_id: text("source_connection_id").references(() => gmail_connections.id),
  source_type: text("source_type").notNull().default("gmail"),
  field: text("field").notNull(),
  value: text("value").notNull(),
  normalized_value: text("normalized_value").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending"),
  applied_at: timestamp("applied_at"),
  ignored_at: timestamp("ignored_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("contact_enrichment_suggestions_org_id_idx").on(table.org_id),
  index("contact_enrichment_suggestions_contact_id_idx").on(table.contact_id),
  index("contact_enrichment_suggestions_status_idx").on(table.org_id, table.status),
  uniqueIndex("contact_enrichment_suggestions_unique_idx").on(
    table.org_id,
    table.contact_id,
    table.field,
    table.normalized_value,
    table.source_type,
  ),
]);

// ─── Local Tool Access ───────────────────────────────
export const local_tool_tokens = schema.table("local_tool_tokens", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  user_id: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  token_prefix: text("token_prefix").notNull(),
  secret_hash: text("secret_hash").notNull(),
  scopes: jsonb("scopes").$type<LocalToolScope[]>().notNull().default([]),
  expires_at: timestamp("expires_at").notNull(),
  revoked_at: timestamp("revoked_at"),
  last_used_at: timestamp("last_used_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("local_tool_tokens_org_created_at_idx").on(table.org_id, table.created_at),
  index("local_tool_tokens_user_id_idx").on(table.user_id),
  check("local_tool_tokens_secret_hash_check", sql`${table.secret_hash} ~ '^[a-f0-9]{64}$'`),
]);
