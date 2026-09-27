ALTER TABLE "label_suite"."campaigns"
  ADD COLUMN IF NOT EXISTS "goal_document" jsonb,
  ADD COLUMN IF NOT EXISTS "notes_document" jsonb;
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_outreach_drafts"
  ADD COLUMN IF NOT EXISTS "body_document" jsonb,
  ADD COLUMN IF NOT EXISTS "body_html" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_editor_ai_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "surface" text NOT NULL,
  "lead_id" text REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL,
  "draft_id" text REFERENCES "label_suite"."campaign_outreach_drafts"("id") ON DELETE SET NULL,
  "page_revision_id" text REFERENCES "label_suite"."campaign_public_page_revisions"("id") ON DELETE SET NULL,
  "operation" text NOT NULL,
  "scope" text NOT NULL,
  "selection_from" integer,
  "selection_to" integer,
  "input_document_hash" text NOT NULL,
  "context_manifest" jsonb NOT NULL,
  "proposed_document" jsonb,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "rationale" text,
  "citation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "failure_category" text,
  "decided_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "decided_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_editor_ai_runs_surface_check" CHECK ("surface" IN ('campaign_goal', 'campaign_notes', 'public_release_note', 'focused_outreach_body', 'radio_update_body')),
  CONSTRAINT "campaign_editor_ai_runs_operation_check" CHECK ("operation" IN ('draft', 'enrich', 'improve', 'shorten', 'tone', 'custom')),
  CONSTRAINT "campaign_editor_ai_runs_scope_check" CHECK ("scope" IN ('selection', 'document')),
  CONSTRAINT "campaign_editor_ai_runs_status_check" CHECK ("status" IN ('running', 'ready', 'accepted', 'rejected', 'failed', 'stale'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_org_id_idx" ON "label_suite"."campaign_editor_ai_runs" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_campaign_id_idx" ON "label_suite"."campaign_editor_ai_runs" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_org_campaign_status_idx" ON "label_suite"."campaign_editor_ai_runs" ("org_id", "campaign_id", "status");
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_lead_id_idx" ON "label_suite"."campaign_editor_ai_runs" ("lead_id");
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_draft_id_idx" ON "label_suite"."campaign_editor_ai_runs" ("draft_id");
CREATE INDEX IF NOT EXISTS "campaign_editor_ai_runs_page_revision_id_idx" ON "label_suite"."campaign_editor_ai_runs" ("page_revision_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_editor_ai_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_editor_ai_runs";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_editor_ai_runs"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_editor_ai_runs";
CREATE TRIGGER "same_org_references"
BEFORE INSERT OR UPDATE ON "label_suite"."campaign_editor_ai_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"(
  'campaign_id', 'campaigns',
  'lead_id', 'campaign_leads',
  'draft_id', 'campaign_outreach_drafts',
  'page_revision_id', 'campaign_public_page_revisions'
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_editor_ai_runs";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_editor_ai_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
