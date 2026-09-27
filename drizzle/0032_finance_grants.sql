CREATE TABLE "label_suite"."grants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"name" text NOT NULL,
	"funder" text,
	"program" text,
	"category" text,
	"url" text,
	"research_url" text,
	"description" text,
	"requirements" text,
	"opens_on" date,
	"deadline" date,
	"max_amount" numeric(18,2),
	"currency" text DEFAULT 'DKK' NOT NULL,
	"priority" text DEFAULT 'medium',
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "grants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"project_id" text,
	"grant_id" text,
	"funding_source_id" text,
	"owner_contact_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"amount_requested" numeric(18,2),
	"amount_awarded" numeric(18,2),
	"submission_deadline" date,
	"submitted_at" timestamp,
	"decision_date" date,
	"reporting_due" date,
	"external_reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "grant_applications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_applications_project_id_budget_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "label_suite"."budget_projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_applications_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "label_suite"."grants"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_applications_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "label_suite"."funding_sources"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_applications_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_application_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"application_id" text NOT NULL,
	"document_id" text NOT NULL,
	"link_type" text DEFAULT 'attachment' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "grant_application_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_application_documents_application_id_grant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "label_suite"."grant_applications"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "grant_application_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "label_suite"."documents"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"storage_key" text,
	"sha256" text,
	"period_start" date,
	"period_end" date,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_imports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"import_id" text,
	"source_row_id" text NOT NULL,
	"source" text NOT NULL,
	"report_period" text,
	"platform" text,
	"platform_detail" text,
	"territory_code" text,
	"revenue_stream" text,
	"usage_type" text,
	"units" integer DEFAULT 0,
	"percentage" numeric(9,6),
	"gross_amount" numeric(20,8),
	"fees_amount" numeric(20,8) DEFAULT 0,
	"net_amount" numeric(20,8) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"isrc" text,
	"upc" text,
	"track_title" text,
	"artist_name" text,
	"work_id" text,
	"track_id" text,
	"release_id" text,
	"artist_id" text,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_earnings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_earnings_import_id_royalty_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "label_suite"."royalty_imports"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_earnings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_earnings_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_earnings_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_earnings_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_split_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"work_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_split_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_split_snapshots_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_split_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"snapshot_id" text NOT NULL,
	"contact_id" text,
	"role_id" text,
	"payee_name" text NOT NULL,
	"scope" text,
	"share_percent" numeric(9,6) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_split_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_split_lines_snapshot_id_royalty_split_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "label_suite"."royalty_split_snapshots"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_split_lines_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_split_lines_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "label_suite"."roles"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"contact_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opening_balance" numeric(20,8) DEFAULT 0 NOT NULL,
	"earnings_amount" numeric(20,8) DEFAULT 0 NOT NULL,
	"adjustments_amount" numeric(20,8) DEFAULT 0 NOT NULL,
	"payout_amount" numeric(20,8) DEFAULT 0 NOT NULL,
	"closing_balance" numeric(20,8) DEFAULT 0 NOT NULL,
	"issued_at" timestamp,
	"due_date" date,
	"closed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_statements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_statements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"contact_id" text NOT NULL,
	"statement_id" text,
	"amount" numeric(20,8) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"payment_method" text,
	"reference" text,
	"scheduled_for" date,
	"paid_at" timestamp,
	"failure_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_payouts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_payouts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_payouts_statement_id_royalty_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "label_suite"."royalty_statements"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_statement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"statement_id" text NOT NULL,
	"earning_id" text,
	"split_line_id" text,
	"line_type" text DEFAULT 'earning' NOT NULL,
	"description" text,
	"share_percent" numeric(9,6),
	"amount" numeric(20,8) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_statement_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_statement_lines_statement_id_royalty_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "label_suite"."royalty_statements"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_statement_lines_earning_id_royalty_earnings_id_fk" FOREIGN KEY ("earning_id") REFERENCES "label_suite"."royalty_earnings"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_statement_lines_split_line_id_royalty_split_lines_id_fk" FOREIGN KEY ("split_line_id") REFERENCES "label_suite"."royalty_split_lines"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."royalty_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"contact_id" text NOT NULL,
	"statement_id" text,
	"payout_id" text,
	"entry_type" text NOT NULL,
	"amount" numeric(20,8) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"effective_date" date NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "royalty_ledger_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_ledger_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_ledger_entries_statement_id_royalty_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "label_suite"."royalty_statements"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "royalty_ledger_entries_payout_id_royalty_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "label_suite"."royalty_payouts"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "grants_org_deadline_idx" ON "label_suite"."grants" ("org_id","deadline");
