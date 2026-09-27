DROP INDEX "label_suite"."analytics_metric_rows_key_unique_idx";--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD COLUMN "requested_date_range" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD COLUMN "requested_aggregation" text;--> statement-breakpoint
UPDATE "label_suite"."analytics_metric_rows" metric_rows
SET
  "requested_date_range" = COALESCE(import_runs."requested_date_range", 'Unknown'),
  "requested_aggregation" = COALESCE(import_runs."requested_aggregation", 'Unknown')
FROM "label_suite"."analytics_import_runs" import_runs
WHERE metric_rows."last_seen_run_id" = import_runs."id";--> statement-breakpoint
UPDATE "label_suite"."analytics_metric_rows"
SET
  "requested_date_range" = COALESCE("requested_date_range", 'Unknown'),
  "requested_aggregation" = COALESCE("requested_aggregation", 'Unknown');--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ALTER COLUMN "requested_date_range" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ALTER COLUMN "requested_aggregation" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_range_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","source","widget_key","requested_aggregation","requested_date_range");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_metric_rows_key_unique_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","source","widget_key","requested_aggregation","requested_date_range","row_key");
