ALTER TABLE "label_suite"."job_runs"
  ALTER COLUMN "status" SET DEFAULT 'queued',
  ALTER COLUMN "attempt" SET DEFAULT 0,
  ALTER COLUMN "started_at" DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL,
  ADD COLUMN IF NOT EXISTS "error_metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "available_at" timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp,
  ADD COLUMN IF NOT EXISTS "finished_at" timestamp,
  ADD COLUMN IF NOT EXISTS "lease_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
UPDATE "label_suite"."job_runs"
SET
  "schema_version" = COALESCE("schema_version", 1),
  "max_attempts" = GREATEST(COALESCE("max_attempts", 5), COALESCE("attempt", 1)),
  "available_at" = COALESCE("available_at", "created_at", now()),
  "finished_at" = COALESCE("finished_at", "completed_at"),
  "updated_at" = COALESCE("updated_at", now());
--> statement-breakpoint
UPDATE "label_suite"."job_runs"
SET
  "status" = 'failed',
  "error" = COALESCE("error", 'Legacy inline run was interrupted before durable leases were enabled'),
  "error_metadata" = '{"code":"LEGACY_UNLEASED_RUN","retryable":false}'::jsonb,
  "finished_at" = COALESCE("finished_at", now()),
  "completed_at" = COALESCE("completed_at", now()),
  "updated_at" = now()
WHERE "status" = 'running' AND "lease_expires_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "label_suite"."job_runs"
  DROP CONSTRAINT IF EXISTS "job_runs_status_check",
  DROP CONSTRAINT IF EXISTS "job_runs_attempts_check",
  ADD CONSTRAINT "job_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')) NOT VALID,
  ADD CONSTRAINT "job_runs_attempts_check"
    CHECK ("attempt" >= 0 AND "max_attempts" > 0 AND "attempt" <= "max_attempts") NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."job_runs" VALIDATE CONSTRAINT "job_runs_status_check";
--> statement-breakpoint
ALTER TABLE "label_suite"."job_runs" VALIDATE CONSTRAINT "job_runs_attempts_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_claim_idx"
  ON "label_suite"."job_runs" ("status", "available_at", "lease_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_runs_org_type_idempotency_unique_idx"
  ON "label_suite"."job_runs" ("org_id", "job_type", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."job_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL,
  "org_id" text NOT NULL,
  "attempt" integer NOT NULL,
  "worker_id" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "heartbeat_at" timestamp,
  "finished_at" timestamp,
  "error_metadata" jsonb,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "job_attempts_job_id_job_runs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "label_suite"."job_runs"("id") ON DELETE cascade,
  CONSTRAINT "job_attempts_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id"),
  CONSTRAINT "job_attempts_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed', 'lease_expired', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_attempts_job_attempt_unique_idx"
  ON "label_suite"."job_attempts" ("job_id", "attempt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_attempts_org_started_idx"
  ON "label_suite"."job_attempts" ("org_id", "started_at");
--> statement-breakpoint
ALTER TABLE "label_suite"."job_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."job_runs";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."job_runs"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
ALTER TABLE "label_suite"."job_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."job_attempts";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."job_attempts"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
