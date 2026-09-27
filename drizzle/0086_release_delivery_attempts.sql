-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS "label_suite"."release_delivery_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "release_id" text NOT NULL REFERENCES "label_suite"."releases"("id") ON DELETE CASCADE,
  "provider_key" text NOT NULL,
  "account_label" text NOT NULL,
  "payload_version" integer DEFAULT 1 NOT NULL,
  "patch_version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'exported' NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "response_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sync_job_id" text REFERENCES "label_suite"."sync_jobs"("id"),
  "error_code" text,
  "error_message" text,
  "created_by" text REFERENCES "label_suite"."user"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "release_delivery_attempts_version_check" CHECK ("payload_version" > 0 and "patch_version" > 0),
  CONSTRAINT "release_delivery_attempts_status_check" CHECK ("status" in ('exported', 'submitted', 'accepted', 'failed', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "release_delivery_attempts_version_unique_idx" ON "label_suite"."release_delivery_attempts" ("org_id", "release_id", "provider_key", "account_label", "payload_version", "patch_version");
CREATE INDEX IF NOT EXISTS "release_delivery_attempts_org_created_idx" ON "label_suite"."release_delivery_attempts" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "release_delivery_attempts_release_idx" ON "label_suite"."release_delivery_attempts" ("org_id", "release_id", "created_at");
CREATE INDEX IF NOT EXISTS "release_delivery_attempts_status_idx" ON "label_suite"."release_delivery_attempts" ("org_id", "status");
