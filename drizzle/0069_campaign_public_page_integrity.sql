CREATE OR REPLACE FUNCTION "label_suite"."normalize_campaign_public_page_slug"("value" text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT regexp_replace(regexp_replace(lower(trim("value")), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."canonicalize_campaign_public_page_slug"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."slug" := "label_suite"."normalize_campaign_public_page_slug"(NEW."slug");
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "label_suite"."campaign_public_pages_slug_unique_idx";
DROP TRIGGER IF EXISTS "canonical_slug" ON "label_suite"."campaign_public_pages";
CREATE TRIGGER "canonical_slug"
BEFORE INSERT OR UPDATE OF "slug" ON "label_suite"."campaign_public_pages"
FOR EACH ROW
EXECUTE FUNCTION "label_suite"."canonicalize_campaign_public_page_slug"();
--> statement-breakpoint
UPDATE "label_suite"."campaign_public_pages"
SET "slug" = "label_suite"."normalize_campaign_public_page_slug"("slug");
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_slug_canonical_check";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_slug_canonical_check"
  CHECK ("slug" <> '' AND "slug" = "label_suite"."normalize_campaign_public_page_slug"("slug"));
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_public_pages_slug_unique_idx" ON "label_suite"."campaign_public_pages" ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_public_page_revisions_page_id_id_unique_idx"
  ON "label_suite"."campaign_public_page_revisions" ("page_id", "id");
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_draft_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_draft_revision_page_fk"
  FOREIGN KEY ("id", "current_draft_revision_id")
  REFERENCES "label_suite"."campaign_public_page_revisions" ("page_id", "id")
  DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_draft_revision_page_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  DROP CONSTRAINT IF EXISTS "campaign_public_pages_current_published_revision_id_campaign_public_page_revisions_id_fk";
ALTER TABLE "label_suite"."campaign_public_pages"
  ADD CONSTRAINT "campaign_public_pages_current_published_revision_page_fk"
  FOREIGN KEY ("id", "current_published_revision_id")
  REFERENCES "label_suite"."campaign_public_page_revisions" ("page_id", "id")
  DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE "label_suite"."campaign_public_pages"
  VALIDATE CONSTRAINT "campaign_public_pages_current_published_revision_page_fk";
