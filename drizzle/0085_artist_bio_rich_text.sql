ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_document" jsonb;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_html" text;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_review_status" text NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_reviewed_hash" text;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN IF NOT EXISTS "bio_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" DROP CONSTRAINT IF EXISTS "artists_bio_review_status_check";--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD CONSTRAINT "artists_bio_review_status_check" CHECK ("bio_review_status" IN ('draft', 'reviewed'));
