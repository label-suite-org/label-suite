CREATE TABLE "label_suite"."audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"actor_user_id" text,
	"request_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "audit_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "label_suite"."audit_logs" ("org_id","created_at");
CREATE INDEX "audit_logs_entity_idx" ON "label_suite"."audit_logs" ("org_id","entity_type","entity_id");
CREATE INDEX "audit_logs_actor_idx" ON "label_suite"."audit_logs" ("actor_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."current_org_id"() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."current_user_id"() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."write_audit_log"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  target_org_id text;
  target_entity_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    target_org_id := new_row ->> 'org_id';
    target_entity_id := new_row ->> 'id';
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    target_org_id := coalesce(new_row ->> 'org_id', old_row ->> 'org_id');
    target_entity_id := coalesce(new_row ->> 'id', old_row ->> 'id');
  ELSE
    old_row := to_jsonb(OLD);
    target_org_id := old_row ->> 'org_id';
    target_entity_id := old_row ->> 'id';
  END IF;

  INSERT INTO label_suite.audit_logs (
    id, org_id, actor_user_id, request_id, action, entity_type,
    entity_id, before_data, after_data, created_at
  ) VALUES (
    'audit_' || gen_random_uuid()::text,
    target_org_id,
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('app.request_id', true), ''),
    lower(TG_OP),
    TG_TABLE_NAME,
    target_entity_id,
    old_row,
    new_row,
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  target_table text;
  audited_tables text[] := ARRAY[
    'artists', 'releases', 'tracks', 'works', 'roles', 'contacts', 'organizations',
    'budget_projects', 'funding_sources', 'grants', 'grant_applications',
    'royalties_revenue', 'royalty_imports',
    'royalty_split_snapshots', 'royalty_split_lines', 'royalty_statements',
    'royalty_statement_lines', 'royalty_payouts', 'royalty_ledger_entries',
    'ops_tasks', 'calls', 'campaigns', 'reporting_weeks', 'release_reporting'
  ];
BEGIN
  FOREACH target_table IN ARRAY audited_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.%I', target_table);
    EXECUTE format(
      'CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.%I FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log()',
      target_table
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'label_suite'
      AND column_name = 'org_id'
    GROUP BY table_name
  LOOP
    EXECUTE format('ALTER TABLE label_suite.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON label_suite.%I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON label_suite.%I USING (org_id = label_suite.current_org_id()) WITH CHECK (org_id = label_suite.current_org_id())',
      target_table
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "label_suite"."orgs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."orgs";
CREATE POLICY "tenant_isolation" ON "label_suite"."orgs"
USING (
  id = "label_suite"."current_org_id"()
  OR EXISTS (
    SELECT 1 FROM "label_suite"."org_memberships" membership
    WHERE membership.org_id = orgs.id
      AND membership.user_id = "label_suite"."current_user_id"()
  )
)
WITH CHECK (id = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."org_memberships";
CREATE POLICY "tenant_isolation" ON "label_suite"."org_memberships"
USING (
  org_id = "label_suite"."current_org_id"()
  OR user_id = "label_suite"."current_user_id"()
)
WITH CHECK (org_id = "label_suite"."current_org_id"());
