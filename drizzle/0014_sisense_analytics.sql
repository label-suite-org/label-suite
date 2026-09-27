CREATE TABLE "label_suite"."analytics_import_files" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"run_id" text NOT NULL,
	"source" text NOT NULL,
	"dashboard_url" text,
	"widget_key" text NOT NULL,
	"widget_title" text,
	"requested_date_range" text,
	"requested_aggregation" text,
	"file_name" text NOT NULL,
	"local_path" text,
	"storage_bucket" text,
	"storage_key" text,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"row_count" integer DEFAULT 0,
	"headers" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."analytics_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"source" text NOT NULL,
	"mode" text DEFAULT 'sync' NOT NULL,
	"requested_date_range" text,
	"requested_aggregation" text,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"files_downloaded" integer DEFAULT 0,
	"rows_imported" integer DEFAULT 0,
	"rows_inserted" integer DEFAULT 0,
	"rows_updated" integer DEFAULT 0,
	"rows_unchanged" integer DEFAULT 0,
	"error" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "label_suite"."analytics_metric_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"run_id" text NOT NULL,
	"metric_row_id" text NOT NULL,
	"source" text NOT NULL,
	"widget_key" text NOT NULL,
	"row_key" text NOT NULL,
	"change_type" text NOT NULL,
	"previous_hash" text,
	"current_hash" text,
	"previous_raw_row" jsonb,
	"current_raw_row" jsonb,
	"changed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."analytics_metric_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"source" text NOT NULL,
	"widget_key" text NOT NULL,
	"row_key" text NOT NULL,
	"row_hash" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"raw_row" jsonb NOT NULL,
	"first_seen_run_id" text,
	"last_seen_run_id" text,
	"first_seen_at" timestamp DEFAULT now(),
	"last_seen_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD CONSTRAINT "analytics_import_files_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD CONSTRAINT "analytics_import_files_run_id_analytics_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "label_suite"."analytics_import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD CONSTRAINT "analytics_import_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_run_id_analytics_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "label_suite"."analytics_import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_metric_row_id_analytics_metric_rows_id_fk" FOREIGN KEY ("metric_row_id") REFERENCES "label_suite"."analytics_metric_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_first_seen_run_id_analytics_import_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "label_suite"."analytics_import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_last_seen_run_id_analytics_import_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "label_suite"."analytics_import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_import_files_org_id_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "analytics_import_files_run_id_idx" ON "label_suite"."analytics_import_files" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "analytics_import_files_widget_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id","source","widget_key");--> statement-breakpoint
CREATE INDEX "analytics_import_files_content_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id","source","widget_key","sha256");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_org_id_idx" ON "label_suite"."analytics_import_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_source_status_idx" ON "label_suite"."analytics_import_runs" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_started_at_idx" ON "label_suite"."analytics_import_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_org_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_run_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_metric_row_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("metric_row_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_widget_idx" ON "label_suite"."analytics_metric_changes" USING btree ("org_id","source","widget_key");--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_org_id_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_widget_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","source","widget_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_metric_rows_key_unique_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","source","widget_key","row_key");