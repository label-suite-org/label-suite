import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";
import { budget_projects } from "./finance";
import { integration_connections } from "./integrations";

// Source identities survive migration and subsequent provider imports.
export const tour_money_entries = schema.table("tour_money_entries", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id),
  source_key: text("source_key").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  voided: boolean("voided").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("tour_money_source_unique").on(table.org_id, table.source_key),
  index("tour_money_project_idx").on(table.org_id, table.project_id),
]);

// Secrets are excluded from the generic integration settings/read APIs.
export const tour_square_connections = schema.table("tour_square_connections", {
  connection_id: text("connection_id").primaryKey().references(() => integration_connections.id),
  org_id: text("org_id").notNull().references(() => orgs.id),
  project_id: text("project_id").notNull().references(() => budget_projects.id),
  merchant_id: text("merchant_id").notNull(),
  client_id: text("client_id").notNull(),
  encrypted_token: text("encrypted_token").notNull(),
  begin_at: timestamp("begin_at", { withTimezone: true }).notNull(),
  end_at: timestamp("end_at", { withTimezone: true }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  last_attempt_at: timestamp("last_attempt_at", { withTimezone: true }),
  last_success_at: timestamp("last_success_at", { withTimezone: true }),
  error: text("error"),
  held_count: integer("held_count").notNull().default(0),
}, table => [
  uniqueIndex("tour_square_project_unique").on(table.org_id, table.project_id),
  uniqueIndex("tour_square_merchant_unique").on(table.org_id, table.merchant_id),
  check("tour_square_period_check", sql`${table.end_at} > ${table.begin_at}`),
]);
