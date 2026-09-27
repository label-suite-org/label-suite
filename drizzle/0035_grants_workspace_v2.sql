ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium' NOT NULL;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "applicant_type" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "eligible_uses" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "assessment_body" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "response_timing" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "rules" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "research_status" text DEFAULT 'research';
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "research_summary" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "research_source" text;
ALTER TABLE "label_suite"."grants" ADD COLUMN IF NOT EXISTS "last_verified_at" date;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "workflow_stage" text DEFAULT 'idea' NOT NULL;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "outcome" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "next_action" text;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "next_action_due" date;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "angle_narrative" text;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "response_notes" text;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "evaluation" text;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "next_step_recommendation" text;
ALTER TABLE "label_suite"."grant_applications" ADD COLUMN IF NOT EXISTS "source_folder" text;
ALTER TABLE "label_suite"."grant_application_documents" ADD COLUMN IF NOT EXISTS "asset_role" text DEFAULT 'other' NOT NULL;
ALTER TABLE "label_suite"."grant_application_documents" ADD COLUMN IF NOT EXISTS "required" boolean DEFAULT false NOT NULL;
ALTER TABLE "label_suite"."grant_application_documents" ADD COLUMN IF NOT EXISTS "readiness_status" text DEFAULT 'missing' NOT NULL;
UPDATE "label_suite"."grant_applications"
SET "workflow_stage" = CASE lower("status")
  WHEN 'research' THEN 'research'
  WHEN 'writing' THEN 'writing'
  WHEN 'ready' THEN 'ready_to_submit'
  WHEN 'ready_to_submit' THEN 'ready_to_submit'
  WHEN 'submitted' THEN 'submitted'
  WHEN 'decision_pending' THEN 'decision_pending'
  WHEN 'reporting' THEN 'reporting'
  WHEN 'awarded' THEN 'reporting'
  WHEN 'approved' THEN 'reporting'
  WHEN 'rejected' THEN 'closed'
  WHEN 'withdrawn' THEN 'closed'
  WHEN 'not_qualified' THEN 'closed'
  ELSE 'idea'
END,
"outcome" = CASE lower("status")
  WHEN 'awarded' THEN 'approved'
  WHEN 'approved' THEN 'approved'
  WHEN 'partially_approved' THEN 'partially_approved'
  WHEN 'rejected' THEN 'rejected'
  WHEN 'withdrawn' THEN 'withdrawn'
  WHEN 'not_qualified' THEN 'not_qualified'
  ELSE 'unknown'
END;
--> statement-breakpoint
CREATE TABLE "label_suite"."project_funding_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "project_id" text NOT NULL REFERENCES "label_suite"."budget_projects"("id"),
  "owner_contact_id" text REFERENCES "label_suite"."contacts"("id"),
  "priority" text DEFAULT 'medium' NOT NULL,
  "target_date" date,
  "goal" text,
  "funding_narrative" text,
  "deliverables" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "success_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "export_markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_table" text,
  "source_record_id" text,
  "imported_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "project_funding_profiles_org_idx" ON "label_suite"."project_funding_profiles" ("org_id");
