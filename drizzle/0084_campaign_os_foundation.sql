ALTER TABLE "label_suite"."campaigns"
  ADD COLUMN IF NOT EXISTS "brief" text,
  ADD COLUMN IF NOT EXISTS "brief_document" jsonb,
  ADD COLUMN IF NOT EXISTS "final_report" text,
  ADD COLUMN IF NOT EXISTS "final_report_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "final_report_finalized_at" timestamp,
  ADD COLUMN IF NOT EXISTS "final_report_finalized_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN IF NOT EXISTS "campaign_id" text;
ALTER TABLE "label_suite"."budget_line_items" DROP CONSTRAINT IF EXISTS "budget_line_items_campaign_id_campaigns_id_fk";
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_campaign_id_campaigns_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."budget_line_items" VALIDATE CONSTRAINT "budget_line_items_campaign_id_campaigns_id_fk";
CREATE INDEX IF NOT EXISTS "budget_line_items_campaign_id_idx" ON "label_suite"."budget_line_items" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_territories" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "country_code" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_territories_country_code_check" CHECK ("country_code" ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_territories_org_campaign_country_unique_idx" ON "label_suite"."campaign_territories" ("org_id", "campaign_id", "country_code");
CREATE INDEX IF NOT EXISTS "campaign_territories_org_id_idx" ON "label_suite"."campaign_territories" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_territories_campaign_id_idx" ON "label_suite"."campaign_territories" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_creator_engagements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "contact_id" text NOT NULL REFERENCES "label_suite"."contacts"("id"),
  "status" text DEFAULT 'identified' NOT NULL,
  "relationship_notes" text,
  "outreach_channel" text DEFAULT 'email' NOT NULL,
  "outreach_permission_status" text DEFAULT 'unknown' NOT NULL,
  "outreach_permission_basis" text,
  "outreach_permission_recorded_at" timestamp,
  "outreach_permission_revoked_at" timestamp,
  "agreed_rate" real,
  "agreed_currency" text,
  "budget_line_id" text REFERENCES "label_suite"."budget_line_items"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_creator_engagements_status_check" CHECK ("status" IN ('identified', 'qualified', 'permission_confirmed', 'contacted', 'negotiating', 'agreed', 'delivering', 'complete', 'declined', 'not_a_fit')),
  CONSTRAINT "campaign_creator_engagements_permission_check" CHECK ("outreach_permission_status" IN ('unknown', 'permitted', 'revoked', 'do_not_contact')),
  CONSTRAINT "campaign_creator_engagements_rate_check" CHECK ("agreed_rate" IS NULL OR "agreed_rate" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_creator_engagements_org_campaign_contact_unique_idx" ON "label_suite"."campaign_creator_engagements" ("org_id", "campaign_id", "contact_id");
CREATE INDEX IF NOT EXISTS "campaign_creator_engagements_org_id_idx" ON "label_suite"."campaign_creator_engagements" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_creator_engagements_campaign_id_idx" ON "label_suite"."campaign_creator_engagements" ("org_id", "campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_creator_engagements_contact_id_idx" ON "label_suite"."campaign_creator_engagements" ("org_id", "contact_id");
CREATE INDEX IF NOT EXISTS "campaign_creator_engagements_budget_line_id_idx" ON "label_suite"."campaign_creator_engagements" ("budget_line_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_creator_deliverables" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "engagement_id" text NOT NULL REFERENCES "label_suite"."campaign_creator_engagements"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "due_date" timestamp,
  "approval_status" text DEFAULT 'pending' NOT NULL,
  "evidence_url" text,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_creator_deliverables_approval_check" CHECK ("approval_status" IN ('pending', 'approved', 'changes_requested', 'rejected'))
);
CREATE INDEX IF NOT EXISTS "campaign_creator_deliverables_org_id_idx" ON "label_suite"."campaign_creator_deliverables" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_creator_deliverables_engagement_id_idx" ON "label_suite"."campaign_creator_deliverables" ("org_id", "engagement_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_posts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "engagement_id" text REFERENCES "label_suite"."campaign_creator_engagements"("id") ON DELETE SET NULL,
  "url" text NOT NULL,
  "platform" text NOT NULL,
  "published_at" timestamp,
  "metrics_captured_at" timestamp DEFAULT now() NOT NULL,
  "manual_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "campaign_posts_org_id_idx" ON "label_suite"."campaign_posts" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_posts_campaign_id_idx" ON "label_suite"."campaign_posts" ("org_id", "campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_posts_engagement_id_idx" ON "label_suite"."campaign_posts" ("engagement_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_territories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_creator_engagements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_creator_deliverables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_posts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_territories";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_territories" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_creator_engagements";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_creator_engagements" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_creator_deliverables";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_creator_deliverables" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_posts";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_posts" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_territories";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_territories" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_creator_engagements";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_creator_engagements" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'contact_id', 'contacts', 'budget_line_id', 'budget_line_items');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_creator_deliverables";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_creator_deliverables" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('engagement_id', 'campaign_creator_engagements');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_posts";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_posts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'engagement_id', 'campaign_creator_engagements');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."budget_line_items";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."budget_line_items" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('project_id', 'budget_projects', 'release_id', 'releases', 'category_id', 'budget_categories', 'funding_source_id', 'funding_sources', 'campaign_id', 'campaigns');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_territories";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_territories" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_creator_engagements";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_creator_engagements" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_creator_deliverables";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_creator_deliverables" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_posts";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_posts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
