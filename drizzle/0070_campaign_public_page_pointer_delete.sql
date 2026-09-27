ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_draft_revision_page_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_draft_revision_page_fk"
  FOREIGN KEY ("id", "current_draft_revision_id")
  REFERENCES "label_suite"."campaign_public_page_revisions" ("page_id", "id")
  ON DELETE SET NULL ("current_draft_revision_id")
  DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_draft_revision_page_fk";
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_published_revision_page_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_published_revision_page_fk"
  FOREIGN KEY ("id", "current_published_revision_id")
  REFERENCES "label_suite"."campaign_public_page_revisions" ("page_id", "id")
  ON DELETE SET NULL ("current_published_revision_id")
  DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_published_revision_page_fk";
--> statement-breakpoint
-- Composite FKs below enforce page-local pointer ownership. The generic same-org
-- trigger must not inspect revision pointers during ON DELETE SET NULL updates.
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_public_pages";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_public_pages"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns');
