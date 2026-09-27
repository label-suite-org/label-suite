ALTER TABLE "label_suite"."analytics_duplicate_reviews"
  ALTER COLUMN "org_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files"
  ADD COLUMN "storage_status" text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN "storage_uploaded_at" timestamp with time zone,
  ADD COLUMN "storage_error" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files"
  ADD CONSTRAINT "analytics_import_files_storage_status_check"
  CHECK ("storage_status" IN ('not_requested', 'pending', 'uploaded', 'failed'));
