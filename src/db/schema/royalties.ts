import { sql } from "drizzle-orm";
import { text, integer, real, numeric, timestamp, date, index, uniqueIndex, jsonb, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "../auth-schema";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { artists, releases, works, tracks, roles } from "./catalog";

// ─── Royalties / Revenue ────────────────────────────────
export const royalties_revenue = schema.table("royalties_revenue", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  record_name: text("record_name").notNull(),
  statement_period: text("statement_period"),
  source: text("source"),
  artist_id: text("artist_id").references(() => artists.id),
  release_id: text("release_id").references(() => releases.id),
  gross_revenue: real("gross_revenue"),
  costs: real("costs"),
  net_revenue: real("net_revenue"),
  paid_out: text("paid_out").default("unpaid"),
  payment_date: text("payment_date"),
  notes: text("notes"),
  revenue_type: text("revenue_type"),
  revenue_month: text("revenue_month"),
  source_contact_id: text("source_contact_id").references(() => contacts.id),
  payment_method: text("payment_method"),
  work_id: text("work_id").references(() => works.id),
  track_id: text("track_id").references(() => tracks.id),
  statement_id: text("statement_id"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("royalties_revenue_org_id_idx").on(table.org_id),
  index("royalties_revenue_artist_id_idx").on(table.artist_id),
  index("royalties_revenue_release_id_idx").on(table.release_id),
  index("royalties_revenue_source_contact_id_idx").on(table.source_contact_id),
  index("royalties_revenue_period_idx").on(table.statement_period),
  index("royalties_revenue_work_id_idx").on(table.work_id),
]);

// ─── Royalty Ledger Pipeline ───────────────────────────
export const royalty_imports = schema.table("royalty_imports", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  source: text("source").notNull(),
  file_name: text("file_name"),
  storage_key: text("storage_key"),
  sha256: text("sha256"),
  period_start: date("period_start"),
  period_end: date("period_end"),
  // Canonical imports reconcile per earning currency. Legacy import rows retain
  // their historical currency while new canonical imports do not invent one.
  currency: text("currency"),
  status: text("status").notNull().default("received"),
  row_count: integer("row_count").notNull().default(0),
  matched_count: integer("matched_count").notNull().default(0),
  unmatched_count: integer("unmatched_count").notNull().default(0),
  error_count: integer("error_count").notNull().default(0),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  started_at: timestamp("started_at").defaultNow(),
  completed_at: timestamp("completed_at"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("royalty_imports_org_started_idx").on(table.org_id, table.started_at),
  index("royalty_imports_source_status_idx").on(table.source, table.status),
  uniqueIndex("royalty_imports_org_sha_unique_idx").on(table.org_id, table.sha256).where(sql`${table.sha256} is not null`),
  check("royalty_imports_status_canonical_check", sql`${table.status} in ('received', 'parsing', 'parsed', 'failed', 'superseded')`),
]);

export const royalty_import_currency_totals = schema.table("royalty_import_currency_totals", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  import_id: text("import_id").notNull().references(() => royalty_imports.id),
  currency: text("currency").notNull(),
  row_count: integer("row_count").notNull().default(0),
  gross_total: numeric("gross_total", { precision: 20, scale: 8 }).notNull(),
  fees_total: numeric("fees_total", { precision: 20, scale: 8 }).notNull(),
  net_total: numeric("net_total", { precision: 20, scale: 8 }).notNull(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("royalty_import_currency_totals_org_import_currency_unique_idx").on(table.org_id, table.import_id, table.currency),
  index("royalty_import_currency_totals_import_idx").on(table.import_id),
]);

export const royalty_earnings = schema.table("royalty_earnings", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  import_id: text("import_id").references(() => royalty_imports.id),
  source_row_id: text("source_row_id").notNull(),
  source: text("source").notNull(),
  report_period: text("report_period"),
  platform: text("platform"),
  platform_detail: text("platform_detail"),
  territory_code: text("territory_code"),
  revenue_stream: text("revenue_stream"),
  usage_type: text("usage_type"),
  units: integer("units").default(0),
  percentage: numeric("percentage", { precision: 9, scale: 6 }),
  gross_amount: numeric("gross_amount", { precision: 20, scale: 8 }),
  fees_amount: numeric("fees_amount", { precision: 20, scale: 8 }).default("0"),
  net_amount: numeric("net_amount", { precision: 20, scale: 8 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  isrc: text("isrc"),
  upc: text("upc"),
  track_title: text("track_title"),
  artist_name: text("artist_name"),
  work_id: text("work_id").references(() => works.id),
  track_id: text("track_id").references(() => tracks.id),
  release_id: text("release_id").references(() => releases.id),
  artist_id: text("artist_id").references(() => artists.id),
  match_status: text("match_status").notNull().default("unmatched"),
  raw_data: jsonb("raw_data").$type<Record<string, unknown>>(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("royalty_earnings_org_period_idx").on(table.org_id, table.report_period),
  index("royalty_earnings_import_idx").on(table.import_id),
  index("royalty_earnings_isrc_idx").on(table.org_id, table.isrc),
  index("royalty_earnings_match_status_idx").on(table.org_id, table.match_status),
  index("royalty_earnings_track_idx").on(table.track_id),
  uniqueIndex("royalty_earnings_source_row_unique_idx").on(table.org_id, table.source, table.source_row_id),
]);

export const royalty_split_snapshots = schema.table("royalty_split_snapshots", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  work_id: text("work_id").notNull().references(() => works.id),
  effective_from: date("effective_from").notNull(),
  effective_to: date("effective_to"),
  status: text("status").notNull().default("active"),
  source: text("source"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("royalty_split_snapshots_org_work_idx").on(table.org_id, table.work_id),
  index("royalty_split_snapshots_effective_idx").on(table.effective_from, table.effective_to),
]);

export const royalty_split_lines = schema.table("royalty_split_lines", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  snapshot_id: text("snapshot_id").notNull().references(() => royalty_split_snapshots.id),
  contact_id: text("contact_id").references(() => contacts.id),
  role_id: text("role_id").references(() => roles.id),
  payee_name: text("payee_name").notNull(),
  scope: text("scope"),
  share_percent: numeric("share_percent", { precision: 9, scale: 6 }).notNull(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("royalty_split_lines_org_snapshot_idx").on(table.org_id, table.snapshot_id),
  index("royalty_split_lines_contact_idx").on(table.contact_id),
]);

export const royalty_statements = schema.table("royalty_statements", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  period_start: date("period_start").notNull(),
  period_end: date("period_end").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"),
  opening_balance: numeric("opening_balance", { precision: 20, scale: 8 }).notNull().default("0"),
  earnings_amount: numeric("earnings_amount", { precision: 20, scale: 8 }).notNull().default("0"),
  adjustments_amount: numeric("adjustments_amount", { precision: 20, scale: 8 }).notNull().default("0"),
  payout_amount: numeric("payout_amount", { precision: 20, scale: 8 }).notNull().default("0"),
  closing_balance: numeric("closing_balance", { precision: 20, scale: 8 }).notNull().default("0"),
  issued_at: timestamp("issued_at"),
  due_date: date("due_date"),
  closed_at: timestamp("closed_at"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("royalty_statements_org_period_idx").on(table.org_id, table.period_start, table.period_end),
  index("royalty_statements_contact_idx").on(table.org_id, table.contact_id),
  index("royalty_statements_status_idx").on(table.org_id, table.status),
  check("royalty_statements_status_canonical_check", sql`${table.status} in ('draft', 'calculated', 'reviewed', 'issued', 'closed')`),
]);

export const royalty_payouts = schema.table("royalty_payouts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  statement_id: text("statement_id").references(() => royalty_statements.id),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"),
  payment_method: text("payment_method"),
  reference: text("reference"),
  scheduled_for: date("scheduled_for"),
  paid_at: timestamp("paid_at"),
  failure_reason: text("failure_reason"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("royalty_payouts_org_status_idx").on(table.org_id, table.status),
  index("royalty_payouts_contact_idx").on(table.org_id, table.contact_id),
  index("royalty_payouts_statement_idx").on(table.statement_id),
  check("royalty_payouts_status_canonical_check", sql`${table.status} in ('draft', 'approved', 'recorded', 'failed', 'reversed')`),
]);

export const royalty_statement_lines = schema.table("royalty_statement_lines", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  statement_id: text("statement_id").notNull().references(() => royalty_statements.id),
  earning_id: text("earning_id").references(() => royalty_earnings.id),
  split_line_id: text("split_line_id").references(() => royalty_split_lines.id),
  line_type: text("line_type").notNull().default("earning"),
  description: text("description"),
  share_percent: numeric("share_percent", { precision: 9, scale: 6 }),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("royalty_statement_lines_org_statement_idx").on(table.org_id, table.statement_id),
  index("royalty_statement_lines_earning_idx").on(table.earning_id),
]);

export const royalty_calculation_runs = schema.table("royalty_calculation_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  engine_version: text("engine_version").notNull(),
  status: text("status").notNull().default("draft"),
  idempotency_key: text("idempotency_key").notNull(),
  approved_by: text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approved_at: timestamp("approved_at"),
  reversed_by_run_id: text("reversed_by_run_id").references((): AnyPgColumn => royalty_calculation_runs.id),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("royalty_calculation_runs_org_idempotency_unique_idx").on(table.org_id, table.idempotency_key),
  index("royalty_calculation_runs_org_status_idx").on(table.org_id, table.status),
  index("royalty_calculation_runs_reversed_by_run_idx").on(table.reversed_by_run_id),
  check("royalty_calculation_runs_status_check", sql`${table.status} in ('draft', 'approved', 'reversed')`),
]);

