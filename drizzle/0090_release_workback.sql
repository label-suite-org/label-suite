ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "release_offset_days" integer;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "workback_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "ops_tasks_workback_key_idx" ON "label_suite"."ops_tasks" ("org_id", "linked_release_id", "workback_key");
