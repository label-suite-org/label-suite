CREATE TABLE IF NOT EXISTS "label_suite"."campaign_communicator_prompts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "prompt" text NOT NULL,
  "created_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_communicator_prompts_org_id_idx" ON "label_suite"."campaign_communicator_prompts" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_communicator_prompts_campaign_id_idx" ON "label_suite"."campaign_communicator_prompts" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_communicator_prompts_org_campaign_version_unique_idx" ON "label_suite"."campaign_communicator_prompts" ("org_id", "campaign_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_enrichment_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "lead_id" text NOT NULL REFERENCES "label_suite"."campaign_leads"("id") ON DELETE CASCADE,
  "prompt_id" text REFERENCES "label_suite"."campaign_communicator_prompts"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp DEFAULT now(),
  "completed_at" timestamp,
  "failure_reason" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_enrichment_runs_status_check" CHECK ("status" IN ('running', 'completed', 'failed', 'refused'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_enrichment_runs_org_id_idx" ON "label_suite"."campaign_enrichment_runs" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_runs_campaign_id_idx" ON "label_suite"."campaign_enrichment_runs" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_runs_lead_id_idx" ON "label_suite"."campaign_enrichment_runs" ("lead_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrichment_runs_org_lead_running_unique_idx" ON "label_suite"."campaign_enrichment_runs" ("org_id", "lead_id") WHERE "status" = 'running';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_enrichment_suggestions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "lead_id" text NOT NULL REFERENCES "label_suite"."campaign_leads"("id") ON DELETE CASCADE,
  "enrichment_run_id" text NOT NULL REFERENCES "label_suite"."campaign_enrichment_runs"("id") ON DELETE CASCADE,
  "suggestion_type" text NOT NULL,
  "suggested_value" jsonb NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "resolved_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_enrichment_suggestions_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_enrichment_suggestions_org_id_idx" ON "label_suite"."campaign_enrichment_suggestions" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_suggestions_campaign_id_idx" ON "label_suite"."campaign_enrichment_suggestions" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_suggestions_lead_id_idx" ON "label_suite"."campaign_enrichment_suggestions" ("lead_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_suggestions_run_id_idx" ON "label_suite"."campaign_enrichment_suggestions" ("enrichment_run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_outreach_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "lead_id" text REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL,
  "enrichment_run_id" text REFERENCES "label_suite"."campaign_enrichment_runs"("id") ON DELETE SET NULL,
  "scope" text NOT NULL,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "context_snapshot" jsonb NOT NULL,
  "approval_hash" text,
  "approved_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_outreach_drafts_scope_check" CHECK ("scope" IN ('focused', 'radio_update')),
  CONSTRAINT "campaign_outreach_drafts_status_check" CHECK ("status" IN ('draft', 'approved', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_outreach_drafts_org_id_idx" ON "label_suite"."campaign_outreach_drafts" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_drafts_campaign_id_idx" ON "label_suite"."campaign_outreach_drafts" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_drafts_lead_id_idx" ON "label_suite"."campaign_outreach_drafts" ("lead_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_outreach_drafts_org_lead_version_unique_idx" ON "label_suite"."campaign_outreach_drafts" ("org_id", "lead_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_outreach_drafts_org_campaign_scope_version_without_lead_unique_idx" ON "label_suite"."campaign_outreach_drafts" ("org_id", "campaign_id", "scope", "version") WHERE "lead_id" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_outreach_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "lead_id" text REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL,
  "draft_id" text REFERENCES "label_suite"."campaign_outreach_drafts"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_outreach_events_org_id_idx" ON "label_suite"."campaign_outreach_events" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_events_campaign_id_idx" ON "label_suite"."campaign_outreach_events" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_events_lead_id_idx" ON "label_suite"."campaign_outreach_events" ("lead_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_events_draft_id_idx" ON "label_suite"."campaign_outreach_events" ("draft_id");
CREATE INDEX IF NOT EXISTS "campaign_outreach_events_occurred_at_idx" ON "label_suite"."campaign_outreach_events" ("org_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_leads" ADD COLUMN IF NOT EXISTS "contact_route_verified_at" timestamp;
ALTER TABLE "label_suite"."campaign_leads" ADD COLUMN IF NOT EXISTS "readiness_task_waiver_reason" text;
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD COLUMN IF NOT EXISTS "linked_lead_id" text;
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD COLUMN IF NOT EXISTS "linked_draft_id" text;
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD COLUMN IF NOT EXISTS "linked_enrichment_run_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_dogfood_entries" DROP CONSTRAINT IF EXISTS "campaign_dogfood_entries_linked_lead_id_campaign_leads_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD CONSTRAINT "campaign_dogfood_entries_linked_lead_id_campaign_leads_id_fk" FOREIGN KEY ("linked_lead_id") REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."campaign_dogfood_entries" VALIDATE CONSTRAINT "campaign_dogfood_entries_linked_lead_id_campaign_leads_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries" DROP CONSTRAINT IF EXISTS "campaign_dogfood_entries_linked_draft_id_campaign_outreach_drafts_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD CONSTRAINT "campaign_dogfood_entries_linked_draft_id_campaign_outreach_drafts_id_fk" FOREIGN KEY ("linked_draft_id") REFERENCES "label_suite"."campaign_outreach_drafts"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."campaign_dogfood_entries" VALIDATE CONSTRAINT "campaign_dogfood_entries_linked_draft_id_campaign_outreach_drafts_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries" DROP CONSTRAINT IF EXISTS "campaign_dogfood_entries_linked_enrichment_run_id_campaign_enrichment_runs_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD CONSTRAINT "campaign_dogfood_entries_linked_enrichment_run_id_campaign_enrichment_runs_id_fk" FOREIGN KEY ("linked_enrichment_run_id") REFERENCES "label_suite"."campaign_enrichment_runs"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."campaign_dogfood_entries" VALIDATE CONSTRAINT "campaign_dogfood_entries_linked_enrichment_run_id_campaign_enrichment_runs_id_fk";
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_linked_lead_id_idx" ON "label_suite"."campaign_dogfood_entries" ("linked_lead_id");
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_linked_draft_id_idx" ON "label_suite"."campaign_dogfood_entries" ("linked_draft_id");
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_linked_enrichment_run_id_idx" ON "label_suite"."campaign_dogfood_entries" ("linked_enrichment_run_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_communicator_prompts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_enrichment_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_enrichment_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_outreach_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_outreach_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_communicator_prompts";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_communicator_prompts" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_enrichment_runs";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_enrichment_runs" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_enrichment_suggestions";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_enrichment_suggestions" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_outreach_drafts";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_outreach_drafts" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_outreach_events";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_outreach_events" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_communicator_prompts";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_communicator_prompts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_enrichment_runs";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_enrichment_runs" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'lead_id', 'campaign_leads', 'prompt_id', 'campaign_communicator_prompts');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_enrichment_suggestions";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_enrichment_suggestions" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'lead_id', 'campaign_leads', 'enrichment_run_id', 'campaign_enrichment_runs');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_outreach_drafts";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_outreach_drafts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'lead_id', 'campaign_leads', 'enrichment_run_id', 'campaign_enrichment_runs');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_outreach_events";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_outreach_events" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'lead_id', 'campaign_leads', 'draft_id', 'campaign_outreach_drafts');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_dogfood_entries";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_dogfood_entries" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'linked_lead_id', 'campaign_leads', 'linked_draft_id', 'campaign_outreach_drafts', 'linked_enrichment_run_id', 'campaign_enrichment_runs');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_communicator_prompts";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_communicator_prompts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_enrichment_runs";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_enrichment_runs" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_enrichment_suggestions";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_enrichment_suggestions" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_outreach_drafts";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_outreach_drafts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_outreach_events";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_outreach_events" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