export const royalty_ledger_transactions = schema.table("royalty_ledger_transactions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  idempotency_key: text("idempotency_key").notNull(),
  posting_status: text("posting_status").notNull().default("draft"),
  actor_user_id: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  evidence_reference: text("evidence_reference"),
  reversal_of_transaction_id: text("reversal_of_transaction_id").references((): AnyPgColumn => royalty_ledger_transactions.id),
  effective_date: date("effective_date").notNull(),
  posted_at: timestamp("posted_at"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("royalty_ledger_transactions_org_idempotency_unique_idx").on(table.org_id, table.idempotency_key),
  index("royalty_ledger_transactions_org_status_effective_idx").on(table.org_id, table.posting_status, table.effective_date),
  index("royalty_ledger_transactions_reversal_of_transaction_idx").on(table.reversal_of_transaction_id),
  check("royalty_ledger_transactions_posting_status_check", sql`${table.posting_status} in ('draft', 'posted', 'reversed')`),
]);

export const royalty_ledger_entries = schema.table("royalty_ledger_entries", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  statement_id: text("statement_id").references(() => royalty_statements.id),
  payout_id: text("payout_id").references(() => royalty_payouts.id),
  transaction_id: text("transaction_id").references(() => royalty_ledger_transactions.id),
  entry_type: text("entry_type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  effective_date: date("effective_date").notNull(),
  description: text("description"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("royalty_ledger_entries_org_contact_idx").on(table.org_id, table.contact_id),
  index("royalty_ledger_entries_effective_idx").on(table.org_id, table.effective_date),
  index("royalty_ledger_entries_statement_idx").on(table.statement_id),
  index("royalty_ledger_entries_payout_idx").on(table.payout_id),
  index("royalty_ledger_entries_transaction_idx").on(table.transaction_id),
]);
