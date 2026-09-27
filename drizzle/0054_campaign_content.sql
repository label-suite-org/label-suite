CREATE TABLE IF NOT EXISTS "label_suite"."temp_campaign_content_guard" (
  "id" text
);
DROP TABLE "label_suite"."temp_campaign_content_guard";
--> statement-breakpoint
ALTER TABLE "label_suite"."email_templates"
  ADD COLUMN IF NOT EXISTS "channel" text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS "current_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "review_status" text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "reviewed_by" text,
  ADD COLUMN IF NOT EXISTS "source_version" integer,
  ADD COLUMN IF NOT EXISTS "source_references" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns"
  ADD COLUMN IF NOT EXISTS "reviewed_template_id" text REFERENCES "label_suite"."email_templates"("id"),
  ADD COLUMN IF NOT EXISTS "content_channel" text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS "content_provider" text NOT NULL DEFAULT 'brevo',
  ADD COLUMN IF NOT EXISTS "content_operator_id" text,
  ADD COLUMN IF NOT EXISTS "content_source_version" integer,
  ADD COLUMN IF NOT EXISTS "content_source_references" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_reviewed_template_idx" ON "label_suite"."campaigns" ("reviewed_template_id");
