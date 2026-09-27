CREATE TABLE IF NOT EXISTS "label_suite"."analytics_duplicate_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "candidate_key" text NOT NULL,
  "disposition" text NOT NULL,
  "reason" text,
  "reviewed_by" text NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "analytics_duplicate_reviews_disposition_check"
    CHECK ("disposition" IN ('keep_separate', 'link_same_record', 'source_error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_duplicate_reviews_org_candidate_unique"
  ON "label_suite"."analytics_duplicate_reviews" ("org_id", "candidate_key");
CREATE INDEX IF NOT EXISTS "analytics_duplicate_reviews_org_reviewed_at_idx"
  ON "label_suite"."analytics_duplicate_reviews" ("org_id", "reviewed_at");
--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_duplicate_reviews" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."analytics_duplicate_reviews";
CREATE POLICY "tenant_isolation" ON "label_suite"."analytics_duplicate_reviews"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."analytics_duplicate_reviews";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."analytics_duplicate_reviews"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
