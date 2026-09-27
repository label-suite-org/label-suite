CREATE TABLE IF NOT EXISTS "label_suite"."campaign_public_pages" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "current_draft_revision_id" text,
  "current_published_revision_id" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_public_pages_status_check" CHECK ("status" IN ('draft', 'published', 'unpublished'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_public_pages_org_id_idx" ON "label_suite"."campaign_public_pages" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_public_pages_campaign_id_idx" ON "label_suite"."campaign_public_pages" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_public_pages_status_idx" ON "label_suite"."campaign_public_pages" ("org_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_public_pages_org_campaign_unique_idx" ON "label_suite"."campaign_public_pages" ("org_id", "campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_public_pages_slug_unique_idx" ON "label_suite"."campaign_public_pages" ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_public_page_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "page_id" text NOT NULL REFERENCES "label_suite"."campaign_public_pages"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "content" jsonb NOT NULL,
  "source_snapshot" jsonb NOT NULL,
  "author_id" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "authored_at" timestamp DEFAULT now() NOT NULL,
  "reviewer_id" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "review_status" text DEFAULT 'draft' NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_public_page_revisions_version_check" CHECK ("version" > 0),
  CONSTRAINT "campaign_public_page_revisions_review_status_check" CHECK ("review_status" IN ('draft', 'reviewed', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_public_page_revisions_org_id_idx" ON "label_suite"."campaign_public_page_revisions" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_public_page_revisions_page_id_idx" ON "label_suite"."campaign_public_page_revisions" ("page_id");
CREATE INDEX IF NOT EXISTS "campaign_public_page_revisions_review_status_idx" ON "label_suite"."campaign_public_page_revisions" ("org_id", "review_status");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_public_page_revisions_org_page_version_unique_idx" ON "label_suite"."campaign_public_page_revisions" ("org_id", "page_id", "version");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_draft_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_draft_revision_id_campaign_public_page_revisions_id_fk"
  FOREIGN KEY ("current_draft_revision_id") REFERENCES "label_suite"."campaign_public_page_revisions"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_draft_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_published_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_published_revision_id_campaign_public_page_revisions_id_fk"
  FOREIGN KEY ("current_published_revision_id") REFERENCES "label_suite"."campaign_public_page_revisions"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_published_revision_id_campaign_public_page_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_dogfood_entries" ADD COLUMN IF NOT EXISTS "linked_page_revision_id" text;
ALTER TABLE "label_suite"."campaign_dogfood_entries"
  DROP CONSTRAINT IF EXISTS "campaign_dogfood_entries_linked_page_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_dogfood_entries"
  ADD CONSTRAINT "campaign_dogfood_entries_linked_page_revision_id_campaign_public_page_revisions_id_fk"
  FOREIGN KEY ("linked_page_revision_id") REFERENCES "label_suite"."campaign_public_page_revisions"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."campaign_dogfood_entries"
  VALIDATE CONSTRAINT "campaign_dogfood_entries_linked_page_revision_id_campaign_public_page_revisions_id_fk";
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_linked_page_revision_id_idx" ON "label_suite"."campaign_dogfood_entries" ("linked_page_revision_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_public_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_public_page_revisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_public_pages";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_public_pages" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_public_page_revisions";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_public_page_revisions" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_public_pages";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_public_pages" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'current_draft_revision_id', 'campaign_public_page_revisions', 'current_published_revision_id', 'campaign_public_page_revisions');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_public_page_revisions";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_public_page_revisions" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('page_id', 'campaign_public_pages');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_dogfood_entries";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_dogfood_entries" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'linked_lead_id', 'campaign_leads', 'linked_draft_id', 'campaign_outreach_drafts', 'linked_enrichment_run_id', 'campaign_enrichment_runs', 'linked_page_revision_id', 'campaign_public_page_revisions');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_public_pages";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_public_pages" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_public_page_revisions";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_public_page_revisions" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
