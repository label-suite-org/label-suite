ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "event_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" DROP CONSTRAINT IF EXISTS "ops_tasks_event_id_project_events_id_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_event_id_project_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "label_suite"."project_events"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" VALIDATE CONSTRAINT "ops_tasks_event_id_project_events_id_fk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_tasks_event_id_idx" ON "label_suite"."ops_tasks" ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_tasks_org_event_id_idx" ON "label_suite"."ops_tasks" ("org_id", "event_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS same_org_references ON label_suite.ops_tasks;
--> statement-breakpoint
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.ops_tasks
  FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('event_id', 'project_events');
