import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "../auth-schema";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";
import { integration_connections } from "./integrations";

export const finance_transactions = schema.table("finance_transactions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  connection_id: text("connection_id").references(() => integration_connections.id),
  source_provider: text("source_provider").notNull(),
  account_label: text("account_label").notNull(),
  external_transaction_id: text("external_transaction_id"),
  occurred_at: timestamp("occurred_at").notNull(),
  posted_at: timestamp("posted_at"),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  currency: text("currency").notNull(),
  direction: text("direction").notNull(),
  description: text("description"),
  raw_evidence: jsonb("raw_evidence").$type<Record<string, unknown>>().notNull(),
  raw_source_hash: text("raw_source_hash").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  status: text("status").notNull().default("unmatched"),
  imported_by: text("imported_by").references(() => users.id),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("finance_transactions_org_source_idempotency_unique_idx").on(table.org_id, table.source_provider, table.account_label, table.idempotency_key),
  index("finance_transactions_org_occurred_idx").on(table.org_id, table.occurred_at),
  index("finance_transactions_org_status_idx").on(table.org_id, table.status),
  index("finance_transactions_external_id_idx").on(table.org_id, table.source_provider, table.external_transaction_id),
  check("finance_transactions_amount_positive_check", sql`${table.amount} > 0`),
  check("finance_transactions_direction_check", sql`${table.direction} in ('credit', 'debit')`),
  check("finance_transactions_status_check", sql`${table.status} in ('unmatched', 'partially_matched', 'matched', 'ignored')`),
]);

export const finance_transaction_matches = schema.table("finance_transaction_matches", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  transaction_id: text("transaction_id").notNull().references(() => finance_transactions.id, { onDelete: "cascade" }),
  match_type: text("match_type").notNull(),
  target_id: text("target_id").notNull(),
  allocated_amount: numeric("allocated_amount", { precision: 20, scale: 8 }).notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").notNull().default("active"),
  actor_user_id: text("actor_user_id").references(() => users.id),
  reversed_at: timestamp("reversed_at"),
  reversed_by: text("reversed_by").references(() => users.id),
  reversal_reason: text("reversal_reason"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("finance_transaction_matches_org_transaction_idx").on(table.org_id, table.transaction_id),
  index("finance_transaction_matches_target_idx").on(table.org_id, table.match_type, table.target_id),
  index("finance_transaction_matches_status_idx").on(table.org_id, table.status),
  check("finance_transaction_matches_type_check", sql`${table.match_type} in ('royalty_receipt', 'payout_batch', 'budget_spend')`),
  check("finance_transaction_matches_amount_positive_check", sql`${table.allocated_amount} > 0`),
  check("finance_transaction_matches_status_check", sql`${table.status} in ('active', 'reversed')`),
]);
