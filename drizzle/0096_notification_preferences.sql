CREATE TABLE "label_suite"."notification_preferences" (
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "category" text NOT NULL,
  "enabled_at" timestamp,
  "enabled_role" text NOT NULL,
  "generation" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("org_id", "user_id", "category"),
  FOREIGN KEY ("org_id", "user_id") REFERENCES "label_suite"."org_memberships" ("org_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "notification_preferences_category_check" CHECK (category IN ('assignments', 'deadlines', 'requested_reviews', 'approval_results', 'record_changes')),
  CONSTRAINT "notification_preferences_generation_check" CHECK (generation > 0)
);
--> statement-breakpoint
ALTER TABLE "label_suite"."notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_preference_owner" ON "label_suite"."notification_preferences"
USING (org_id = label_suite.current_org_id() AND user_id = label_suite.current_user_id())
WITH CHECK (org_id = label_suite.current_org_id() AND user_id = label_suite.current_user_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."invalidate_notification_consent"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, label_suite AS $$
DECLARE
  previous_user text := current_setting('app.current_user_id', true);
  previous_org text := current_setting('app.current_org_id', true);
BEGIN
  -- Act only as the member whose role actually changed, then restore the caller.
  -- Required when the function owner is also subject to FORCE ROW LEVEL SECURITY.
  PERFORM set_config('app.current_user_id', NEW.user_id, true);
  PERFORM set_config('app.current_org_id', NEW.org_id, true);
  UPDATE label_suite.notification_preferences
    SET enabled_at = NULL, enabled_role = NEW.role, generation = generation + 1
    WHERE org_id = NEW.org_id AND user_id = NEW.user_id;
  PERFORM set_config('app.current_user_id', coalesce(previous_user, ''), true);
  PERFORM set_config('app.current_org_id', coalesce(previous_org, ''), true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "label_suite"."invalidate_notification_consent"() FROM PUBLIC;
CREATE TRIGGER "notification_consent_role_changed"
AFTER UPDATE OF role ON "label_suite"."org_memberships"
FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role)
EXECUTE FUNCTION "label_suite"."invalidate_notification_consent"();