CREATE INDEX "grants_org_status_idx" ON "label_suite"."grants" ("org_id","status");
CREATE INDEX "grants_funder_idx" ON "label_suite"."grants" ("funder");
CREATE INDEX "grant_applications_org_deadline_idx" ON "label_suite"."grant_applications" ("org_id","submission_deadline");
CREATE INDEX "grant_applications_project_idx" ON "label_suite"."grant_applications" ("project_id");
CREATE INDEX "grant_applications_grant_idx" ON "label_suite"."grant_applications" ("grant_id");
CREATE INDEX "grant_applications_status_idx" ON "label_suite"."grant_applications" ("org_id","status");
CREATE INDEX "grant_application_documents_org_id_idx" ON "label_suite"."grant_application_documents" ("org_id");
CREATE INDEX "grant_application_documents_application_idx" ON "label_suite"."grant_application_documents" ("application_id");
CREATE INDEX "grant_application_documents_document_idx" ON "label_suite"."grant_application_documents" ("document_id");
CREATE UNIQUE INDEX "grant_application_documents_unique_idx" ON "label_suite"."grant_application_documents" ("org_id","application_id","document_id");
CREATE INDEX "royalty_imports_org_started_idx" ON "label_suite"."royalty_imports" ("org_id","started_at");
CREATE INDEX "royalty_imports_source_status_idx" ON "label_suite"."royalty_imports" ("source","status");
CREATE UNIQUE INDEX "royalty_imports_org_sha_unique_idx" ON "label_suite"."royalty_imports" ("org_id","sha256") WHERE "sha256" is not null;
CREATE INDEX "royalty_earnings_org_period_idx" ON "label_suite"."royalty_earnings" ("org_id","report_period");
CREATE INDEX "royalty_earnings_import_idx" ON "label_suite"."royalty_earnings" ("import_id");
CREATE INDEX "royalty_earnings_isrc_idx" ON "label_suite"."royalty_earnings" ("org_id","isrc");
CREATE INDEX "royalty_earnings_match_status_idx" ON "label_suite"."royalty_earnings" ("org_id","match_status");
CREATE INDEX "royalty_earnings_track_idx" ON "label_suite"."royalty_earnings" ("track_id");
CREATE UNIQUE INDEX "royalty_earnings_source_row_unique_idx" ON "label_suite"."royalty_earnings" ("org_id","source","source_row_id");
CREATE INDEX "royalty_split_snapshots_org_work_idx" ON "label_suite"."royalty_split_snapshots" ("org_id","work_id");
CREATE INDEX "royalty_split_snapshots_effective_idx" ON "label_suite"."royalty_split_snapshots" ("effective_from","effective_to");
CREATE INDEX "royalty_split_lines_org_snapshot_idx" ON "label_suite"."royalty_split_lines" ("org_id","snapshot_id");
CREATE INDEX "royalty_split_lines_contact_idx" ON "label_suite"."royalty_split_lines" ("contact_id");
CREATE INDEX "royalty_statements_org_period_idx" ON "label_suite"."royalty_statements" ("org_id","period_start","period_end");
CREATE INDEX "royalty_statements_contact_idx" ON "label_suite"."royalty_statements" ("org_id","contact_id");
CREATE INDEX "royalty_statements_status_idx" ON "label_suite"."royalty_statements" ("org_id","status");
CREATE INDEX "royalty_payouts_org_status_idx" ON "label_suite"."royalty_payouts" ("org_id","status");
CREATE INDEX "royalty_payouts_contact_idx" ON "label_suite"."royalty_payouts" ("org_id","contact_id");
CREATE INDEX "royalty_payouts_statement_idx" ON "label_suite"."royalty_payouts" ("statement_id");
CREATE INDEX "royalty_statement_lines_org_statement_idx" ON "label_suite"."royalty_statement_lines" ("org_id","statement_id");
CREATE INDEX "royalty_statement_lines_earning_idx" ON "label_suite"."royalty_statement_lines" ("earning_id");
CREATE INDEX "royalty_ledger_entries_org_contact_idx" ON "label_suite"."royalty_ledger_entries" ("org_id","contact_id");
CREATE INDEX "royalty_ledger_entries_effective_idx" ON "label_suite"."royalty_ledger_entries" ("org_id","effective_date");
CREATE INDEX "royalty_ledger_entries_statement_idx" ON "label_suite"."royalty_ledger_entries" ("statement_id");
CREATE INDEX "royalty_ledger_entries_payout_idx" ON "label_suite"."royalty_ledger_entries" ("payout_id");
