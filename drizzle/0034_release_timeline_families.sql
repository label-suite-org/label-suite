CREATE TABLE IF NOT EXISTS "label_suite"."release_milestones" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "release_id" text NOT NULL,
  "title" text NOT NULL,
  "phase" text NOT NULL,
  "due_date" date,
  "status" text DEFAULT 'todo' NOT NULL,
  "owner" text,
  "notes" text,
  "is_blocking" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "release_milestones_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id")
);
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "release_milestone_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "timeline_phase" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."releases" ADD COLUMN IF NOT EXISTS "parent_release_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."release_milestones" DROP CONSTRAINT IF EXISTS "release_milestones_release_id_releases_id_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."release_milestones" ADD CONSTRAINT "release_milestones_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."release_milestones" VALIDATE CONSTRAINT "release_milestones_release_id_releases_id_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" DROP CONSTRAINT IF EXISTS "ops_tasks_release_milestone_id_fkey";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_release_milestone_id_fkey" FOREIGN KEY ("release_milestone_id") REFERENCES "label_suite"."release_milestones"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" VALIDATE CONSTRAINT "ops_tasks_release_milestone_id_fkey";
--> statement-breakpoint
ALTER TABLE "label_suite"."releases" DROP CONSTRAINT IF EXISTS "releases_parent_release_id_fkey";
--> statement-breakpoint
ALTER TABLE "label_suite"."releases" ADD CONSTRAINT "releases_parent_release_id_fkey" FOREIGN KEY ("parent_release_id") REFERENCES "label_suite"."releases"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."releases" VALIDATE CONSTRAINT "releases_parent_release_id_fkey";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" DROP CONSTRAINT IF EXISTS "ops_tasks_timeline_phase_check";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_timeline_phase_check" CHECK ("timeline_phase" IS NULL OR "timeline_phase" IN ('strategy_lock', 'assets_metadata', 'distribution_dsp', 'campaign_rollout', 'release_week', 'post_release')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" VALIDATE CONSTRAINT "ops_tasks_timeline_phase_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "release_milestones_org_release_phase_idx" ON "label_suite"."release_milestones" ("org_id", "release_id", "phase", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_tasks_release_milestone_idx" ON "label_suite"."ops_tasks" ("org_id", "release_milestone_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_tasks_timeline_phase_idx" ON "label_suite"."ops_tasks" ("org_id", "linked_release_id", "timeline_phase");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_parent_release_id_idx" ON "label_suite"."releases" ("org_id", "parent_release_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."release_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."release_milestones";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."release_milestones" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."release_milestones";
--> statement-breakpoint
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."release_milestones" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
