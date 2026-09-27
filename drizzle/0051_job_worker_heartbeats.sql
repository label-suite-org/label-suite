CREATE TABLE IF NOT EXISTS "label_suite"."job_workers" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "stopped_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "job_workers_status_check" CHECK ("status" IN ('running', 'stopped'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_workers_status_seen_idx"
  ON "label_suite"."job_workers" ("status", "last_seen_at");
