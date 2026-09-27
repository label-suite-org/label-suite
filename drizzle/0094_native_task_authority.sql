ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "linked_grant_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" DROP CONSTRAINT IF EXISTS "ops_tasks_linked_grant_id_grants_id_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_grant_id_grants_id_fk" FOREIGN KEY ("linked_grant_id") REFERENCES "label_suite"."grants"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" VALIDATE CONSTRAINT "ops_tasks_linked_grant_id_grants_id_fk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_tasks_linked_grant_id_idx" ON "label_suite"."ops_tasks" USING btree ("linked_grant_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."bump_ops_task_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.task_name, NEW.status, NEW.priority, NEW.owner, NEW.assignee_ids, NEW.labels, NEW.dependency_ids,
    NEW.due_date, NEW.linked_artist_id, NEW.linked_release_id, NEW.release_milestone_id, NEW.timeline_phase,
    NEW.release_offset_days, NEW.workback_key, NEW.linked_campaign_id, NEW.linked_grant_id,
    NEW.linked_campaign_lead_id, NEW.linked_contact_id, NEW.owner_contact_id, NEW.project_id, NEW.event_id,
    NEW.notes, NEW.next_action
  ) IS DISTINCT FROM ROW(
    OLD.task_name, OLD.status, OLD.priority, OLD.owner, OLD.assignee_ids, OLD.labels, OLD.dependency_ids,
    OLD.due_date, OLD.linked_artist_id, OLD.linked_release_id, OLD.release_milestone_id, OLD.timeline_phase,
    OLD.release_offset_days, OLD.workback_key, OLD.linked_campaign_id, OLD.linked_grant_id,
    OLD.linked_campaign_lead_id, OLD.linked_contact_id, OLD.owner_contact_id, OLD.project_id, OLD.event_id,
    OLD.notes, OLD.next_action
  ) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ops_tasks_bump_revision" ON "label_suite"."ops_tasks";
--> statement-breakpoint
CREATE TRIGGER "ops_tasks_bump_revision" BEFORE UPDATE ON "label_suite"."ops_tasks"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."bump_ops_task_revision"();
