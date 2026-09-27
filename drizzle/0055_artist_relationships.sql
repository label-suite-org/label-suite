ALTER TABLE "label_suite"."artists"
  ADD COLUMN IF NOT EXISTS "relationship" text;

CREATE INDEX IF NOT EXISTS "artists_relationship_idx"
  ON "label_suite"."artists" USING btree ("relationship");

DO $$
BEGIN
  ALTER TABLE "label_suite"."artists"
    ADD CONSTRAINT "artists_relationship_check"
    CHECK ("relationship" IS NULL OR "relationship" IN ('roster', 'collaborator'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