CREATE UNIQUE INDEX "project_funding_profiles_project_unique_idx" ON "label_suite"."project_funding_profiles" ("org_id", "project_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."funding_needs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "project_id" text NOT NULL REFERENCES "label_suite"."budget_projects"("id"),
  "title" text NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "use_of_funds" text,
  "target_amount" numeric(18,2) DEFAULT 0 NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "needed_by" date,
  "eligibility" text DEFAULT 'unknown' NOT NULL,
  "success_measure" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "funding_needs_org_project_idx" ON "label_suite"."funding_needs" ("org_id", "project_id");
CREATE INDEX "funding_needs_org_needed_by_idx" ON "label_suite"."funding_needs" ("org_id", "needed_by");
--> statement-breakpoint
CREATE TABLE "label_suite"."funding_need_budget_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "funding_need_id" text NOT NULL REFERENCES "label_suite"."funding_needs"("id"),
  "budget_line_id" text NOT NULL REFERENCES "label_suite"."budget_line_items"("id"),
  "allocated_amount" numeric(18,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX "funding_need_budget_lines_org_idx" ON "label_suite"."funding_need_budget_lines" ("org_id");
CREATE UNIQUE INDEX "funding_need_budget_lines_unique_idx" ON "label_suite"."funding_need_budget_lines" ("org_id", "funding_need_id", "budget_line_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_deadlines" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "grant_id" text NOT NULL REFERENCES "label_suite"."grants"("id"),
  "deadline_date" date NOT NULL,
  "label" text,
  "opens_on" date,
  "expected_response_date" date,
  "status" text DEFAULT 'planned' NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_deadlines_org_date_idx" ON "label_suite"."grant_deadlines" ("org_id", "deadline_date");
CREATE INDEX "grant_deadlines_grant_idx" ON "label_suite"."grant_deadlines" ("grant_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_application_funding_needs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "application_id" text NOT NULL REFERENCES "label_suite"."grant_applications"("id"),
  "funding_need_id" text NOT NULL REFERENCES "label_suite"."funding_needs"("id"),
  "amount_requested" numeric(18,2) DEFAULT 0 NOT NULL,
  "amount_awarded" numeric(18,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_application_funding_needs_org_idx" ON "label_suite"."grant_application_funding_needs" ("org_id");
CREATE UNIQUE INDEX "grant_application_funding_needs_unique_idx" ON "label_suite"."grant_application_funding_needs" ("org_id", "application_id", "funding_need_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_requirements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "grant_id" text NOT NULL REFERENCES "label_suite"."grants"("id"),
  "name" text NOT NULL,
  "description" text,
  "asset_role" text,
  "required" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_requirements_org_grant_idx" ON "label_suite"."grant_requirements" ("org_id", "grant_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_application_requirements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "application_id" text NOT NULL REFERENCES "label_suite"."grant_applications"("id"),
  "requirement_id" text REFERENCES "label_suite"."grant_requirements"("id"),
  "document_id" text REFERENCES "label_suite"."documents"("id"),
  "required" boolean DEFAULT true NOT NULL,
  "readiness_status" text DEFAULT 'missing' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_application_requirements_org_application_idx" ON "label_suite"."grant_application_requirements" ("org_id", "application_id");
CREATE INDEX "grant_application_requirements_document_idx" ON "label_suite"."grant_application_requirements" ("document_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_application_calls" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "application_id" text NOT NULL REFERENCES "label_suite"."grant_applications"("id"),
  "call_id" text NOT NULL REFERENCES "label_suite"."calls"("id"),
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_application_calls_org_idx" ON "label_suite"."grant_application_calls" ("org_id");
CREATE UNIQUE INDEX "grant_application_calls_unique_idx" ON "label_suite"."grant_application_calls" ("org_id", "application_id", "call_id");
--> statement-breakpoint
CREATE TABLE "label_suite"."grant_application_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "application_id" text NOT NULL REFERENCES "label_suite"."grant_applications"("id"),
  "event_type" text NOT NULL,
  "actor_contact_id" text REFERENCES "label_suite"."contacts"("id"),
  "from_value" text,
  "to_value" text,
  "note" text,
  "metadata" jsonb,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX "grant_application_events_org_application_idx" ON "label_suite"."grant_application_events" ("org_id", "application_id");
CREATE INDEX "grant_application_events_org_occurred_idx" ON "label_suite"."grant_application_events" ("org_id", "occurred_at");
CREATE INDEX "grant_applications_workflow_idx" ON "label_suite"."grant_applications" ("org_id", "workflow_stage");
CREATE INDEX "grant_applications_outcome_idx" ON "label_suite"."grant_applications" ("org_id", "outcome");
CREATE INDEX "grant_applications_next_action_idx" ON "label_suite"."grant_applications" ("org_id", "next_action_due");
--> statement-breakpoint
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'project_funding_profiles', 'funding_needs', 'funding_need_budget_lines',
    'grant_deadlines', 'grant_application_funding_needs', 'grant_requirements',
    'grant_application_requirements', 'grant_application_calls', 'grant_application_events'
  ] LOOP
    EXECUTE format('ALTER TABLE label_suite.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('CREATE POLICY tenant_isolation ON label_suite.%I USING (org_id = label_suite.current_org_id()) WITH CHECK (org_id = label_suite.current_org_id())', target_table);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."enforce_same_org_references"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  pair_index integer;
  reference_column text;
  reference_table text;
  reference_id text;
  reference_org_id text;
BEGIN
  IF TG_NARGS = 0 OR mod(TG_NARGS, 2) <> 0 THEN
    RAISE EXCEPTION 'enforce_same_org_references requires column/table argument pairs';
  END IF;

  FOR pair_index IN 0..TG_NARGS - 1 BY 2 LOOP
    reference_column := TG_ARGV[pair_index];
    reference_table := TG_ARGV[pair_index + 1];
    reference_id := to_jsonb(NEW) ->> reference_column;
    CONTINUE WHEN reference_id IS NULL;

    reference_org_id := NULL;
    EXECUTE format('SELECT org_id FROM label_suite.%I WHERE id = $1', reference_table)
      INTO reference_org_id
      USING reference_id;

    IF reference_org_id IS NULL THEN
      RAISE EXCEPTION 'Referenced %.id % does not exist', reference_table, reference_id
        USING ERRCODE = '23503';
    END IF;
    IF reference_org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'Cross-organization reference from %.% to %.id %',
        TG_TABLE_NAME, reference_column, reference_table, reference_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS same_org_references ON label_suite.project_funding_profiles;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.project_funding_profiles FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'owner_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.funding_needs;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.funding_needs FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.funding_need_budget_lines;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.funding_need_budget_lines FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('funding_need_id', 'funding_needs', 'budget_line_id', 'budget_line_items');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_deadlines;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_deadlines FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('grant_id', 'grants');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_application_funding_needs;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_application_funding_needs FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('application_id', 'grant_applications', 'funding_need_id', 'funding_needs');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_requirements;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_requirements FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('grant_id', 'grants');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_application_requirements;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_application_requirements FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('application_id', 'grant_applications', 'requirement_id', 'grant_requirements', 'document_id', 'documents');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_application_calls;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_application_calls FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('application_id', 'grant_applications', 'call_id', 'calls');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_application_events;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_application_events FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('application_id', 'grant_applications', 'actor_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_applications;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_applications FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('project_id', 'budget_projects', 'grant_id', 'grants', 'funding_source_id', 'funding_sources', 'owner_contact_id', 'contacts');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_application_documents;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_application_documents FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('application_id', 'grant_applications', 'document_id', 'documents');
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.project_funding_profiles;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.project_funding_profiles FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.funding_needs;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.funding_needs FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.funding_need_budget_lines;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.funding_need_budget_lines FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_deadlines;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_deadlines FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_application_funding_needs;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_application_funding_needs FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_requirements;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_requirements FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_application_requirements;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_application_requirements FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_application_calls;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_application_calls FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_application_events;
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_application_events FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
